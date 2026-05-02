"""
realtime_inference.py
=====================
HydroSense — Real-Time Pipe Leak Detection
Reads accelerometer bursts from the ESP32 over serial, extracts the
same 20 DSP features used during training, and classifies with the
saved ExtraTreesClassifier model.

Usage
-----
  python realtime_inference.py --port COM3

  # Override serial port and baud rate:
  python realtime_inference.py --port COM3 --baud 921600

  # List available COM ports without running:
  python realtime_inference.py --list-ports

ESP32 Protocol expected
-----------------------
  WAKE        — start of a new data burst (string, newline terminated)
  <float>     — one accelerometer sample per line (e.g. "9.7812\n")
  END         — end of burst

Dependencies (already in requirements.txt):
  numpy, scipy, scikit-learn, joblib, pyserial
"""

import argparse
import sys
import time
from pathlib import Path

import numpy as np
import joblib
import serial
import serial.tools.list_ports
from scipy import signal as scipy_signal
from scipy.stats import kurtosis, skew

# ── Path setup ────────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent
MODELS_DIR = BASE_DIR / "models"
MODEL_PATH = MODELS_DIR / "random_forest_model.pkl"
SCALER_PATH = MODELS_DIR / "scaler.pkl"

# ── DSP / model constants matching training (config.py) ──────────────────────
TRAIN_FS       = 25641   # Hz — sample rate used during training
ACCEL_LOW_CUT  = 10      # Hz — bandpass low cut
ACCEL_HIGH_CUT = 1000    # Hz — bandpass high cut
FILTER_ORDER   = 4
SENSOR_TYPE    = 1       # 1 = accelerometer (matches training label)

# ── Serial defaults ───────────────────────────────────────────────────────────
DEFAULT_BAUD   = 921600
READ_TIMEOUT_S = 30      # seconds to wait for a complete burst before giving up


# ═════════════════════════════════════════════════════════════════════════════
#  DSP + Feature Extraction  (mirrors scripts/02_feature_extractor.py exactly)
# ═════════════════════════════════════════════════════════════════════════════

def _dsp_window(window: np.ndarray, fs: int, low_cut: float, high_cut: float) -> tuple:
    """Detrend → bandpass → Hann-windowed FFT.  Returns (filtered, spectrum, freqs)."""
    window = scipy_signal.detrend(window)
    nyq = 0.5 * fs
    b, a = scipy_signal.butter(FILTER_ORDER, [low_cut / nyq, high_cut / nyq], btype="band")
    filt = scipy_signal.filtfilt(b, a, window)
    spec = np.abs(np.fft.rfft(filt * np.hanning(len(filt))))
    freqs = np.fft.rfftfreq(len(filt), d=1.0 / fs)
    return filt, spec, freqs


def _extract_features(sig: np.ndarray, spec: np.ndarray, freqs: np.ndarray, fs: int) -> dict:
    """Extract the same 20 features the model was trained on."""
    rms      = np.sqrt(np.mean(sig ** 2))
    peak     = float(np.max(np.abs(sig)))
    spec_sum = spec.sum() + 1e-12
    spec_norm = spec / spec_sum

    centroid = float(np.sum(freqs * spec) / spec_sum)

    n = len(spec)
    low_e  = spec[:n // 3].sum()
    mid_e  = spec[n // 3: 2 * n // 3].sum()
    high_e = spec[2 * n // 3:].sum()
    total_e = low_e + mid_e + high_e + 1e-12

    cumsum = np.cumsum(spec)
    rolloff_idx = np.searchsorted(cumsum, 0.85 * cumsum[-1])
    rolloff = float(freqs[min(rolloff_idx, len(freqs) - 1)])

    return {
        "mean":          float(np.mean(sig)),
        "variance":      float(np.var(sig)),
        "rms":           float(rms),
        "kurtosis":      float(kurtosis(sig)),
        "skewness":      float(skew(sig)),
        "peak":          peak,
        "crest_factor":  peak / rms if rms > 0 else 0.0,
        "zero_cross":    int(np.sum(np.diff(np.sign(sig)) != 0)),
        "spec_mean":     float(np.mean(spec)),
        "spec_var":      float(np.var(spec)),
        "spec_max":      float(np.max(spec)),
        "spec_entropy":  float(-np.sum(spec_norm * np.log(spec_norm + 1e-12))),
        "spec_centroid": centroid,
        "spec_rolloff":  rolloff,
        "band_low":      float(low_e  / total_e),
        "band_mid":      float(mid_e  / total_e),
        "band_high":     float(high_e / total_e),
        "band_low_rms":  float(np.sqrt(np.mean(spec[:n // 3] ** 2))),
        "band_high_rms": float(np.sqrt(np.mean(spec[2 * n // 3:] ** 2))),
        "sensor_type":   SENSOR_TYPE,
    }


FEATURE_ORDER = [
    "mean", "variance", "rms", "kurtosis", "skewness", "peak", "crest_factor",
    "zero_cross", "spec_mean", "spec_var", "spec_max", "spec_entropy",
    "spec_centroid", "spec_rolloff", "band_low", "band_mid", "band_high",
    "band_low_rms", "band_high_rms", "sensor_type",
]


def process_burst(samples: np.ndarray, actual_fs: int) -> np.ndarray:
    """
    Resample → DSP pipeline → extract features → scale.
    Returns a (1, 20) numpy array ready for model.predict().
    """
    # ── Resample to training FS so spectral features are in the right Hz range ──
    if actual_fs != TRAIN_FS:
        from math import gcd
        g = gcd(TRAIN_FS, actual_fs)
        up, down = TRAIN_FS // g, actual_fs // g
        samples = scipy_signal.resample_poly(samples, up, down)

    filt, spec, freqs = _dsp_window(samples, TRAIN_FS, ACCEL_LOW_CUT, ACCEL_HIGH_CUT)
    feat_dict = _extract_features(filt, spec, freqs, TRAIN_FS)
    feat_vec = np.array([feat_dict[k] for k in FEATURE_ORDER], dtype=np.float64).reshape(1, -1)
    return feat_vec


# ═════════════════════════════════════════════════════════════════════════════
#  Model loading
# ═════════════════════════════════════════════════════════════════════════════

def load_model():
    if not MODEL_PATH.exists():
        sys.exit(f"[ERROR] Model not found at {MODEL_PATH}\n"
                 "        Run scripts/03_train_model.py first.")
    if not SCALER_PATH.exists():
        sys.exit(f"[ERROR] Scaler not found at {SCALER_PATH}\n"
                 "        Run scripts/03_train_model.py first.")
    model  = joblib.load(MODEL_PATH)
    scaler = joblib.load(SCALER_PATH)
    print(f"[INFO]  Model loaded  : {MODEL_PATH.name}")
    print(f"[INFO]  Scaler loaded : {SCALER_PATH.name}")
    return model, scaler


# ═════════════════════════════════════════════════════════════════════════════
#  Serial reading
# ═════════════════════════════════════════════════════════════════════════════

def list_ports():
    ports = serial.tools.list_ports.comports()
    if not ports:
        print("No COM ports found.")
        return
    print("Available serial ports:")
    for p in ports:
        print(f"  {p.device:10s}  {p.description}")


def read_burst(ser: serial.Serial) -> tuple[list[float], int]:
    """
    Block until a complete burst is received.
    Returns (samples, sensor_num) where sensor_num is 1 or 2.
    Raises TimeoutError if no burst arrives within READ_TIMEOUT_S.
    """
    in_burst = False
    sensor_num = 1
    samples: list[float] = []
    deadline = time.monotonic() + READ_TIMEOUT_S

    while time.monotonic() < deadline:
        raw = ser.readline()
        if not raw:
            continue
        line = raw.decode("utf-8", errors="ignore").strip()

        # Accept both "WAKE" (legacy) and "WAKE:1" / "WAKE:2"
        if line.startswith("WAKE"):
            in_burst = True
            samples = []
            sensor_num = int(line.split(":")[1]) if ":" in line else 1
            print(f"\n[WAKE:{sensor_num}]  Vibration detected — collecting samples...",
                  end="", flush=True)
            continue

        if line == "END":
            if in_burst and samples:
                return samples, sensor_num
            in_burst = False
            continue

        if in_burst:
            try:
                samples.append(float(line))
                if len(samples) % 100 == 0:
                    print(".", end="", flush=True)
            except ValueError:
                # Skip malformed lines (e.g. startup messages)
                pass

    raise TimeoutError(
        f"Did not receive a complete burst within {READ_TIMEOUT_S}s. "
        "Check serial port, baud rate, and ESP32 connection."
    )


# ═════════════════════════════════════════════════════════════════════════════
#  Main inference loop
# ═════════════════════════════════════════════════════════════════════════════

def run(port: str, baud: int, actual_fs: int):
    model, scaler = load_model()

    print(f"\n[INFO]  Connecting to {port} @ {baud} baud ...")
    try:
        ser = serial.Serial(port, baud, timeout=1)
    except serial.SerialException as e:
        sys.exit(f"[ERROR] Cannot open {port}: {e}")

    time.sleep(2)          # let ESP32 reset after DTR toggle
    ser.reset_input_buffer()
    print(f"[INFO]  Connected. Actual sensor FS = {actual_fs} Hz  "
          f"(will resample to {TRAIN_FS} Hz for inference)")
    print("[INFO]  Waiting for vibration trigger...  (Ctrl+C to quit)\n")

    burst_count = 0
    try:
        while True:
            try:
                samples, sensor_num = read_burst(ser)
            except TimeoutError as e:
                print(f"\n[WARN]  {e}")
                continue

            n = len(samples)
            duration_s = n / actual_fs
            print(f"\n[INFO]  Sensor #{sensor_num} — {n} samples ({duration_s:.2f}s @ {actual_fs} Hz)")

            if n < 64:
                print("[WARN]  Too few samples to extract features — skipping.")
                continue

            arr = np.array(samples, dtype=np.float64)

            # Feature extraction + scaling
            try:
                feat_vec = process_burst(arr, actual_fs)
                feat_scaled = scaler.transform(feat_vec)
            except Exception as e:
                print(f"[WARN]  Feature extraction failed: {e}")
                continue

            # Inference
            prediction = model.predict(feat_scaled)[0]
            proba = model.predict_proba(feat_scaled)[0]
            confidence = proba[prediction] * 100

            burst_count += 1
            _print_result(burst_count, sensor_num, prediction, confidence, proba)

    except KeyboardInterrupt:
        print("\n[INFO]  Stopped by user.")
    finally:
        ser.close()


def _print_result(burst_idx: int, sensor_num: int, prediction: int,
                  confidence: float, proba: np.ndarray):
    label = "LEAK DETECTED" if prediction == 1 else "No Leak"
    border = "!" * 50 if prediction == 1 else "-" * 50
    print(f"\n{border}")
    print(f"  Burst #{burst_idx:04d}  Sensor #{sensor_num}  ->  {label}")
    print(f"  Confidence : {confidence:.1f}%")
    print(f"  P(no-leak) = {proba[0]*100:.1f}%   P(leak) = {proba[1]*100:.1f}%")
    print(f"{border}\n")


# ═════════════════════════════════════════════════════════════════════════════
#  CLI
# ═════════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description="HydroSense — real-time leak detection from ESP32 accelerometer."
    )
    parser.add_argument("--port",       default="COM3",
                        help="Serial port (e.g. COM3 on Windows, /dev/ttyUSB0 on Linux)")
    parser.add_argument("--baud",       type=int, default=DEFAULT_BAUD,
                        help=f"Baud rate (default: {DEFAULT_BAUD})")
    parser.add_argument("--sensor-fs",  type=int, default=400,
                        help="Actual sample rate set in ESP32 firmware TARGET_FS (default: 400)")
    parser.add_argument("--list-ports", action="store_true",
                        help="List available COM ports and exit")
    args = parser.parse_args()

    if args.list_ports:
        list_ports()
        return

    run(port=args.port, baud=args.baud, actual_fs=args.sensor_fs)


if __name__ == "__main__":
    main()

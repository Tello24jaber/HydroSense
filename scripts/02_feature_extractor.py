"""
02_feature_extractor.py
Windowed feature extraction from hydrophone (.raw) and accelerometer (.csv).

Each file is sliced into 1-second windows with 50% overlap, yielding ~58
windows per file → ~11 700 training rows from 202 files instead of 202.
Every window produces 20 DSP features covering time-domain, frequency-domain
and spectral-band energy ratios.

Label comes from the ZIP folder structure:
  "No-leak" / "Background Noise"  ->  0
  anything else                    ->  1
"""

import os
import sys
import zipfile
import numpy as np
import pandas as pd
import soundfile as sf
import scipy.signal
from scipy.stats import kurtosis, skew
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parent.parent))
import config

# ── Label map from ZIP folder structure ──────────────────────────────────────
NO_LEAK_KEYWORDS = {"no-leak", "no_leak", "background_noise", "background noise"}

def _build_label_map() -> dict:
    label_map = {}
    specs = [
        (config.RAW_DATA_DIR / "Hydrophone.zip",    ".raw", "H"),
        (config.RAW_DATA_DIR / "Accelerometer.zip", ".csv", "A"),
    ]
    for zip_path, ext, prefix in specs:
        if not zip_path.exists():
            continue
        with zipfile.ZipFile(zip_path, "r") as z:
            for entry in z.namelist():
                if not entry.endswith(ext):
                    continue
                parts = entry.replace("\\", "/").split("/")
                label = 1
                for part in parts:
                    if part.lower().replace(" ", "_") in {k.replace(" ", "_") for k in NO_LEAK_KEYWORDS}:
                        label = 0
                        break
                flat_name = f"{prefix}__{os.path.basename(entry).replace(' ', '_')}"
                label_map[flat_name] = label
    return label_map


# ── Signal loaders ────────────────────────────────────────────────────────────

def _load_hydrophone(filepath: Path) -> np.ndarray:
    sig, _ = sf.read(str(filepath), channels=1,
                     samplerate=config.HYDROPHONE_FS,
                     subtype="PCM_32", endian="LITTLE")
    return sig[:config.MAX_SAMPLES].astype(np.float64)

def _load_accelerometer(filepath: Path) -> np.ndarray:
    return pd.read_csv(filepath)["Value"].values[:config.MAX_SAMPLES].astype(np.float64)


# ── DSP pipeline applied on a single window ───────────────────────────────────

def _dsp_window(window: np.ndarray, fs: int, low_cut: float, high_cut: float):
    """Stage 1-3: detrend → bandpass → windowed FFT."""
    window = scipy.signal.detrend(window)
    nyq = 0.5 * fs
    b, a = scipy.signal.butter(config.FILTER_ORDER,
                               [low_cut / nyq, high_cut / nyq], btype="band")
    filt = scipy.signal.filtfilt(b, a, window)
    spec = np.abs(np.fft.rfft(filt * np.hanning(len(filt))))
    freqs = np.fft.rfftfreq(len(filt), d=1.0 / fs)
    return filt, spec, freqs


# ── Feature extraction per window (Stage 4) ───────────────────────────────────

def _features(sig: np.ndarray, spec: np.ndarray, freqs: np.ndarray,
               fs: int, sensor: str) -> dict:
    rms       = np.sqrt(np.mean(sig ** 2))
    peak      = float(np.max(np.abs(sig)))
    spec_sum  = spec.sum() + 1e-12
    spec_norm = spec / spec_sum

    # Spectral centroid
    centroid = float(np.sum(freqs * spec) / spec_sum)

    # Band energy ratios: low / mid / high thirds of the bandwidth
    n = len(spec)
    low_e  = spec[:n//3].sum()
    mid_e  = spec[n//3:2*n//3].sum()
    high_e = spec[2*n//3:].sum()
    total_e = low_e + mid_e + high_e + 1e-12

    # Spectral roll-off (frequency below which 85% of energy is contained)
    cumsum = np.cumsum(spec)
    rolloff_idx = np.searchsorted(cumsum, 0.85 * cumsum[-1])
    rolloff = float(freqs[min(rolloff_idx, len(freqs) - 1)])

    return {
        # Time domain
        "mean":          float(np.mean(sig)),
        "variance":      float(np.var(sig)),
        "rms":           float(rms),
        "kurtosis":      float(kurtosis(sig)),
        "skewness":      float(skew(sig)),
        "peak":          peak,
        "crest_factor":  peak / rms if rms > 0 else 0.0,
        "zero_cross":    int(np.sum(np.diff(np.sign(sig)) != 0)),
        # Frequency domain
        "spec_mean":     float(np.mean(spec)),
        "spec_var":      float(np.var(spec)),
        "spec_max":      float(np.max(spec)),
        "spec_entropy":  float(-np.sum(spec_norm * np.log(spec_norm + 1e-12))),
        "spec_centroid": centroid,
        "spec_rolloff":  rolloff,
        # Band energy ratios
        "band_low":      float(low_e  / total_e),
        "band_mid":      float(mid_e  / total_e),
        "band_high":     float(high_e / total_e),
        # RMS of normalised spectrum bands
        "band_low_rms":  float(np.sqrt(np.mean(spec[:n//3]**2))),
        "band_high_rms": float(np.sqrt(np.mean(spec[2*n//3:]**2))),
        # Sensor identity
        "sensor_type":   0 if sensor == "H" else 1,
    }


# ── Windowed processing of one file ───────────────────────────────────────────

def _process_file(signal: np.ndarray, fs: int, low_cut: float, high_cut: float,
                  win_size: int, hop_size: int, label: int, sensor: str) -> list:
    rows = []
    starts = range(0, len(signal) - win_size + 1, hop_size)
    for start in starts:
        window = signal[start: start + win_size]
        try:
            filt, spec, freqs = _dsp_window(window, fs, low_cut, high_cut)
            row = _features(filt, spec, freqs, fs, sensor)
            row["label"] = label
            rows.append(row)
        except Exception:
            pass
    return rows


# ── Main ──────────────────────────────────────────────────────────────────────

def extract_all_files():
    sampled_dir = config.SAMPLED_DATA_DIR
    label_map   = _build_label_map()

    h_files  = sorted(sampled_dir.glob("H__*.raw"))
    a_files  = sorted(sampled_dir.glob("A__*.csv"))
    all_files = h_files + a_files

    print(f"Files: {len(h_files)} hydrophone | {len(a_files)} accelerometer")
    print("Applying windowed DSP extraction (this may take a minute)...")

    dataset = []
    for filepath in all_files:
        fname  = filepath.name
        sensor = "H" if fname.startswith("H__") else "A"
        label  = label_map.get(fname, 1)

        try:
            if sensor == "H":
                signal = _load_hydrophone(filepath)
                fs, lo, hi = config.HYDROPHONE_FS, config.HYDROPHONE_LOW_CUT, config.HYDROPHONE_HIGH_CUT
                win, hop   = config.HYDROPHONE_WINDOW_SIZE, config.HYDROPHONE_HOP_SIZE
            else:
                signal = _load_accelerometer(filepath)
                fs, lo, hi = config.ACCELEROMETER_FS, config.ACCELEROMETER_LOW_CUT, config.ACCELEROMETER_HIGH_CUT
                win, hop   = config.ACCELEROMETER_WINDOW_SIZE, config.ACCELEROMETER_HOP_SIZE

            rows = _process_file(signal, fs, lo, hi, win, hop, label, sensor)
            dataset.extend(rows)
            print(f"  {fname}  label={label}  windows={len(rows)}")

        except Exception as e:
            print(f"  ERR {fname}: {e}")

    df = pd.DataFrame(dataset)
    df.dropna(inplace=True)

    print(f"\nTotal windows : {len(df)}")
    print(f"Class balance :\n{df['label'].value_counts().to_string()}")

    df.drop(columns=["sensor_type"], inplace=False)  # keep sensor_type as a feature
    df.to_csv(config.FEATURES_FILE, index=False)
    print(f"\nFeature matrix saved -> {config.FEATURES_FILE}   shape: {df.shape}")


if __name__ == "__main__":
    extract_all_files()

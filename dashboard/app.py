"""
HydroSense Dashboard — FastAPI Backend
======================================
Serves the professional field-worker dashboard and exposes:
  GET  /                    → dashboard HTML
  GET  /api/status          → full system snapshot (JSON)
  GET  /api/sensors         → sensor list with live readings
  GET  /api/alerts          → active + historical alerts
  GET  /api/signal-history  → last 60 s of confidence scores (for live chart)
  POST /api/alert/{id}/ack  → acknowledge an alert
  GET  /stream              → Server-Sent Events (real-time push)

When models/random_forest_model.pkl is present the engine uses it.
Otherwise it runs a realistic simulator so the dashboard works stand-alone.
"""

import asyncio
import json
import math
import os
import random
import threading
import time
import uuid
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import joblib
import numpy as np
import scipy.signal
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from scipy.stats import kurtosis as _scipy_kurtosis, skew as _scipy_skew
from sse_starlette.sse import EventSourceResponse

try:
    import serial
    import serial.tools.list_ports
    _SERIAL_AVAILABLE = True
except ImportError:
    _SERIAL_AVAILABLE = False
    print("[HydroSense] pyserial not installed — serial inference disabled")

# ── Paths ────────────────────────────────────────────────────────────────────
BASE_DIR    = Path(__file__).resolve().parent
MODELS_DIR  = BASE_DIR.parent / "models"
STATIC_DIR  = BASE_DIR / "static"
MODEL_PATH  = MODELS_DIR / "random_forest_model.pkl"
SCALER_PATH = MODELS_DIR / "scaler.pkl"

# ── Constants ─────────────────────────────────────────────────────────────────
JORDAN_ZONES = {
    "Z1": {"name": "Amman – Downtown",    "lat": 31.9539, "lon": 35.9106, "pipes": ["P-101","P-102","P-103"]},
    "Z2": {"name": "Amman – Shmeisani",   "lat": 31.9730, "lon": 35.8958, "pipes": ["P-201","P-202","P-203"]},
    "Z3": {"name": "Amman – Abdali",      "lat": 31.9772, "lon": 35.9123, "pipes": ["P-301","P-302"]},
    "Z4": {"name": "Zarqa – City Center",  "lat": 32.0727, "lon": 36.0878, "pipes": ["P-401","P-402","P-403"]},
    "Z5": {"name": "Irbid – North",       "lat": 32.5568, "lon": 35.8494, "pipes": ["P-501","P-502"]},
    "Z6": {"name": "Aqaba – Port",        "lat": 29.5266, "lon": 35.0078, "pipes": ["P-601","P-602"]},
}

PIPE_MATERIALS = ["MDPE", "PVC", "Cast Iron", "Steel", "HDPE"]
SEVERITY_MAP   = {(0.0, 0.55): "LOW", (0.55, 0.75): "MEDIUM", (0.75, 0.90): "HIGH", (0.90, 1.01): "CRITICAL"}

SENSORS: list[dict] = []
for zone_id, z in JORDAN_ZONES.items():
    for i, pipe in enumerate(z["pipes"]):
        sid = f"HS-{zone_id}-{i+1:02d}"
        SENSORS.append({
            "id":       sid,
            "zone":     zone_id,
            "zone_name": z["name"],
            "pipe":     pipe,
            "material": random.choice(PIPE_MATERIALS),
            "lat":      z["lat"] + random.uniform(-0.005, 0.005),
            "lon":      z["lon"] + random.uniform(-0.005, 0.005),
            "depth_m":  round(random.uniform(0.6, 2.5), 1),
            "install":  f"202{random.randint(1,4)}-{random.randint(1,12):02d}-01",
            "status":   "online",        # online | warning | offline | leak
            "confidence": 0.0,
            "flow_lps":   0.0,
            "pressure_bar": 0.0,
            "last_seen":  datetime.now(timezone.utc).isoformat(),
        })

# ── Shared State ──────────────────────────────────────────────────────────────
alert_store:  list[dict] = []
signal_history: deque    = deque(maxlen=120)   # 120 ticks × 1 s = 2 min
acknowledged_ids: set    = set()

# ── Model loader ──────────────────────────────────────────────────────────────
_model  = None
_scaler = None

def _try_load_model():
    global _model, _scaler
    if MODEL_PATH.exists() and SCALER_PATH.exists():
        _model  = joblib.load(MODEL_PATH)
        _scaler = joblib.load(SCALER_PATH)
        print("[HydroSense] Loaded trained model ✓")
    else:
        print("[HydroSense] No model found — running in simulation mode")

_try_load_model()

# ── Simulation engine ─────────────────────────────────────────────────────────
_tick = 0
_leak_events: dict[str, dict] = {}     # sensor_id → active leak event

def _severity_from_conf(conf: float) -> str:
    for (lo, hi), sev in SEVERITY_MAP.items():
        if lo <= conf < hi:
            return sev
    return "LOW"

def _simulate_tick():
    global _tick
    _tick += 1
    now = datetime.now(timezone.utc)

    # randomly inject / clear leaks (realistic probability)
    for sensor in SENSORS:
        sid = sensor["id"]

        if sid in _leak_events:
            # ongoing leak: ramp confidence, chance to escalate
            ev = _leak_events[sid]
            ev["confidence"] = min(ev["confidence"] + random.uniform(0, 0.015), 0.97)
            sensor["confidence"] = ev["confidence"]
            sensor["status"] = "leak"
            # 1.5% chance per tick to self-resolve (repair)
            if random.random() < 0.015:
                sensor["status"]     = "online"
                sensor["confidence"] = 0.0
                del _leak_events[sid]
        else:
            # normal readings — small noise
            conf = abs(random.gauss(0.08, 0.06))
            conf = min(conf, 0.49)
            sensor["confidence"] = round(conf, 4)
            sensor["status"]     = "online"

            # 0.4% chance to start a new leak
            if random.random() < 0.004:
                init_conf = random.uniform(0.55, 0.72)
                sensor["confidence"] = round(init_conf, 4)
                sensor["status"]     = "leak"
                alert_id = str(uuid.uuid4())[:8].upper()
                zone = JORDAN_ZONES[sensor["zone"]]
                ev = {
                    "id":          alert_id,
                    "sensor_id":   sid,
                    "pipe":        sensor["pipe"],
                    "zone":        sensor["zone"],
                    "zone_name":   sensor["zone_name"],
                    "material":    sensor["material"],
                    "lat":         sensor["lat"],
                    "lon":         sensor["lon"],
                    "depth_m":     sensor["depth_m"],
                    "confidence":  init_conf,
                    "severity":    _severity_from_conf(init_conf),
                    "flow_lps":    round(random.uniform(0.18, 0.47), 2),
                    "pressure_bar": round(random.uniform(1.5, 4.5), 2),
                    "timestamp":   now.isoformat(),
                    "status":      "active",
                    "acknowledged": False,
                    "ack_by":      None,
                    "ack_time":    None,
                }
                _leak_events[sid] = ev
                alert_store.insert(0, ev)
                if len(alert_store) > 500:
                    alert_store.pop()

        # live readings
        if sensor["status"] == "leak":
            sensor["flow_lps"]     = round(random.uniform(0.10, 0.55), 3)
            sensor["pressure_bar"] = round(random.uniform(1.2, 3.8), 2)
        else:
            sensor["flow_lps"]     = round(random.uniform(0.40, 0.90), 3)
            sensor["pressure_bar"] = round(random.uniform(2.8, 5.2), 2)

        # 0.5% chance of going offline
        if random.random() < 0.005:
            sensor["status"] = "offline"
        elif sensor["status"] == "offline" and random.random() < 0.10:
            sensor["status"] = "online"

        sensor["last_seen"] = now.isoformat()

    # update severity labels on active leak events
    for ev in alert_store:
        if ev["status"] == "active":
            sid = ev["sensor_id"]
            if sid in _leak_events:
                ev["confidence"] = round(_leak_events[sid]["confidence"], 4)
                ev["severity"]   = _severity_from_conf(ev["confidence"])

    # aggregate max confidence for signal history
    active_confs = [s["confidence"] for s in SENSORS if s["status"] == "leak"]
    peak_conf = max(active_confs) if active_confs else max(
        (s["confidence"] for s in SENSORS), default=0.0
    )
    signal_history.append({
        "t":    now.isoformat(),
        "conf": round(peak_conf, 4),
        "leaks": len(_leak_events),
    })

# ── Background simulation task ────────────────────────────────────────────────
async def _background_simulation():
    while True:
        _simulate_tick()
        await asyncio.sleep(1)

# ── FastAPI App ────────────────────────────────────────────────────────────────
app = FastAPI(title="HydroSense Dashboard", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

@app.on_event("startup")
async def startup():
    asyncio.create_task(_background_simulation())

# ── Routes ─────────────────────────────────────────────────────────────────────
@app.get("/", include_in_schema=False)
async def serve_dashboard():
    return FileResponse(str(STATIC_DIR / "index.html"))

@app.get("/api/status")
async def get_status():
    total    = len(SENSORS)
    online   = sum(1 for s in SENSORS if s["status"] == "online")
    leaking  = sum(1 for s in SENSORS if s["status"] == "leak")
    offline  = sum(1 for s in SENSORS if s["status"] == "offline")
    warning  = sum(1 for s in SENSORS if s["status"] == "warning")
    active_alerts = [a for a in alert_store if a["status"] == "active"]
    critical = sum(1 for a in active_alerts if a["severity"] == "CRITICAL")
    high     = sum(1 for a in active_alerts if a["severity"] == "HIGH")
    return {
        "timestamp":       datetime.now(timezone.utc).isoformat(),
        "model_loaded":    _model is not None,
        "sensors_total":   total,
        "sensors_online":  online,
        "sensors_leaking": leaking,
        "sensors_offline": offline,
        "sensors_warning": warning,
        "active_alerts":   len(active_alerts),
        "critical_alerts": critical,
        "high_alerts":     high,
        "zones":           list(JORDAN_ZONES.keys()),
        "uptime_pct":      round(online / total * 100, 1) if total else 0,
    }

@app.get("/api/sensors")
async def get_sensors(zone: Optional[str] = None, status: Optional[str] = None):
    result = SENSORS
    if zone:
        result = [s for s in result if s["zone"] == zone]
    if status:
        result = [s for s in result if s["status"] == status]
    return {"sensors": result, "count": len(result)}

@app.get("/api/alerts")
async def get_alerts(limit: int = 50, status: Optional[str] = None):
    result = alert_store
    if status:
        result = [a for a in result if a["status"] == status]
    return {"alerts": result[:limit], "total": len(result)}

@app.post("/api/alert/{alert_id}/ack")
async def acknowledge_alert(alert_id: str, worker: str = "Field Worker"):
    now = datetime.now(timezone.utc).isoformat()
    for a in alert_store:
        if a["id"] == alert_id:
            a["acknowledged"] = True
            a["ack_by"]       = worker
            a["ack_time"]     = now
            acknowledged_ids.add(alert_id)
            return {"ok": True, "alert_id": alert_id, "ack_by": worker, "ack_time": now}
    return JSONResponse(status_code=404, content={"error": "Alert not found"})

@app.post("/api/alert/{alert_id}/resolve")
async def resolve_alert(alert_id: str, worker: str = "Field Worker"):
    now = datetime.now(timezone.utc).isoformat()
    for a in alert_store:
        if a["id"] == alert_id:
            a["status"]       = "resolved"
            a["acknowledged"] = True
            a["ack_by"]       = worker
            a["ack_time"]     = now
            sid = a["sensor_id"]
            if sid in _leak_events:
                del _leak_events[sid]
            for s in SENSORS:
                if s["id"] == sid:
                    s["status"]     = "online"
                    s["confidence"] = 0.0
            return {"ok": True}
    return JSONResponse(status_code=404, content={"error": "Alert not found"})

@app.get("/api/signal-history")
async def get_signal_history():
    return {"history": list(signal_history)}

@app.get("/api/zones")
async def get_zones():
    enriched = {}
    for zid, z in JORDAN_ZONES.items():
        zone_sensors  = [s for s in SENSORS if s["zone"] == zid]
        zone_leaks    = [s for s in zone_sensors if s["status"] == "leak"]
        zone_offline  = [s for s in zone_sensors if s["status"] == "offline"]
        enriched[zid] = {
            **z,
            "sensors_total":   len(zone_sensors),
            "sensors_leaking": len(zone_leaks),
            "sensors_offline": len(zone_offline),
            "status": "leak" if zone_leaks else ("warning" if zone_offline else "ok"),
        }
    return enriched

# ── SSE Stream ─────────────────────────────────────────────────────────────────
@app.get("/stream")
async def sse_stream(request: Request):
    async def event_generator():
        last_tick = _tick
        while True:
            if await request.is_disconnected():
                break
            if _tick != last_tick:
                last_tick = _tick
                active_alerts = [a for a in alert_store if a["status"] == "active"]
                leaking_sensors = [s for s in SENSORS if s["status"] == "leak"]
                payload = {
                    "tick":    _tick,
                    "ts":      datetime.now(timezone.utc).isoformat(),
                    "leaks":   len(leaking_sensors),
                    "alerts":  len(active_alerts),
                    "sensors": [
                        {
                            "id":         s["id"],
                            "status":     s["status"],
                            "confidence": s["confidence"],
                            "flow_lps":   s["flow_lps"],
                            "pressure_bar": s["pressure_bar"],
                        }
                        for s in SENSORS
                    ],
                    "latest_alert": active_alerts[0] if active_alerts else None,
                    "signal_point": list(signal_history)[-1] if signal_history else None,
                }
                yield {"event": "update", "data": json.dumps(payload)}
            await asyncio.sleep(0.25)

    return EventSourceResponse(event_generator())


# ════════════════════════════════════════════════════════════════════════════════
# REAL-TIME SERIAL INFERENCE ENGINE
# ════════════════════════════════════════════════════════════════════════════════

# ── Inference constants (mirrors config.py) ────────────────────────────────────
_ACCEL_FS       = 25641
_ACCEL_LOW_CUT  = 10
_ACCEL_HIGH_CUT = 1000
_FILTER_ORDER   = 4
_WINDOW_SIZE    = 25641   # resample target for model (1 s @ 25641 Hz)
_REAL_FS        = 50      # firmware streams at ~50 Hz (delay 20 ms)
_WINDOW_SAMPLES = 500     # 10 seconds of samples at _REAL_FS
_HOP_SAMPLES    = 500     # no overlap — new result only after full 10 s window collected

# Feature order must match training CSV columns
_FEATURE_ORDER = [
    "mean", "variance", "rms", "kurtosis", "skewness", "peak", "crest_factor",
    "zero_cross", "spec_mean", "spec_var", "spec_max", "spec_entropy",
    "spec_centroid", "spec_rolloff", "band_low", "band_mid", "band_high",
    "band_low_rms", "band_high_rms", "sensor_type",
]

# ── Serial state (thread-safe via _serial_lock) ────────────────────────────────
_serial_lock   = threading.Lock()
_infer_lock    = threading.Lock()
_serial_running = False
_serial_thread: Optional[threading.Thread] = None

_serial_state: dict = {
    "connected":    False,
    "port":         None,
    "error":        None,
    "sample_count": 0,
    "last_ts":      None,
}

# Per-channel sliding sample buffers (only accessed from serial thread)
_ch1_buf: list = []
_ch2_buf: list = []
_ch1_new = 0   # samples added since last inference
_ch2_new = 0

# Latest inference results (updated by serial thread, read by SSE)
_latest_ch1: Optional[dict] = None
_latest_ch2: Optional[dict] = None
_infer_version: int = 0    # incremented each time either channel updates


# ── DSP helpers ───────────────────────────────────────────────────────────────

def _dsp_window(sig: np.ndarray, fs: int, low_cut: float, high_cut: float):
    """Detrend → bandpass → Hann-windowed FFT. Returns (filtered, spec, freqs)."""
    sig = scipy.signal.detrend(sig)
    nyq = 0.5 * fs
    b, a = scipy.signal.butter(_FILTER_ORDER,
                                [low_cut / nyq, high_cut / nyq],
                                btype="band")
    filt  = scipy.signal.filtfilt(b, a, sig)
    spec  = np.abs(np.fft.rfft(filt * np.hanning(len(filt))))
    freqs = np.fft.rfftfreq(len(filt), d=1.0 / fs)
    return filt, spec, freqs


def _extract_features(sig: np.ndarray, spec: np.ndarray, freqs: np.ndarray) -> dict:
    rms      = float(np.sqrt(np.mean(sig ** 2)))
    peak     = float(np.max(np.abs(sig)))
    spec_sum = spec.sum() + 1e-12
    spec_n   = spec / spec_sum
    centroid = float(np.sum(freqs * spec) / spec_sum)
    n        = len(spec)
    low_e    = spec[:n//3].sum()
    mid_e    = spec[n//3:2*n//3].sum()
    high_e   = spec[2*n//3:].sum()
    total_e  = low_e + mid_e + high_e + 1e-12
    cumsum   = np.cumsum(spec)
    r_idx    = int(np.searchsorted(cumsum, 0.85 * cumsum[-1]))
    rolloff  = float(freqs[min(r_idx, len(freqs) - 1)])
    return {
        "mean":          float(np.mean(sig)),
        "variance":      float(np.var(sig)),
        "rms":           rms,
        "kurtosis":      float(_scipy_kurtosis(sig)),
        "skewness":      float(_scipy_skew(sig)),
        "peak":          peak,
        "crest_factor":  peak / rms if rms > 0 else 0.0,
        "zero_cross":    int(np.sum(np.diff(np.sign(sig)) != 0)),
        "spec_mean":     float(np.mean(spec)),
        "spec_var":      float(np.var(spec)),
        "spec_max":      float(np.max(spec)),
        "spec_entropy":  float(-np.sum(spec_n * np.log(spec_n + 1e-12))),
        "spec_centroid": centroid,
        "spec_rolloff":  rolloff,
        "band_low":      float(low_e  / total_e),
        "band_mid":      float(mid_e  / total_e),
        "band_high":     float(high_e / total_e),
        "band_low_rms":  float(np.sqrt(np.mean(spec[:n//3] ** 2))),
        "band_high_rms": float(np.sqrt(np.mean(spec[2*n//3:] ** 2))),
        "sensor_type":   1,
    }


def _run_inference(samples: list, channel: int, ch_status: str) -> dict:
    """
    Full pipeline on the last _WINDOW_SAMPLES of Z-axis data at _REAL_FS Hz:
      1. bandpass-filter at original rate  → filtered waveform for display
      2. resample to _ACCEL_FS            → match training sample rate
      3. DSP + feature extraction         → 20 features
      4. StandardScaler + predict         → Leak / No-Leak + confidence
    """
    sig_orig = np.array(samples[-_WINDOW_SAMPLES:], dtype=np.float64)

    # ── Filtered signal for visualisation (at original _REAL_FS) ──────────────
    nyq_orig    = 0.5 * _REAL_FS
    hi_clip     = min(_ACCEL_HIGH_CUT, nyq_orig * 0.9)  # stay below Nyquist
    try:
        b2, a2 = scipy.signal.butter(_FILTER_ORDER,
                                      [_ACCEL_LOW_CUT / nyq_orig, hi_clip / nyq_orig],
                                      btype="band")
        sig_filt_disp = scipy.signal.filtfilt(b2, a2, sig_orig).tolist()
    except Exception:
        sig_filt_disp = sig_orig.tolist()

    features    = None
    prediction  = None
    confidence  = None
    p_no_leak   = None
    p_leak      = None

    if _model is not None and _scaler is not None:
        try:
            # Resample to training FS
            sig_rs = scipy.signal.resample(sig_orig, _WINDOW_SIZE)
            # DSP pipeline
            filt, spec, freqs = _dsp_window(sig_rs, _ACCEL_FS,
                                             _ACCEL_LOW_CUT, _ACCEL_HIGH_CUT)
            feats = _extract_features(filt, spec, freqs)
            X     = _scaler.transform([[feats[k] for k in _FEATURE_ORDER]])
            pred  = int(_model.predict(X)[0])
            proba = _model.predict_proba(X)[0]
            prediction  = pred
            confidence  = float(proba[pred])
            p_no_leak   = float(proba[0])
            p_leak      = float(proba[1])
            features    = {k: float(v) for k, v in feats.items()}
        except Exception as exc:
            print(f"[Inference] ch{channel}: {exc}")

    return {
        "channel":      channel,
        "ch_status":    ch_status,
        "raw":          sig_orig.tolist(),
        "filtered":     sig_filt_disp,
        "features":     features,
        "prediction":   prediction,
        "confidence":   confidence,
        "p_no_leak":    p_no_leak,
        "p_leak":       p_leak,
        "model_loaded": _model is not None,
        "ts":           datetime.now(timezone.utc).isoformat(),
    }


# ── CSV row parser ─────────────────────────────────────────────────────────────

def _parse_row(line: str) -> Optional[dict]:
    line = line.strip()
    if not line or line.startswith('[') or line.startswith('T'):
        return None
    parts = line.split(',')
    if len(parts) != 15:
        return None
    try:
        nums = list(map(float, parts[:13]))
    except ValueError:
        return None
    s1 = parts[13].strip().upper()
    s2 = parts[14].strip().upper()
    valid = {"SLEEP", "MONITORING", "ACTIVITY_DETECTED"}
    if s1 not in valid or s2 not in valid:
        return None
    return {
        "timeMs":    int(nums[0]),
        "a1x": nums[1], "a1y": nums[2], "a1z": nums[3], "a1mag": nums[4],
        "a2x": nums[5], "a2y": nums[6], "a2z": nums[7], "a2mag": nums[8],
        "sw1": int(nums[9]), "sw2": int(nums[10]),
        "ch1Active": int(nums[11]), "ch2Active": int(nums[12]),
        "ch1Status": s1, "ch2Status": s2,
    }


# ── Background serial reader thread ───────────────────────────────────────────

def _serial_reader(port: str):
    global _serial_running
    global _ch1_buf, _ch2_buf, _ch1_new, _ch2_new
    global _latest_ch1, _latest_ch2, _infer_version

    _ch1_buf, _ch2_buf = [], []
    _ch1_new = _ch2_new = 0

    raw_buf = ""
    conn    = None
    try:
        conn = serial.Serial(port, baudrate=115200, timeout=1.0)
        with _serial_lock:
            _serial_state.update(connected=True, port=port, error=None)
        print(f"[Serial] Connected → {port}")

        while _serial_running:
            try:
                waiting = conn.in_waiting or 1
                chunk   = conn.read(min(waiting, 4096)).decode("utf-8", errors="replace")
                raw_buf += chunk
                lines, raw_buf = raw_buf.rsplit('\n', 1) if '\n' in raw_buf else ("", raw_buf)
                for line in lines.split('\n'):
                    row = _parse_row(line)
                    if row is None:
                        continue

                    _ch1_buf.append(row["a1z"])
                    _ch2_buf.append(row["a2z"])
                    _ch1_new += 1
                    _ch2_new += 1

                    # Trim buffers to 4× window
                    max_buf = _WINDOW_SAMPLES * 4
                    if len(_ch1_buf) > max_buf:
                        _ch1_buf = _ch1_buf[-_WINDOW_SAMPLES * 2:]
                    if len(_ch2_buf) > max_buf:
                        _ch2_buf = _ch2_buf[-_WINDOW_SAMPLES * 2:]

                    with _serial_lock:
                        _serial_state["sample_count"] += 1
                        _serial_state["last_ts"] = datetime.now(timezone.utc).isoformat()

                    # Trigger inference every hop
                    if len(_ch1_buf) >= _WINDOW_SAMPLES and _ch1_new >= _HOP_SAMPLES:
                        _ch1_new = 0
                        result = _run_inference(_ch1_buf, 1, row["ch1Status"])
                        with _infer_lock:
                            _latest_ch1    = result
                            _infer_version += 1

                    if len(_ch2_buf) >= _WINDOW_SAMPLES and _ch2_new >= _HOP_SAMPLES:
                        _ch2_new = 0
                        result = _run_inference(_ch2_buf, 2, row["ch2Status"])
                        with _infer_lock:
                            _latest_ch2    = result
                            _infer_version += 1

            except serial.SerialException as e:
                print(f"[Serial] Read error: {e}")
                break
            except Exception as e:
                print(f"[Serial] Unexpected: {e}")
                time.sleep(0.05)

    except serial.SerialException as e:
        with _serial_lock:
            _serial_state.update(connected=False, error=str(e))
        print(f"[Serial] Failed to connect: {e}")
    finally:
        if conn and conn.is_open:
            conn.close()
        with _serial_lock:
            _serial_state.update(connected=False, port=None)
        print("[Serial] Disconnected")


# ── Serial API endpoints ───────────────────────────────────────────────────────

@app.get("/api/serial/ports")
async def api_serial_ports():
    if not _SERIAL_AVAILABLE:
        return {"ports": [], "error": "pyserial not installed"}
    ports = [{"port": p.device, "description": p.description}
             for p in serial.tools.list_ports.comports()]
    return {"ports": ports}


@app.post("/api/serial/connect")
async def api_serial_connect(port: str = "COM4"):
    global _serial_running, _serial_thread
    if not _SERIAL_AVAILABLE:
        return JSONResponse(status_code=503,
                            content={"ok": False, "message": "pyserial not installed"})
    with _serial_lock:
        if _serial_state["connected"]:
            return {"ok": False, "message": "Already connected"}
    _serial_running = True
    _serial_thread  = threading.Thread(target=_serial_reader, args=(port,), daemon=True)
    _serial_thread.start()
    await asyncio.sleep(0.8)
    with _serial_lock:
        ok  = _serial_state["connected"]
        err = _serial_state["error"]
    return {"ok": ok, "port": port, "message": "Connected" if ok else (err or "Failed")}


@app.post("/api/serial/disconnect")
async def api_serial_disconnect():
    global _serial_running
    _serial_running = False
    return {"ok": True, "message": "Disconnecting"}


@app.get("/api/serial/status")
async def api_serial_status():
    with _serial_lock:
        return dict(_serial_state)


# ── Inference SSE stream ───────────────────────────────────────────────────────

@app.get("/stream/inference")
async def inference_stream(request: Request):
    async def gen():
        last_v = -1
        while True:
            if await request.is_disconnected():
                break
            with _infer_lock:
                v   = _infer_version
                ch1 = _latest_ch1
                ch2 = _latest_ch2
            if v != last_v:
                last_v = v
                with _serial_lock:
                    ser = dict(_serial_state)
                payload = {"serial": ser, "ch1": ch1, "ch2": ch2}
                yield {"event": "inference", "data": json.dumps(payload)}
            await asyncio.sleep(0.2)

    return EventSourceResponse(gen())


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=False)

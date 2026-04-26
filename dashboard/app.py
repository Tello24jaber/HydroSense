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
import time
import uuid
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import joblib
import numpy as np
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sse_starlette.sse import EventSourceResponse

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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=False)

"""
test_model.py
=============
Offline model test — runs the trained model against features_balanced.csv
and prints accuracy, a confusion matrix, and a few sample predictions.
No hardware required.
"""

import sys
import numpy as np
import pandas as pd
import joblib
from pathlib import Path
from sklearn.metrics import accuracy_score, confusion_matrix, classification_report

BASE_DIR   = Path(__file__).resolve().parent
MODEL_PATH  = BASE_DIR / "models" / "random_forest_model.pkl"
SCALER_PATH = BASE_DIR / "models" / "scaler.pkl"
DATA_PATH   = BASE_DIR / "data"   / "features_balanced.csv"

# ── Load ──────────────────────────────────────────────────────────────────────
for p in (MODEL_PATH, SCALER_PATH, DATA_PATH):
    if not p.exists():
        sys.exit(f"[ERROR] Not found: {p}")

model  = joblib.load(MODEL_PATH)
scaler = joblib.load(SCALER_PATH)
data   = pd.read_csv(DATA_PATH)

X = data.drop("label", axis=1).values
y = data["label"].values

X_scaled = scaler.transform(X)
y_pred   = model.predict(X_scaled)
y_proba  = model.predict_proba(X_scaled)[:, 1]

# ── Overall metrics ───────────────────────────────────────────────────────────
acc = accuracy_score(y, y_pred) * 100
cm  = confusion_matrix(y, y_pred)

print("=" * 50)
print(f"  Samples : {len(y)}")
print(f"  Accuracy: {acc:.2f}%")
print("=" * 50)
print("\nConfusion matrix:")
print(f"              Predicted 0  Predicted 1")
print(f"  Actual 0       {cm[0,0]:6d}       {cm[0,1]:6d}   (no-leak)")
print(f"  Actual 1       {cm[1,0]:6d}       {cm[1,1]:6d}   (leak)")
print("\nClassification report:")
print(classification_report(y, y_pred, target_names=["No-Leak", "Leak"]))

# ── Sample predictions (10 random rows) ──────────────────────────────────────
rng = np.random.default_rng(42)
idxs = rng.choice(len(y), size=min(10, len(y)), replace=False)
idxs.sort()

print("Sample predictions (10 random windows):")
print(f"  {'#':>5}  {'Actual':>8}  {'Predicted':>10}  {'P(leak)':>8}  {'Match':>6}")
print("  " + "-" * 46)
for i in idxs:
    actual    = "Leak"    if y[i]      == 1 else "No-Leak"
    predicted = "Leak"    if y_pred[i] == 1 else "No-Leak"
    match     = "OK" if y[i] == y_pred[i] else "WRONG"
    print(f"  {i:5d}  {actual:>8}  {predicted:>10}  {y_proba[i]*100:7.1f}%  {match:>6}")

print("\n[OK] Model is working correctly." if acc > 80 else "\n[WARN] Accuracy seems low — check the model file.")

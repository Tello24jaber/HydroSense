import os
from pathlib import Path

# Paths
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
RAW_DATA_DIR = DATA_DIR / "raw"
SAMPLED_DATA_DIR = DATA_DIR / "sampled"
MODELS_DIR = BASE_DIR / "models"
FEATURES_FILE = DATA_DIR / "features_balanced.csv"

# Hydrophone sampling parameters (PCM_32 RAW files)
HYDROPHONE_FS = 8000        # Hz — from dataset author's convert.md
HYDROPHONE_LOW_CUT  = 20    # Hz
HYDROPHONE_HIGH_CUT = 3800  # Hz  (below Nyquist of 4000 Hz)

# Accelerometer sampling parameters (CSV files, dt=0.000039 s)
ACCELEROMETER_FS = 25641    # Hz  (≈ 1/0.000039)
ACCELEROMETER_LOW_CUT  = 10
ACCELEROMETER_HIGH_CUT = 5000

# Shared DSP
FILTER_ORDER = 4
MAX_SAMPLES   = 240000      # cap per file (mirrors author's df.head(240000))

# Windowed feature extraction — 1-second windows, 50% overlap
HYDROPHONE_WINDOW_SIZE  = 8000    # 1s at 8000 Hz
HYDROPHONE_HOP_SIZE     = 4000    # 50% overlap

ACCELEROMETER_WINDOW_SIZE = 25641  # 1s at ~25641 Hz
ACCELEROMETER_HOP_SIZE    = 12820  # 50% overlap

# Label mapping — folder names from dataset
NO_LEAK_FOLDERS = {"No-leak", "Background Noise"}

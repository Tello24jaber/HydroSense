"""
01_smart_sampler.py
Extracts ALL hydrophone (.raw) and accelerometer (.csv) files directly from
the ZIP archives into data/sampled/, using a flat filename that encodes the
sensor type: H__<name>.raw  and  A__<name>.csv

Labelling comes from the FOLDER structure inside each ZIP:
  "No-leak" / "Background Noise"  →  label = 0
  anything else                    →  label = 1

No full unzip required — files are streamed one-by-one from the archive.
"""

import os
import zipfile
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parent.parent))
import config

NO_LEAK_FOLDERS = config.NO_LEAK_FOLDERS


def _label_from_path(zip_path: str) -> int:
    """Return 0 (no-leak) or 1 (leak) from folder name inside the ZIP."""
    for part in zip_path.replace("\\", "/").split("/"):
        if part in NO_LEAK_FOLDERS:
            return 0
    return 1


def extract_zip(zip_path: Path, extension: str, sensor_prefix: str):
    """Stream matching files from a ZIP into data/sampled/."""
    sampled_dir = config.SAMPLED_DATA_DIR
    extracted = 0

    with zipfile.ZipFile(zip_path, "r") as z:
        entries = [e for e in z.namelist() if e.endswith(extension)]
        print(f"  {zip_path.name}: {len(entries)} {extension} files found")

        for entry in entries:
            basename = os.path.basename(entry).replace(" ", "_")
            out_name = f"{sensor_prefix}__{basename}"
            out_path = sampled_dir / out_name

            if out_path.exists():
                continue  # skip already-extracted files

            with open(out_path, "wb") as f:
                f.write(z.read(entry))
            extracted += 1

    print(f"  -> Extracted {extracted} new files to {sampled_dir}")


def main():
    raw_dir     = config.RAW_DATA_DIR
    sampled_dir = config.SAMPLED_DATA_DIR
    sampled_dir.mkdir(parents=True, exist_ok=True)

    hydro_zip = raw_dir / "Hydrophone.zip"
    accel_zip = raw_dir / "Accelerometer.zip"

    print("=== Smart Sampler ===")

    if hydro_zip.exists():
        print(f"\nProcessing Hydrophone data...")
        extract_zip(hydro_zip, ".raw", "H")
    else:
        print(f"WARNING: {hydro_zip} not found.")

    if accel_zip.exists():
        print(f"\nProcessing Accelerometer data...")
        extract_zip(accel_zip, ".csv", "A")
    else:
        print(f"WARNING: {accel_zip} not found.")

    h_files = list(sampled_dir.glob("H__*.raw"))
    a_files = list(sampled_dir.glob("A__*.csv"))
    print(f"\nSampled directory contents:")
    print(f"  Hydrophone  files : {len(h_files)}")
    print(f"  Accelerometer files: {len(a_files)}")
    print("Done.")


if __name__ == "__main__":
    main()

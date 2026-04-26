"""
run_dashboard.py — Launch the HydroSense Field Dashboard
=========================================================
Usage:
    python run_dashboard.py
    python run_dashboard.py --port 8080
    python run_dashboard.py --host 0.0.0.0 --port 8000

Then open: http://localhost:8000
"""
import argparse
import subprocess
import sys

def main():
    parser = argparse.ArgumentParser(description="HydroSense Dashboard Launcher")
    parser.add_argument("--host",   default="127.0.0.1", help="Bind host (default: 127.0.0.1)")
    parser.add_argument("--port",   default=8000, type=int, help="Port (default: 8000)")
    parser.add_argument("--reload", action="store_true",   help="Enable auto-reload (dev mode)")
    args = parser.parse_args()

    reload_flag = ["--reload"] if args.reload else []

    print(f"\n  ██╗  ██╗██╗   ██╗██████╗ ██████╗  ██████╗ ")
    print(f"  ██║  ██║╚██╗ ██╔╝██╔══██╗██╔══██╗██╔═══██╗")
    print(f"  ███████║ ╚████╔╝ ██║  ██║██████╔╝██║   ██║")
    print(f"  ██╔══██║  ╚██╔╝  ██║  ██║██╔══██╗██║   ██║")
    print(f"  ██║  ██║   ██║   ██████╔╝██║  ██║╚██████╔╝")
    print(f"  ╚═╝  ╚═╝   ╚═╝   ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ")
    print(f"\n  HydroSense — Water Leak Detection Dashboard")
    print(f"  Jordan Water Network · Field Operations\n")
    print(f"  Dashboard → http://{args.host}:{args.port}")
    print(f"  API Docs  → http://{args.host}:{args.port}/docs\n")

    cmd = [
        sys.executable, "-m", "uvicorn",
        "dashboard.app:app",
        "--host", args.host,
        "--port", str(args.port),
        "--log-level", "info",
    ] + reload_flag

    subprocess.run(cmd)

if __name__ == "__main__":
    main()

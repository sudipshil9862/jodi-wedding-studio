#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")/../runtime/ComfyUI"
export HF_HUB_DISABLE_TELEMETRY=1
export DO_NOT_TRACK=1
export OMP_NUM_THREADS=8
exec ../venv/bin/python main.py --cpu --listen 127.0.0.1 --port 8188 --disable-api-nodes --disable-auto-launch "$@"

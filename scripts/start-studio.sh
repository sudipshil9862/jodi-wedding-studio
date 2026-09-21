#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")/.."
export QWEN_MODEL="${QWEN_MODEL:-qwen_image_edit_2511_fp8mixed.safetensors}"
exec node server.mjs

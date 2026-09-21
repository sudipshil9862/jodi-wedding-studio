# Jodi — Wedding portrait console

A local web console connected to **ComfyUI + Qwen-Image-Edit-2511**, with reusable bride/groom profiles, outfit references, generation, result comparison, image downloads, and exported briefs.

**No model guarantees 100% face accuracy.** This integration requests identity preservation but does not measure or certify it. It does not extract facial geometry. Review both faces and garment details against originals. This workspace has no detected NVIDIA runtime; real inference has not been verified here.

## Run the console

Node.js 22 or newer; no npm dependencies. The local launch script selects the installed FP8 mixed checkpoint. Start the image server separately with `npm run start:comfy`.

Local installation uses `runtime/ComfyUI` and `runtime/venv` in CPU mode. Model downloads run through `scripts/download-models.py`, which resumes partial files and verifies SHA-256 before installation. Progress is in `runtime/model-download.log`. Generation remains unavailable until all three model downloads finish. CPU inference may be very slow.

```sh
npm start
```

Open http://localhost:5173. Stop any previous `python3 -m http.server 5173` process first. Keep the same hostname and port to retain access to existing IndexedDB profiles.

By default the console connects to `http://127.0.0.1:8188`. To use a GPU server through an SSH tunnel:

```sh
ssh -N -L 8188:127.0.0.1:8188 user@your-gpu-machine
```

Or set a trusted server directly:

```sh
COMFY_URL=https://your-private-comfy-server.example npm start
```

For a reverse proxy requiring bearer authentication, set `COMFY_TOKEN` in the server environment. Credentials never enter browser JavaScript. This uses native ComfyUI routes, not the paid Comfy Cloud API. An open-source model still needs compute; hosted GPU services may charge for it.

## Set up the inference host

Install [ComfyUI](https://github.com/Comfy-Org/ComfyUI#manual-install-windows-linux) following its hardware-specific instructions, then install the model files from the [official Qwen Edit 2511 guide](https://docs.comfy.org/tutorials/image/qwen/qwen-image-edit-2511):

| ComfyUI directory | Model |
| --- | --- |
| `models/diffusion_models/` | [qwen_image_edit_2511_bf16.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/diffusion_models/qwen_image_edit_2511_bf16.safetensors) |
| `models/text_encoders/` | [qwen_2.5_vl_7b_fp8_scaled.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors) |
| `models/vae/` | [qwen_image_vae.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/vae/qwen_image_vae.safetensors) |

The BF16 diffusion model is large (tens of GB). Select a host with sufficient storage and GPU/system memory for these models. Memory needs vary with offloading and reference count. No model downloads or paid GPU provisioning happen automatically.

Start ComfyUI on the inference host:

```sh
python main.py --listen 127.0.0.1 --port 8188
```

Use a current ComfyUI build with `TextEncodeQwenImageEditPlus`, `CFGNorm`, and `EmptySD3LatentImage`. No custom nodes or Lightning LoRA are required. The console uses 40 Euler/simple steps, CFG 4, AuraFlow shift 3.1. `QWEN_MODEL` can override the diffusion filename for a compatible Qwen Edit 2511 checkpoint. Health checks verify installed nodes and model names; they cannot guarantee sufficient GPU memory.

## Generate

1. Save 1–3 clear face photos for **each** person. Separate individual portraits work best. Add appearance details to preserve.
2. Upload the bride's and groom's outfits, then choose occasion, scene, pose and format.
3. Click **Check connection**. Resolve any listed missing models/nodes.
4. Click **Generate wedding portrait**. The server sends references to your configured ComfyUI host and queues one image.
5. Review the resulting portrait beside the original references in **Gallery & briefs**, then download it. Use **Save & export photo brief** independently when desired.

## Reference handling and limitations

The native Qwen node has three image inputs. Jodi makes a reference sheet for each identity (all saved angles), and a third labeled sheet containing the selected outfits. This is a practical input-packing strategy, **not an empirically validated accuracy improvement**. Sheets are resized to fit; excessive references can reduce visible facial detail. Only uploaded face photos are used as identities; people modeling garments are explicitly excluded as identity sources in the prompt. This instruction may still fail in generation.

The workflow creates a new image with empty latent dimensions matching the selected ratio, conditioned on both identity sheets and optional outfits. It is adapted from the official native edit workflow; pose changes, full-body composition and garment reconstruction require visual evaluation on the target host. No face swapping, face embeddings, likeness scores or guarantees are claimed.

Profiles and generated images persist in browser IndexedDB. On Generate, selected reference sheets are transmitted to ComfyUI, where input/output files remain subject to that host's retention policy. Deleting a gallery item only removes its browser copy. Clearing browser site data removes saved work. Download portraits and briefs to keep copies. Brief JSON contains original reference photos.

Pending jobs resume polling after a page reload. After a console restart, tracking reconnects through ComfyUI’s queue or its 100 most recent history entries using the original client ID. Older results remain in ComfyUI’s history/output folder. The generation bar shows actual sampler steps over a WebSocket connection, with separate loading, decoding and saving stages. Before a measured step arrives, the bar is indeterminate; its percentage is not a time estimate. Bearer-authenticated remote hosts use queue status without WebSocket step telemetry. Tracking pauses after 30 minutes; **Check result** resumes it without resubmitting or cancelling the GPU job. Network submission failures can be ambiguous; check ComfyUI before retrying. No shared queue is cleared or interrupted.

The console binds only to localhost, rejects cross-origin requests, serves an explicit static-file allowlist, and keeps the inference endpoint in server configuration. It is not a multi-user production deployment. Fonts load from Google Fonts; references are not sent there.

## Validation

```sh
npm test
node --check app.js
```

Tests use a mock ComfyUI HTTP server to verify references, node wiring, upload/queue/history/output handling, missing models, malformed requests, and origin/static-file restrictions. Passing them validates the integration protocol, **not GPU inference or facial likeness**.

## Sources and licenses

- [Qwen Edit 2511 model card](https://huggingface.co/Qwen/Qwen-Image-Edit-2511): Apache 2.0; multi-person consistency improvements.
- [ComfyUI](https://github.com/Comfy-Org/ComfyUI): open-source inference service; see its repository license.
- [Official native workflow](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/image_qwen_image_edit_2511.json).
- [Native Qwen node definitions](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_qwen.py).
- [Official API example](https://github.com/Comfy-Org/ComfyUI/blob/master/script_examples/websockets_api_example.py).

## Source repository

Personal reference photos, generated images, downloaded models, local environments,
and logs are intentionally excluded from Git. Upload your own reference photos in
a fresh checkout. The optional workspace-photo library refers to local files and
is not bundled with this repository. Browser profiles are local IndexedDB data,
not part of the repository.

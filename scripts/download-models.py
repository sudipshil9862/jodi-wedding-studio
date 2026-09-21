"""Download only the three official model files needed by the Jodi workflow."""
import hashlib
import json
import pathlib
import subprocess
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1] / 'runtime' / 'ComfyUI' / 'models'
MODELS = [
    ('Comfy-Org/Qwen-Image-Edit_ComfyUI', 'diffusion_models', 'qwen_image_edit_2511_fp8mixed.safetensors'),
    ('Comfy-Org/Qwen-Image_ComfyUI', 'text_encoders', 'qwen_2.5_vl_7b_fp8_scaled.safetensors'),
    ('Comfy-Org/Qwen-Image_ComfyUI', 'vae', 'qwen_image_vae.safetensors'),
]
for repo, folder, filename in MODELS:
    with urllib.request.urlopen(f'https://huggingface.co/api/models/{repo}/tree/main/split_files/{folder}', timeout=60) as response:
        metadata = next(item for item in json.load(response) if item['path'].endswith('/' + filename))
    target = ROOT / folder / filename
    target.parent.mkdir(parents=True, exist_ok=True)
    part = target.with_suffix('.safetensors.part')
    if not target.exists():
        print(f'Downloading {filename}: {metadata["size"] / 1e9:.2f} GB', flush=True)
        subprocess.run(['curl', '-L', '--fail', '--retry', '10', '--retry-all-errors', '--retry-delay', '5', '--connect-timeout', '30', '--speed-limit', '1024', '--speed-time', '120', '-C', '-', f'https://huggingface.co/{repo}/resolve/main/split_files/{folder}/{filename}', '-o', str(part)], check=True)
    source = target if target.exists() else part
    if source.stat().st_size != metadata['size']:
        raise RuntimeError(f'Unexpected size for {filename}')
    print(f'Verifying SHA-256 of {filename}', flush=True)
    with source.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    if digest != metadata['lfs']['oid']:
        raise RuntimeError(f'Checksum mismatch for {filename}; file was not installed')
    if source == part:
        part.rename(target)
    print(f'Installed and verified {filename}', flush=True)

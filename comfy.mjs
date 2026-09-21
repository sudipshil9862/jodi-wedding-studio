// Native ComfyUI Qwen Edit workflow; no custom nodes or paid API required.
export const models = {
  UNETLoader: ['unet_name', process.env.QWEN_MODEL || 'qwen_image_edit_2511_bf16.safetensors'],
  CLIPLoader: ['clip_name', 'qwen_2.5_vl_7b_fp8_scaled.safetensors'],
  VAELoader: ['vae_name', 'qwen_image_vae.safetensors'],
};
const node = (class_type, inputs) => ({ class_type, inputs });
export function workflow({ prompt, ratio, seed }, images) {
  const [width, height] = { '2:3': [832, 1248], '1:1': [1024, 1024], '3:2': [1248, 832] }[ratio];
  const refs = { image1: ['10', 0], image2: ['11', 0], ...(images[2] ? { image3: ['12', 0] } : {}) };
  const mapping = 'Image 1 is a reference sheet of ONE person: the bride. Image 2 is a reference sheet of ONE person: the groom. Each sheet may contain multiple angles of that same person. Generate exactly two people, not a collage. Preserve each person’s own face; do not blend or swap their identities. ' + (images[2] ? 'Image 3 is an outfit reference sheet; use its BRIDE and GROOM labels to assign garments. Ignore the identity of any people modeling the outfits. ' : '') + 'Do not include reference labels, borders or text in the output.\n\n';
  const graph = {
    '1': node('UNETLoader', { unet_name: models.UNETLoader[1], weight_dtype: 'default' }),
    '2': node('CLIPLoader', { clip_name: models.CLIPLoader[1], type: 'qwen_image', device: 'default' }),
    '3': node('VAELoader', { vae_name: models.VAELoader[1] }),
    '4': node('ModelSamplingAuraFlow', { model: ['1', 0], shift: 3.1 }),
    '5': node('CFGNorm', { model: ['4', 0], strength: 1 }),
    '6': node('TextEncodeQwenImageEditPlus', { clip: ['2', 0], vae: ['3', 0], prompt: mapping + prompt, ...refs }),
    '7': node('TextEncodeQwenImageEditPlus', { clip: ['2', 0], vae: ['3', 0], prompt: '', ...refs }),
    '8': node('EmptySD3LatentImage', { width, height, batch_size: 1 }),
    '9': node('KSampler', { model: ['5', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['8', 0], seed, steps: 40, cfg: 4, sampler_name: 'euler', scheduler: 'simple', denoise: 1 }),
    '10': node('LoadImage', { image: images[0] }),
    '11': node('LoadImage', { image: images[1] }),
    '13': node('VAEDecode', { samples: ['9', 0], vae: ['3', 0] }),
    '14': node('SaveImage', { images: ['13', 0], filename_prefix: 'Jodi' }),
  };
  if (images[2]) graph['12'] = node('LoadImage', { image: images[2] });
  return graph;
}
export class ComfyClient {
  constructor(url = process.env.COMFY_URL || 'http://127.0.0.1:8188') {
    this.url = url.replace(/\/$/, '');
    if (!['http:', 'https:'].includes(new URL(this.url).protocol)) throw new Error('COMFY_URL must be HTTP or HTTPS.');
  }
  async request(path, options = {}) {
    let response;
    try { response = await fetch(this.url + path, { ...options, signal: AbortSignal.timeout(30000), redirect: 'error', headers: { ...(process.env.COMFY_TOKEN ? { Authorization: `Bearer ${process.env.COMFY_TOKEN}` } : {}), ...options.headers } }); }
    catch { throw new Error('ComfyUI is unreachable. Start it on your inference machine and set COMFY_URL.'); }
    if (!response.ok) { const detail = (await response.text()).slice(0, 1000); throw new Error(`ComfyUI returned ${response.status}: ${detail}`); }
    return response;
  }
  async json(path, options) { return (await this.request(path, options)).json(); }
  async health() {
    const info = await this.json('/object_info');
    const required = new Set(Object.values(workflow({ prompt: '', ratio: '2:3', seed: 1 }, ['a', 'b', 'c'])).map(n => n.class_type));
    const missing = [...required].filter(type => !info[type]).map(type => `Node: ${type}`);
    for (const [type, [field, filename]] of Object.entries(models)) {
      if (info[type] && !info[type].input?.required?.[field]?.[0]?.includes(filename)) missing.push(`Model: ${filename}`);
    }
    return { ready: !missing.length, service: 'ComfyUI · Qwen-Image-Edit-2511', missing };
  }
  async upload(dataURL, name) {
    const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataURL);
    if (!match) throw new Error('References must be PNG data URLs.');
    const bytes = Buffer.from(match[1], 'base64');
    if (bytes.length > 10 * 1024 * 1024 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Invalid PNG reference or reference exceeds 10 MB.');
    const form = new FormData(); form.append('image', new Blob([bytes], { type: 'image/png' }), name); form.append('type', 'input'); form.append('overwrite', 'false');
    const result = await this.json('/upload/image', { method: 'POST', body: form });
    if (typeof result.name !== 'string') throw new Error('ComfyUI did not return an uploaded image name.');
    return result.subfolder ? `${result.subfolder}/${result.name}` : result.name;
  }
}
export function validateGeneration(body) {
  if (!body || typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 16000) throw new Error('A prompt of 1–16000 characters is required.');
  if (!['2:3', '1:1', '3:2'].includes(body.ratio)) throw new Error('Unsupported aspect ratio.');
  if (!Array.isArray(body.references) || body.references.length < 2 || body.references.length > 3) throw new Error('Bride and groom references are required; an outfit sheet is optional.');
  for (const reference of body.references) {
    if (typeof reference !== 'string' || reference.length > 14 * 1024 * 1024 || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(reference)) throw new Error('Invalid reference image.');
    const bytes = Buffer.from(reference.split(',')[1], 'base64');
    if (bytes.length > 10 * 1024 * 1024 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Invalid PNG reference.');
  }
  if (!Number.isSafeInteger(body.seed) || body.seed < 0) throw new Error('Seed must be a nonnegative safe integer.');
}

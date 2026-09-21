import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

export async function downloadProgress(root) {
  const manifest = JSON.parse(await readFile(join(root, 'model-downloads.json'), 'utf8'));
  const models = await Promise.all(manifest.map(async model => {
    const target = join(root, 'runtime', 'ComfyUI', 'models', model.folder, model.name);
    const info = async path => { try { return await stat(path); } catch (err) { if (err.code === 'ENOENT') return null; throw err; } };
    const installed = await info(target);
    const partial = installed ? null : await info(target + '.part');
    const file = installed || partial;
    const downloadedBytes = Math.min(file?.size || 0, model.totalBytes);
    const status = installed?.size === model.totalBytes ? 'installed' : partial?.size === model.totalBytes ? 'awaiting verification' : partial ? (Date.now() - partial.mtimeMs > 90000 ? 'waiting for download to resume' : 'downloading') : 'queued';
    return { label: model.label, totalBytes: model.totalBytes, downloadedBytes, status };
  }));
  return { models, totalBytes: models.reduce((n, m) => n + m.totalBytes, 0), downloadedBytes: models.reduce((n, m) => n + m.downloadedBytes, 0), complete: models.every(m => m.status === 'installed') };
}

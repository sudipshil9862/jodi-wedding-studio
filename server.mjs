import http from 'node:http';
import { watchProgress } from './generation-progress.mjs';
import { downloadProgress } from './download-progress.mjs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { ComfyClient, workflow, validateGeneration } from './comfy.mjs';
const root = dirname(fileURLToPath(import.meta.url));
const assets = new Map([['/', ['index.html', 'text/html']], ['/index.html', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']], ['/style.css', ['style.css', 'text/css']]]);
for (const time of ['2.05.02', '2.06.03', '2.17.08']) { const file = `WhatsApp Image 2026-09-20 at ${time} PM.jpeg`; assets.set('/' + file, [file, 'image/jpeg']); }
function json(res, code, value) { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
async function readJSON(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('Expected application/json.');
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 43 * 1024 * 1024) throw new Error('Request exceeds 43 MB.'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString());
}
export function createApp(client = new ComfyClient()) {
  const jobs = new Map(); let submitting = false;
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const host = req.headers.host || '';
      if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return json(res, 403, { error: 'Only local access is supported.' });
      if (req.headers.origin && req.headers.origin !== `http://${host}`) return json(res, 403, { error: 'Cross-origin access is not allowed.' });
      const url = new URL(req.url, `http://${host}`);
      if (req.method === 'GET' && url.pathname === '/api/downloads') return json(res, 200, await downloadProgress(root));
      if (req.method === 'GET' && url.pathname === '/api/health') {
        try { return json(res, 200, await client.health()); } catch (err) { return json(res, 200, { ready: false, error: err.message, missing: [] }); }
      }
      if (req.method === 'POST' && url.pathname === '/api/generate') {
        if (submitting) return json(res, 409, { error: 'Another submission is in progress. Please wait.' });
        submitting = true;
        try {
          let body; try { body = await readJSON(req); validateGeneration(body); } catch (err) { return json(res, 400, { error: err.message }); }
          const health = await client.health(); if (!health.ready) return json(res, 503, { error: `Missing ComfyUI requirements: ${health.missing.join(', ')}` });
          const id = randomUUID(); const images = [];
          for (let i = 0; i < body.references.length; i++) images.push(await client.upload(body.references[i], `jodi-${id}-${i}.png`));
          const result = await client.json('/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: workflow(body, images), client_id: id }) });
          if (result.error || !result.prompt_id || Object.keys(result.node_errors || {}).length) throw new Error(`Workflow rejected: ${JSON.stringify(result.error || result.node_errors)}`);
          const job = { promptID: result.prompt_id, createdAt: Date.now() };
          jobs.set(id, job); watchProgress(client, id, job);
          // Only prune old tracking records; never cancel another ComfyUI user's jobs.
          for (const [key, job] of jobs) if (Date.now() - job.createdAt > 24 * 60 * 60 * 1000) { job.socket?.close(); jobs.delete(key); }
          return json(res, 202, { id, seed: body.seed });
        } finally { submitting = false; }
      }
      const match = /^\/api\/jobs\/([a-f0-9-]+)$/.exec(url.pathname);
      if (req.method === 'GET' && match) {
        let job = jobs.get(match[1]);
        if (!job) {
          // Recover this console's client ID after a server restart without resubmitting.
          const queue = await client.json('/queue');
          let item = [...(queue.queue_running || []), ...(queue.queue_pending || [])].find(item => item[3]?.client_id === match[1]);
          if (!item) {
            const previous = await client.json('/history?max_items=100');
            item = Object.values(previous).map(entry => entry.prompt).find(item => item?.[3]?.client_id === match[1]);
          }
          if (item) { job = { promptID: item[1], createdAt: item[3]?.create_time || Date.now() }; jobs.set(match[1], job); }
        }
        if (!job) return json(res, 404, { error: 'Job not found in ComfyUI queue or recent history. Check ComfyUI for older results.' });
        const history = await client.json(`/history/${encodeURIComponent(job.promptID)}`); const entry = history[job.promptID];
        if (!entry) {
          watchProgress(client, match[1], job);
          const queue = await client.json('/queue');
          const running = (queue.queue_running || []).some(item => item[1] === job.promptID);
          const position = (queue.queue_pending || []).findIndex(item => item[1] === job.promptID);
          return json(res, 200, { status: 'pending', progress: { ...(running ? job.progress || { stage: 'Processing portrait' } : { stage: position >= 0 ? `Waiting in queue · position ${position + 1}` : 'Checking completion' }), elapsedSeconds: Math.max(0, Math.floor((Date.now() - job.createdAt) / 1000)) } });
        }
        job.socket?.close();
        if (entry.status?.status_str === 'error') {
          const failure = entry.status.messages?.find(m => m[0] === 'execution_error');
          return json(res, 200, { status: 'failed', error: failure?.[1]?.exception_message || 'ComfyUI could not complete this generation.' });
        }
        const outputs = entry.outputs?.['14']?.images || [];
        if (!outputs.length) return json(res, 200, { status: entry.status?.completed ? 'failed' : 'pending', error: entry.status?.completed ? 'The workflow completed without an image.' : undefined });
        const images = [];
        for (const image of outputs.slice(0, 1)) {
          const response = await client.request('/view?' + new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || '', type: image.type || 'output' }));
          const type = response.headers.get('content-type')?.split(';')[0];
          if (!['image/png', 'image/jpeg', 'image/webp'].includes(type)) throw new Error('ComfyUI returned an unsupported image type.');
          const bytes = Buffer.from(await response.arrayBuffer()); if (bytes.length > 25 * 1024 * 1024) throw new Error('Generated image exceeds 25 MB; download it from ComfyUI.');
          images.push(`data:${type};base64,${bytes.toString('base64')}`);
        }
        return json(res, 200, { status: 'complete', images });
      }
      if (req.method === 'GET' && assets.has(decodeURIComponent(url.pathname))) {
        const [file, type] = assets.get(decodeURIComponent(url.pathname)); res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' }); return res.end(await readFile(join(root, file)));
      }
      json(res, 404, { error: 'Not found' });
    } catch (err) { json(res, 502, { error: err.message }); }
  });
  server.on('close', () => { for (const job of jobs.values()) job.socket?.close(); });
  return server;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 5173);
  createApp().listen(port, '127.0.0.1', () => console.log(`Jodi studio: http://localhost:${port}\nComfyUI: ${process.env.COMFY_URL || 'http://127.0.0.1:8188'}`));
}

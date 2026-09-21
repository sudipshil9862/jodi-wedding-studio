import test from 'node:test';
import { applyProgress } from '../generation-progress.mjs';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createApp } from '../server.mjs';
import { ComfyClient, models, workflow, validateGeneration } from '../comfy.mjs';
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const body = { prompt: 'Indian wedding couple', ratio: '2:3', seed: 123, references: [png, png, png] };
function objectInfo() {
  const info = Object.fromEntries(Object.values(workflow(body, ['a', 'b', 'c'])).map(n => [n.class_type, {}]));
  for (const [type, [field, filename]] of Object.entries(models)) info[type] = { input: { required: { [field]: [[filename]] } } };
  return info;
}
async function listen(server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return `http://127.0.0.1:${server.address().port}`; }
test('workflow keeps identities separate, adds optional outfits and sets output ratio', () => {
  const graph = workflow(body, ['bride.png', 'groom.png', 'outfits.png']);
  assert.equal(graph['10'].inputs.image, 'bride.png'); assert.equal(graph['11'].inputs.image, 'groom.png');
  assert.deepEqual(graph['6'].inputs.image3, ['12', 0]); assert.equal(graph['8'].inputs.height, 1248);
  assert.equal(graph['9'].inputs.seed, 123); assert.match(graph['6'].inputs.prompt, /do not blend or swap/);
  const noOutfits = workflow(body, ['b', 'g']); assert.equal(noOutfits['12'], undefined); assert.equal(noOutfits['6'].inputs.image3, undefined);
});
test('invalid requests rejected before uploading', () => {
  validateGeneration(body);
  for (const change of [{ references: [png] }, { references: ['data:image/png;base64,bm90cG5n', png] }, { ratio: '9:16' }, { seed: -1 }, { prompt: '' }]) assert.throws(() => validateGeneration({ ...body, ...change }));
});
test('HTTP integration: upload, queue, pending, complete, errors and access boundaries', async t => {
  let mode = 'pending', uploads = 0, queued;
  const mock = http.createServer(async (req, res) => {
    const json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
    if (req.url === '/queue') return json({ queue_running: queued ? [[0, 'upstream-id', queued.prompt, {client_id: queued.client_id}]] : [], queue_pending: [] });
    if (req.url === '/history?max_items=100') return json({});
    if (req.url === '/object_info') { const info = objectInfo(); if (mode === 'missing') info.UNETLoader.input.required.unet_name = [[]]; return json(info); }
    if (req.url === '/upload/image') { let text = ''; for await (const chunk of req) text += chunk; assert.match(text, /filename="jodi-/); uploads++; return json({ name: `${uploads}.png`, subfolder: 'refs' }); }
    if (req.url === '/prompt') { let text = ''; for await (const chunk of req) text += chunk; queued = JSON.parse(text); return json({ prompt_id: 'upstream-id', node_errors: {} }); }
    if (req.url === '/history/upstream-id') return json(mode === 'pending' ? {} : mode === 'failed' ? { 'upstream-id': { status: { status_str: 'error', messages: [['execution_error', { exception_message: 'GPU out of memory' }]] } } } : { 'upstream-id': { status: { completed: true }, outputs: { '14': { images: [{ filename: 'output.png', subfolder: '', type: 'output' }] } } } });
    if (req.url.startsWith('/view?')) { res.setHeader('Content-Type', 'image/png'); return res.end(Buffer.from(png.split(',')[1], 'base64')); }
    res.writeHead(404); res.end();
  });
  const upstream = await listen(mock); const app = createApp(new ComfyClient(upstream)); const base = await listen(app);
  t.after(() => { app.closeAllConnections(); mock.closeAllConnections(); app.close(); mock.close(); });
  const post = value => fetch(base + '/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  assert.equal((await (await fetch(base + '/api/health')).json()).ready, true);
  assert.equal((await post({ ...body, references: [] })).status, 400); assert.equal(uploads, 0);
  mode = 'missing'; assert.equal((await (await fetch(base + '/api/health')).json()).ready, false); assert.equal((await post(body)).status, 503); assert.equal(uploads, 0);
  mode = 'pending'; const response = await post(body); assert.equal(response.status, 202); const job = await response.json(); assert.equal(uploads, 3); assert.equal(queued.prompt['10'].inputs.image, 'refs/1.png');
  assert.equal((await (await fetch(base + `/api/jobs/${job.id}`)).json()).status, 'pending');
  mode = 'complete'; const output = await (await fetch(base + `/api/jobs/${job.id}`)).json(); assert.equal(output.status, 'complete'); assert.equal(output.images[0], png);
  mode = 'failed'; assert.match((await (await fetch(base + `/api/jobs/${job.id}`)).json()).error, /out of memory/);
  assert.equal((await fetch(base + '/api/jobs/deadbeef')).status, 404);
  assert.equal((await fetch(base + '/server.mjs')).status, 404);
  assert.equal((await fetch(base + '/api/health', { headers: { Origin: 'https://evil.example' } })).status, 403);
  const badHostStatus = await new Promise((resolve, reject) => { http.get(base + '/', { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject); });
  assert.equal(badHostStatus, 403);
  assert.equal((await fetch(base + '/')).status, 200);
});

test('generation progress uses real sampler steps and ignores other jobs', () => {
  const job = { promptID: 'mine' };
  applyProgress(job, {type:'executing', data:{node:'9'}});
  assert.equal(job.progress.stage, 'Generating portrait'); assert.equal(job.progress.value, undefined);
  applyProgress(job, {type:'progress', data:{prompt_id:'other', node:'9',value:20,max:40}});
  assert.equal(job.progress.value, undefined);
  applyProgress(job, {type:'progress', data:{prompt_id:'mine', node:'9',value:3,max:40}});
  assert.equal(job.progress.value,3); assert.equal(job.progress.max,40);
  applyProgress(job, {type:'executing', data:{prompt_id:'mine',node:'13'}});
  assert.equal(job.progress.stage,'Decoding portrait'); assert.equal(job.progress.value,undefined);
});

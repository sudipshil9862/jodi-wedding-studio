const stages = { '1': 'Loading image model', '2': 'Loading text encoder', '3': 'Loading image decoder', '6': 'Processing face and outfit references', '7': 'Preparing image guidance', '9': 'Generating portrait', '13': 'Decoding portrait', '14': 'Saving portrait' };
export function applyProgress(job, message) {
  const data = message.data || {};
  if (data.prompt_id && data.prompt_id !== job.promptID) return;
  if (message.type === 'executing' && data.node != null) {
    job.progress = { stage: stages[data.node] || 'Preparing portrait', node: String(data.node), updatedAt: Date.now() };
  }
  if (message.type === 'progress' && String(data.node) === '9' && Number.isFinite(data.value) && Number.isFinite(data.max) && data.max > 0) {
    job.progress = { stage: 'Generating portrait', node: '9', value: Math.min(data.max, Math.max(0, data.value)), max: data.max, updatedAt: Date.now() };
  }
}
export function watchProgress(client, id, job) {
  if (job.socket || !client.url || process.env.COMFY_TOKEN) return;
  const url = new URL(client.url + '/ws'); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'; url.searchParams.set('clientId', id);
  const socket = new WebSocket(url); job.socket = socket;
  socket.addEventListener('message', event => {
    if (typeof event.data !== 'string') return;
    try { applyProgress(job, JSON.parse(event.data)); } catch { /* Ignore non-progress events. */ }
  });
  socket.addEventListener('error', () => { if (job.socket === socket) job.socket = null; });
  socket.addEventListener('close', () => { if (job.socket === socket) job.socket = null; });
}

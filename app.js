'use strict';
const $ = (s) => document.querySelector(s);
const roles = ['bride', 'groom'];
const labels = { bride: 'Bride', groom: 'Groom' };
const state = { profiles: { bride: { name: '', notes: '', photos: [] }, groom: { name: '', notes: '', photos: [] } }, outfits: { bride: null, groom: null }, briefs: [], generations: [], occasion: 'Wedding', setting: 'Royal palace courtyard', pose: 'Standing together, full length', notes: '', ratio: '2:3' };
let db, editingRole, draftPhotos = [], toastTimer;
const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(message) { $('#toast').textContent = message; $('#toast').style.display = 'block'; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').style.display = 'none'; }, 4500); }
async function openStorage() {
  db = await new Promise((resolve, reject) => { const req = indexedDB.open('jodi-studio', 1); req.onupgradeneeded = () => req.result.createObjectStore('workspace'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
  const saved = await new Promise((resolve, reject) => { const req = db.transaction('workspace').objectStore('workspace').get('state'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
  if (saved) Object.assign(state, saved);
}
async function persist() {
  if (!db) throw new Error('Browser storage is unavailable. Enable storage and reload to save your work.');
  await new Promise((resolve, reject) => { const tx = db.transaction('workspace', 'readwrite'); tx.objectStore('workspace').put(structuredClone(state), 'state'); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('Unable to save. Browser storage may be full.')); });
}
function showView(view) {
  document.querySelectorAll('.view').forEach(el => { el.hidden = el.id !== `${view}-view`; });
  document.querySelectorAll('.nav').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  $('#breadcrumb').textContent = { studio: 'Create portraits', couple: 'Couple profiles', gallery: 'Gallery & briefs' }[view];
  if (view === 'gallery') renderGallery();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function profileCard(role) {
  const p = state.profiles[role];
  return `<button class="person-card" data-profile="${role}">${p.photos.length ? `<img class="person-avatar" src="${p.photos[0].data}" alt="${labels[role]} reference">` : '<span class="person-avatar">♧</span>'}<div><strong>${escapeHTML(p.name || labels[role])}</strong><small>${p.photos.length ? `${p.photos.length} face reference${p.photos.length > 1 ? 's' : ''} saved` : 'Add face references'}</small><small>${p.photos.length ? 'Edit reusable profile' : '＋ Set up profile'}</small></div><span class="edit">↗</span></button>`;
}
function renderProfiles() {
  $('#couple-cards').innerHTML = roles.map(profileCard).join('');
  $('#profile-page').innerHTML = roles.map(profileCard).join('');
  const ready = roles.filter(r => state.profiles[r].photos.length).length;
  $('#profile-count').textContent = ready;
  $('#summary-faces').textContent = `${ready} of 2 profiles ready`;
}
function renderOutfits() {
  $('#outfit-grid').innerHTML = roles.map(role => {
    const outfit = state.outfits[role];
    return `<div><div class="outfit-label">${labels[role]}'s outfit</div><label class="upload" aria-label="Upload ${role} outfit">${outfit ? `<img class="outfit-image" src="${outfit.data}" alt="${labels[role]} outfit reference">` : '<span class="upload-symbol">♧</span><strong>Upload an outfit</strong><small>JPG, PNG or WebP · up to 10 MB</small>'}<input type="file" data-outfit="${role}" accept="image/jpeg,image/png,image/webp"></label>${outfit ? `<div class="outfit-actions"><span>Click image to replace</span><button class="text-button" data-remove-outfit="${role}">Remove</button></div>` : ''}</div>`;
  }).join('');
}
function renderDraftPhotos() {
  $('#face-previews').innerHTML = draftPhotos.map((photo, i) => `<div class="face-preview"><img src="${photo.data}" alt="Face reference ${i + 1}"><button type="button" data-remove-face="${i}" aria-label="Remove reference ${i + 1}">×</button></div>`).join('');
}
function editProfile(role) {
  editingRole = role;
  const p = state.profiles[role];
  draftPhotos = structuredClone(p.photos);
  $('#dialog-title').textContent = `${labels[role]} profile`;
  $('#person-name').value = p.name;
  $('#face-notes').value = p.notes;
  $('#face-upload').value = '';
  renderDraftPhotos();
  $('#profile-dialog').showModal();
}
async function readPhoto(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Please choose a JPEG, PNG or WebP image.');
  if (file.size > 10 * 1024 * 1024) throw new Error('Each photo must be smaller than 10 MB.');
  const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Could not read that image.')); reader.readAsDataURL(file); });
  await new Promise((resolve, reject) => { const image = new Image(); image.onload = resolve; image.onerror = () => reject(new Error('This file could not be decoded as an image.')); image.src = data; });
  return { name: file.name, data, type: file.type };
}
function updateSummary() { $('#summary-occasion').textContent = state.occasion; $('#summary-setting').textContent = state.setting; }
function downloadBrief(brief) {
  const blob = new Blob([JSON.stringify(brief, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `jodi-${brief.id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function makeBrief() {
  const prompt = [
    `Create a photorealistic Indian wedding couple portrait for a ${state.occasion.toLowerCase()} celebration.`,
    `Setting: ${state.setting}. Pose: ${state.pose}. Aspect ratio: ${state.ratio}.`,
    ...roles.map(role => { const p = state.profiles[role]; return `${labels[role]}${p.name ? ` (${p.name})` : ''}: use the attached ${role} face references to preserve facial identity, natural skin tone, facial proportions and distinctive features.${p.notes ? ` Appearance notes: ${p.notes}.` : ''} ${state.outfits[role] ? `Use the attached ${role} outfit reference, preserving its colors, fabric, embroidery and silhouette.` : 'Choose occasion-appropriate Indian wedding attire.'}`; }),
    'Keep the two identities distinct. Use natural skin texture, realistic anatomy, coherent lighting and a professional wedding photography style.',
    state.notes ? `Additional creative direction: ${state.notes}` : ''
  ].filter(Boolean).join('\n\n');
  return { version: 1, id: crypto.randomUUID(), createdAt: new Date().toISOString(), status: 'brief-only', occasion: state.occasion, setting: state.setting, pose: state.pose, ratio: state.ratio, notes: state.notes, prompt, profiles: structuredClone(state.profiles), outfits: structuredClone(state.outfits), identityNote: 'Reference-based likeness is requested, not guaranteed. Review generated faces against originals.' };
}
function renderGallery() {
  $('#brief-count').textContent = state.briefs.length + state.generations.length;
  $('#gallery').innerHTML = state.briefs.length ? state.briefs.map(b => `<article class="brief-card"><span class="person-avatar">✦</span><div><h2>${escapeHTML(b.occasion)} portrait brief</h2><p>${escapeHTML(b.setting)} · ${escapeHTML(b.ratio)}</p><p>${new Date(b.createdAt).toLocaleDateString()} · References included · No image generated</p></div><div class="brief-actions"><button class="primary" data-download="${b.id}">Download brief ↓</button><button class="text-button" data-delete="${b.id}">Delete</button></div></article>`).join('') : '<div class="empty-state"><span style="font-size:35px">✧</span><h2>A story waiting to unfold.</h2><p>Your saved portrait briefs will appear here.<br>Start with your couple and a moment you want to capture.</p><button class="primary" data-go-studio>Create your first brief</button></div>';
  if (state.generations.length) {
    if (!state.briefs.length) $('#gallery').innerHTML = '';
    $('#gallery').insertAdjacentHTML('afterbegin', state.generations.map(generationCard).join(''));
  }
}
async function handleClick(e) {
  const el = e.target.closest('button'); if (!el) return;
  if (el.dataset.view) showView(el.dataset.view);
  if (el.dataset.resume) resumeGeneration(el.dataset.resume);
  if (el.dataset.deleteGeneration) { const previous = state.generations; state.generations = state.generations.filter(g => g.id !== el.dataset.deleteGeneration); try { await persist(); } catch (err) { state.generations = previous; throw err; } renderGallery(); }
  if (el.dataset.profile) editProfile(el.dataset.profile);
  if (el.hasAttribute('data-go-studio')) showView('studio');
  if (el.hasAttribute('data-remove-face')) { draftPhotos.splice(Number(el.dataset.removeFace), 1); renderDraftPhotos(); }
  if (el.dataset.removeOutfit) { const role = el.dataset.removeOutfit; const previous = state.outfits[role]; state.outfits[role] = null; try { await persist(); } catch (err) { state.outfits[role] = previous; throw err; } renderOutfits(); }
  if (el.classList.contains('chip')) { state.occasion = el.dataset.value; document.querySelectorAll('.chip').forEach(c => c.classList.toggle('selected', c === el)); updateSummary(); await persist(); }
  if (el.dataset.download) downloadBrief(state.briefs.find(b => b.id === el.dataset.download));
  if (el.dataset.delete) { const previous = state.briefs; state.briefs = state.briefs.filter(b => b.id !== el.dataset.delete); try { await persist(); } catch (err) { state.briefs = previous; throw err; } renderGallery(); toast('Brief deleted.'); }
  if (el.dataset.library) {
    el.disabled = true;
    try { const response = await fetch(el.dataset.library); if (!response.ok) throw new Error('Could not load workspace photo.'); const photo = await readPhoto(new File([await response.blob()], el.dataset.library, { type: 'image/jpeg' })); const role = el.dataset.role; const previous = state.outfits[role]; state.outfits[role] = photo; try { await persist(); } catch (err) { state.outfits[role] = previous; throw err; } renderOutfits(); toast('Outfit reference selected.'); } finally { el.disabled = false; }
  }
}
document.addEventListener('click', e => handleClick(e).catch(err => toast(err.message)));
$('#close-dialog').addEventListener('click', () => $('#profile-dialog').close());
$('#face-upload').addEventListener('change', async e => { try { const files = [...e.target.files]; if (draftPhotos.length + files.length > 3) throw new Error('Add up to 3 face references per person.'); const photos = await Promise.all(files.map(readPhoto)); draftPhotos.push(...photos); renderDraftPhotos(); } catch (err) { toast(err.message); } finally { e.target.value = ''; } });
$('#profile-form').addEventListener('submit', async e => {
  e.preventDefault(); const button = e.submitter || $('#profile-form button[type="submit"]'); button.disabled = true;
  const previous = state.profiles[editingRole];
  state.profiles[editingRole] = { name: $('#person-name').value.trim(), notes: $('#face-notes').value.trim(), photos: structuredClone(draftPhotos) };
  try { await persist(); renderProfiles(); $('#profile-dialog').close(); toast(`${labels[editingRole]} profile saved for future briefs.`); } catch (err) { state.profiles[editingRole] = previous; toast(err.message); } finally { button.disabled = false; }
});
$('#outfit-grid').addEventListener('change', async e => {
  const role = e.target.dataset.outfit; if (!role || !e.target.files.length) return;
  const previous = state.outfits[role];
  try { state.outfits[role] = await readPhoto(e.target.files[0]); await persist(); renderOutfits(); toast('Outfit reference saved.'); } catch (err) { state.outfits[role] = previous; toast(err.message); }
});
for (const key of ['setting', 'pose', 'notes', 'ratio']) $(`#${key}`).addEventListener('change', async e => { state[key] = e.target.value; updateSummary(); try { await persist(); } catch (err) { toast(err.message); } });
$('#save-brief').addEventListener('click', async () => {
  const missing = roles.filter(role => !state.profiles[role].photos.length);
  if (missing.length) { $('#validation').textContent = `Add face references for the ${missing.join(' and ')} to prepare your brief.`; editProfile(missing[0]); return; }
  $('#validation').textContent = ''; const button = $('#save-brief'); button.disabled = true;
  // Capture current form values even if focus has not yet left a field.
  for (const key of ['setting', 'pose', 'notes', 'ratio']) state[key] = $(`#${key}`).value;
  const brief = makeBrief(); state.briefs.unshift(brief);
  try { await persist(); renderGallery(); downloadBrief(brief); toast('Brief saved and exported with your face and outfit references.'); } catch (err) { state.briefs = state.briefs.filter(b => b.id !== brief.id); toast(err.message); } finally { button.disabled = false; }
});
const workspaceImages = ['WhatsApp Image 2026-09-20 at 2.05.02 PM.jpeg', 'WhatsApp Image 2026-09-20 at 2.06.03 PM.jpeg', 'WhatsApp Image 2026-09-20 at 2.17.08 PM.jpeg'];
$('#workspace-images').innerHTML = workspaceImages.map(file => `<div class="library-item"><img src="${encodeURI(file)}" alt="Available workspace outfit reference" loading="lazy">${roles.map(role => `<button data-library="${file}" data-role="${role}">Use for ${role}</button>`).join('')}</div>`).join('');
async function init() {
  try { await openStorage(); } catch (err) { toast('Browser storage is unavailable. Changes cannot be saved in this session.'); }
  renderProfiles(); renderOutfits(); renderGallery(); updateSummary();
  for (const key of ['setting', 'pose', 'notes', 'ratio']) $(`#${key}`).value = state[key];
  document.querySelectorAll('.chip').forEach(c => c.classList.toggle('selected', c.dataset.value === state.occasion));
}
init().then(() => { checkService(); const pending = state.generations.find(g => g.status === 'pending'); if (pending) resumeGeneration(pending.id); });

let generationBusy = false;
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, signal: AbortSignal.timeout(path === '/api/generate' ? 180000 : 40000) });
  const type = response.headers.get('content-type') || '';
  if (!type.includes('application/json')) throw new Error('Start the console with npm start to enable image generation.');
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
  return result;
}
async function checkService() {
  $('#check-service').disabled = true;
  try {
    const result = await api('/api/health');
    $('#service-status').textContent = result.ready ? '● Image service ready' : '○ Image service needs setup';
    $('#service-detail').textContent = result.ready ? 'Connected. Both identities and outfit references will be sent when you generate.' : result.error || `Install: ${result.missing.join(', ')}`;
    $('#generate-photo').disabled = !result.ready || generationBusy;
  } catch (err) { $('#service-status').textContent = '○ Image service offline'; $('#service-detail').textContent = err.message; $('#generate-photo').disabled = true; }
  finally { $('#check-service').disabled = false; }
}
function generationCard(g) {
  const image = g.images?.[0];
  return `<article class="generation-card">${image ? `<a href="${image}" download="jodi-${g.id}.png"><img class="result-image" src="${image}" alt="Generated wedding portrait — review facial likeness"></a>` : '<div class="generation-placeholder">✦</div>'}<div class="generation-info"><h2>${escapeHTML(g.occasion)} portrait</h2><p>${escapeHTML(g.setting)} · Seed ${g.seed}</p><p>${g.status === 'complete' ? 'Generated · Facial likeness needs your review' : g.status === 'failed' ? escapeHTML(g.error || 'Generation failed') : 'Queued or generating'}</p>${image ? `<div class="review-references">${roles.map(role => `<img src="${g.references[role]}" alt="Original ${role} reference">`).join('')}<span>Compare both faces with the originals.</span></div><a class="primary download-image" href="${image}" download="jodi-${g.id}.png">Download portrait ↓</a>` : g.status === 'pending' ? `<button class="text-button" data-resume="${g.id}">Check result</button>` : ''}<button class="text-button" data-delete-generation="${g.id}" ${g.status === 'pending' ? 'disabled' : ''}>Delete from gallery</button></div></article>`;
}
async function referenceSheet(photos, titles) {
  const images = await Promise.all(photos.map(photo => new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('Cannot read a reference image.')); img.src = photo.data; })));
  const canvas = document.createElement('canvas');
  canvas.width = images.length === 1 ? 768 : 1536; canvas.height = images.length === 3 ? 1536 : 1024;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const columns = images.length === 1 ? 1 : 2; const cellW = canvas.width / columns; const cellH = canvas.height / Math.ceil(images.length / columns);
  images.forEach((img, i) => {
    const x = (i % columns) * cellW, y = Math.floor(i / columns) * cellH;
    ctx.fillStyle = '#222'; ctx.font = '24px sans-serif'; ctx.fillText(titles[i], x + 16, y + 32);
    const scale = Math.min((cellW - 24) / img.width, (cellH - 65) / img.height);
    const w = img.width * scale, h = img.height * scale;
    ctx.drawImage(img, x + (cellW - w) / 2, y + 50 + (cellH - 65 - h) / 2, w, h);
  });
  return canvas.toDataURL('image/png');
}
async function resumeGeneration(id) {
  if (generationBusy) return;
  const generation = state.generations.find(g => g.id === id); if (!generation || generation.status !== 'pending') return;
  generationBusy = true; $('#generate-photo').disabled = true;
  const started = Date.now();
  try {
    while (Date.now() - started < 30 * 60 * 1000) {
      $('#generation-progress').textContent = 'Tracking your portrait. You can keep editing while it runs.';
      const result = await api(`/api/jobs/${id}`);
      showPortraitProgress(result);
      if (result.status === 'failed') { generation.status = 'failed'; generation.error = result.error; await persist(); renderGallery(); throw new Error(result.error); }
      if (result.status === 'complete') {
        generation.status = 'complete'; generation.images = result.images;
        $('#generated-result').innerHTML = `<img class="result-image" src="${result.images[0]}" alt="Generated wedding portrait"><a class="text-button" href="${result.images[0]}" download="jodi-${id}.png">Download portrait ↓</a><p>Review both faces against your saved references.</p>`;
        try { await persist(); } catch { toast('Portrait is ready, but browser storage is full. Download it now to keep it.'); }
        renderGallery(); $('#generation-progress').textContent = 'Portrait ready. Review facial likeness before using it.'; return;
      }
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    $('#generation-progress').textContent = 'Still waiting. Use “Check result” in the gallery to continue; the server job has not been cancelled.';
  } catch (err) { $('#generation-progress').textContent = err.message + (generation.status === 'pending' ? ' Use “Check result” in the gallery to retry tracking.' : ''); }
  finally { generationBusy = false; renderGallery(); checkService(); }
}
$('#check-service').addEventListener('click', checkService);
$('#generate-photo').addEventListener('click', async () => {
  if (generationBusy) return;
  const missing = roles.find(role => !state.profiles[role].photos.length);
  if (missing) { editProfile(missing); toast('Add face references for both people first.'); return; }
  generationBusy = true; $('#generate-photo').disabled = true;
  $('#generation-progress').textContent = 'Preparing identity and outfit references…';
  showPortraitProgress({ status: 'pending', progress: { stage: 'Preparing reference images' } });
  let jobID;
  try {
    for (const key of ['setting', 'pose', 'notes', 'ratio']) state[key] = $(`#${key}`).value;
    const brief = makeBrief();
    const sheets = await Promise.all(roles.map(role => referenceSheet(brief.profiles[role].photos, brief.profiles[role].photos.map((_, i) => `${labels[role].toUpperCase()} — reference ${i + 1}`))));
    const outfitRoles = roles.filter(role => brief.outfits[role]);
    if (outfitRoles.length) sheets.push(await referenceSheet(outfitRoles.map(role => brief.outfits[role]), outfitRoles.map(role => `${labels[role].toUpperCase()} OUTFIT`)));
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    const result = await api('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: brief.prompt, ratio: brief.ratio, seed, references: sheets }) });
    jobID = result.id;
    state.generations.unshift({ id: jobID, status: 'pending', seed, occasion: brief.occasion, setting: brief.setting, createdAt: new Date().toISOString(), prompt: brief.prompt, references: Object.fromEntries(roles.map(role => [role, brief.profiles[role].photos[0].data])) });
    try { await persist(); } catch { toast('Job queued, but browser storage is unavailable. Keep this page open until the portrait is ready.'); }
    renderGallery();
  } catch (err) { $('#generation-progress').textContent = err.message; }
  finally { generationBusy = false; if (jobID) resumeGeneration(jobID); else checkService(); }
});

// Recheck while models are being installed so generation becomes available automatically.
setInterval(() => { if (!document.hidden && !generationBusy) checkService(); }, 30000);


let checkingDownloads = false;
async function refreshDownloads() {
  if (checkingDownloads) return;
  checkingDownloads = true;
  const panel = $('#model-downloads');
  try {
    const result = await api('/api/downloads');
    const gb = n => (n / 1e9).toFixed(2) + ' GB';
    const percent = (n, total) => Math.floor(n / total * 100);
    panel.innerHTML = `<div class="download-heading"><strong>${result.complete ? 'Models installed' : 'Downloading models'}</strong><b>${percent(result.downloadedBytes, result.totalBytes)}%</b></div><progress aria-label="Total model download" max="${result.totalBytes}" value="${result.downloadedBytes}"></progress><p>${gb(result.downloadedBytes)} of ${gb(result.totalBytes)}</p>${result.models.map(model => `<div class="model-progress"><div><span>${escapeHTML(model.label)}</span><span>${percent(model.downloadedBytes, model.totalBytes)}%</span></div><progress aria-label="${escapeHTML(model.label)} download" max="${model.totalBytes}" value="${model.downloadedBytes}"></progress><small>${gb(model.downloadedBytes)} / ${gb(model.totalBytes)} · ${escapeHTML(model.status)}</small></div>`).join('')}<small class="download-updated">${result.complete ? 'All files installed. Checking service readiness separately.' : 'Updates every 5 seconds · Verification follows download.'}</small>`;
  } catch (err) { panel.textContent = 'Download progress unavailable. Retrying automatically…'; }
  finally { checkingDownloads = false; }
}
refreshDownloads();
setInterval(() => { if (!document.hidden) refreshDownloads(); }, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshDownloads(); });


function showPortraitProgress(result) {
  const panel = $('#portrait-progress'), bar = $('#portrait-bar');
  panel.hidden = false;
  const progress = result.progress || {};
  const complete = result.status === 'complete';
  const known = Number.isFinite(progress.value) && Number.isFinite(progress.max) && progress.max > 0;
  const stepValue = known ? Math.min(progress.max, Math.max(0, progress.value)) : 0;
  const percentage = known ? (stepValue / progress.max * 100).toFixed(2).replace(/\.?0+$/, '') : null;
  $('#portrait-stage').textContent = complete ? 'Portrait ready' : result.status === 'failed' ? 'Generation failed' : progress.stage || 'Processing portrait';
  if (complete || known) { bar.max = complete ? 100 : progress.max; bar.value = complete ? 100 : stepValue; }
  else bar.removeAttribute('value');
  bar.hidden = result.status === 'failed';
  $('#portrait-percent').textContent = complete ? '100%' : known ? percentage + '%' : result.status === 'failed' ? 'Stopped' : 'Measuring…';
  const elapsed = Number.isFinite(progress.elapsedSeconds) ? ` · ${Math.floor(progress.elapsedSeconds / 60)}m ${progress.elapsedSeconds % 60}s elapsed` : '';
  $('#portrait-detail').textContent = complete ? 'Image saved. Review both faces.' : result.status === 'failed' ? result.error : known ? `${stepValue} ÷ ${progress.max} steps = ${percentage}%${elapsed}. This measures generation steps, not total time; decoding and saving follow.` : `${progress.node === '9' ? 'Waiting for the next completed generation step.' : 'Waiting for measured step progress.'}${elapsed} CPU processing may take a long time.`;
}

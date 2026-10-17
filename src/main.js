import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDFDocument } from 'pdf-lib';
import { buildPdf, listFields } from './export.js';
import { displaySize, totalRotation } from './geometry.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const $ = (s) => document.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 10);
const CSS_FONTS = {
  Helvetica: 'Helvetica, Arial, "Liberation Sans", sans-serif',
  Times: '"Times New Roman", Times, "Liberation Serif", serif',
  Courier: '"Courier New", Courier, "Liberation Mono", monospace',
};
const BOX_TYPES = ['highlight', 'rect', 'whiteout', 'redact'];

/*
 * Page entry: { id, srcId (null = blank page), srcIndex, origRot, rot, view: [x0,y0,x1,y1], annots: [] }
 * Annotations are stored in display space: PDF points, top-left origin, page as currently shown.
 */
const state = {
  sources: new Map(), // id -> { id, name, bytes, pdf, fields, formValues }
  pages: [],
  zoom: 1.25,
  tool: 'select',
  selected: null, // { pageId, annotId }
  selectedPages: new Set(),
  currentPageId: null,
  undo: [],
  redo: [],
  fileName: 'document.pdf',
  pendingImage: null, // { src, w, h } waiting to be placed
};

// ---------- helpers ----------

let toastTimer;
function toast(msg, ms = 2600) {
  const el = $('#status');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

const pageById = (id) => state.pages.find((p) => p.id === id);
const pageEl = (p) => document.querySelector(`.page[data-id="${p.id}"]`);
const style = () => ({
  color: $('#color').value,
  size: Math.max(4, +$('#size').value || 16),
  width: Math.max(0.5, +$('#stroke').value || 2),
  font: $('#font').value,
});

function drag(onMove, onUp) {
  const up = (e) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', up);
    onUp(e);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', up);
}

// ---------- history ----------

const snapshot = () => JSON.stringify(state.pages);
function pushUndo(before) {
  state.undo.push(before);
  if (state.undo.length > 100) state.undo.shift();
  state.redo = [];
}
const checkpoint = () => pushUndo(snapshot());

function restore(from, to) {
  if (!from.length) return;
  to.push(snapshot());
  state.pages = JSON.parse(from.pop());
  state.selected = null;
  state.selectedPages = new Set([...state.selectedPages].filter(pageById));
  renderAll();
}
const undo = () => restore(state.undo, state.redo);
const redo = () => restore(state.redo, state.undo);

// ---------- loading ----------

async function loadPdf(data, name, append) {
  const bytes = new Uint8Array(data);
  let pdf;
  try {
    // pdf.js transfers the buffer to its worker, so hand it a copy.
    pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  } catch (e) {
    toast(e?.name === 'PasswordException'
      ? `${name} is password-protected; remove the password first.`
      : `Could not open ${name}: ${e.message}`, 5000);
    return;
  }
  let fields = [];
  try { fields = listFields(await PDFDocument.load(bytes, { ignoreEncryption: true })); } catch { /* no form */ }

  const id = uid();
  const pages = [];
  for (let i = 0; i < pdf.numPages; i++) {
    const pg = await pdf.getPage(i + 1);
    pages.push({ id: uid(), srcId: id, srcIndex: i, origRot: pg.rotate, rot: 0, view: [...pg.view], annots: [] });
  }

  if (append && state.pages.length) {
    checkpoint();
  } else {
    for (const s of state.sources.values()) s.pdf.destroy();
    state.sources.clear();
    state.pages = [];
    state.undo = [];
    state.redo = [];
    state.selected = null;
    state.selectedPages.clear();
    state.fileName = name;
    $('#viewer').scrollTop = 0;
  }
  state.sources.set(id, { id, name, bytes, pdf, fields, formValues: {} });
  state.pages.push(...pages);
  state.currentPageId ??= pages[0]?.id;
  if (!pageById(state.currentPageId)) state.currentPageId = pages[0]?.id;
  document.title = `${state.fileName} — Folio PDF`;
  renderAll();
  if (append) toast(`Added ${pdf.numPages} page(s) from ${name}`);
  if (fields.length) toast(`This PDF has ${fields.length} form field(s) — use Forms to fill them.`, 4000);
}

async function loadFiles(files, append) {
  for (const f of files) {
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') {
      toast(`${f.name} is not a PDF`);
      continue;
    }
    await loadPdf(await f.arrayBuffer(), f.name, append || state.pages.length > 0);
  }
}

// ---------- rendering ----------

const observer = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) drawCanvas(e.target);
}, { rootMargin: '600px' });

async function drawCanvas(el) {
  const p = el._page;
  const scale = el._scale;
  const canvas = el.querySelector('canvas');
  const R = totalRotation(p);
  const key = `${R}@${scale}`;
  if (canvas.dataset.key === key) return;
  canvas.dataset.key = key;
  canvas._task?.cancel();

  const { w, h } = displaySize(p);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * scale * dpr);
  canvas.height = Math.round(h * scale * dpr);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const src = state.sources.get(p.srcId);
  if (!src) return;
  const pg = await src.pdf.getPage(p.srcIndex + 1);
  const task = pg.render({ canvasContext: ctx, viewport: pg.getViewport({ scale: scale * dpr, rotation: R }) });
  canvas._task = task;
  try {
    await task.promise;
  } catch (e) {
    if (e?.name !== 'RenderingCancelledException') console.error(e);
  }
}

function renderAll() {
  observer.disconnect();
  renderPages();
  renderThumbs();
  $('#zoom-label').textContent = `${Math.round(state.zoom * 100)}%`;
}

function renderPages() {
  const wrap = $('#pages');
  wrap.innerHTML = '';
  $('#empty').hidden = state.pages.length > 0;
  for (const p of state.pages) {
    const { w, h } = displaySize(p);
    const el = document.createElement('div');
    el.className = 'page';
    el.dataset.id = p.id;
    el.style.width = `${w * state.zoom}px`;
    el.style.height = `${h * state.zoom}px`;
    el._page = p;
    el._scale = state.zoom;
    el.innerHTML = '<canvas></canvas><div class="overlay"></div>';
    el.querySelector('.overlay').addEventListener('pointerdown', (e) => onOverlayDown(e, p));
    wrap.appendChild(el);
    renderAnnots(p);
    observer.observe(el);
  }
}

function renderAnnots(p) {
  const ov = pageEl(p)?.querySelector('.overlay');
  if (!ov) return;
  ov.querySelectorAll('.annot').forEach((n) => n.remove());
  for (const a of p.annots) ov.appendChild(annotEl(p, a));
}

function annotEl(p, a) {
  const z = state.zoom;
  const el = document.createElement('div');
  el.className = `annot ${a.type}`;
  el.dataset.id = a.id;
  el.style.left = `${a.x * z}px`;
  el.style.top = `${a.y * z}px`;
  if (a.type === 'text') {
    el.textContent = a.text;
    el.style.fontSize = `${a.size * z}px`;
    el.style.color = a.color;
    el.style.fontFamily = CSS_FONTS[a.font];
  } else {
    el.style.width = `${a.w * z}px`;
    el.style.height = `${a.h * z}px`;
  }
  if (a.type === 'highlight') el.style.background = a.color;
  if (a.type === 'whiteout') el.style.background = '#fff';
  if (a.type === 'redact') el.style.background = '#000';
  if (a.type === 'rect') el.style.outline = `${a.width * z}px solid ${a.color}`;
  if (a.type === 'rect') el.style.outlineOffset = `${(-a.width * z) / 2}px`;
  if (a.type === 'image') {
    const img = document.createElement('img');
    img.src = a.src;
    img.draggable = false;
    el.appendChild(img);
  }
  if (a.type === 'ink') {
    const d = a.pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ') + (a.pts.length === 1 ? ' l0.01 0' : '');
    el.innerHTML = `<svg viewBox="0 0 ${a.vw} ${a.vh}" preserveAspectRatio="none"><path d="${d}" fill="none"
      stroke="${a.color}" stroke-width="${a.width * z}" stroke-linecap="round" stroke-linejoin="round"
      vector-effect="non-scaling-stroke"/></svg>`;
  }
  const sel = state.selected;
  if (sel && sel.pageId === p.id && sel.annotId === a.id) {
    el.classList.add('selected');
    if (a.type === 'rect') el.style.outline = `${a.width * z}px solid ${a.color}`;
    const handle = document.createElement('div');
    handle.className = 'handle';
    el.appendChild(handle);
  }
  el.addEventListener('pointerdown', (e) => onAnnotDown(e, p, a));
  if (a.type === 'text') el.addEventListener('dblclick', () => editText(p, a, el, snapshot()));
  return el;
}

function renderThumbs() {
  const box = $('#thumbs');
  box.innerHTML = '';
  state.pages.forEach((p, i) => {
    const { w, h } = displaySize(p);
    const scale = Math.min(140 / w, 180 / h);
    const el = document.createElement('div');
    el.className = 'thumb';
    el.draggable = true;
    el.dataset.id = p.id;
    el._page = p;
    el._scale = scale;
    el.innerHTML = `<canvas style="width:${w * scale}px;height:${h * scale}px"></canvas><div class="num">${i + 1}</div>`;
    el.addEventListener('click', (e) => onThumbClick(e, p));
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/x-page', p.id);
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragover', (e) => {
      if (!e.dataTransfer.types.includes('text/x-page')) return;
      e.preventDefault();
      el.classList.add('drop-before');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-before'));
    el.addEventListener('drop', (e) => {
      if (!e.dataTransfer.types.includes('text/x-page')) return;
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('drop-before');
      movePages(e.dataTransfer.getData('text/x-page'), p.id);
    });
    box.appendChild(el);
    observer.observe(el);
  });
  updateThumbClasses();
}

function updateThumbClasses() {
  document.querySelectorAll('.thumb').forEach((el) => {
    el.classList.toggle('selected', state.selectedPages.has(el.dataset.id));
    el.classList.toggle('current', el.dataset.id === state.currentPageId);
  });
}

// ---------- selection & annotations ----------

function setSelected(p, a) {
  const old = state.selected;
  const next = a ? { pageId: p.id, annotId: a.id } : null;
  if (old?.pageId === next?.pageId && old?.annotId === next?.annotId) return;
  state.selected = next;
  if (old && pageById(old.pageId)) renderAnnots(pageById(old.pageId));
  if (next) {
    renderAnnots(p);
    syncToolbar(a);
  }
}

function selectedAnnot() {
  const s = state.selected;
  const p = s && pageById(s.pageId);
  const a = p?.annots.find((x) => x.id === s.annotId);
  return a ? { p, a } : null;
}

function syncToolbar(a) {
  if (a.color) $('#color').value = a.color;
  if (a.size) $('#size').value = Math.round(a.size);
  if (a.width) $('#stroke').value = a.width;
  if (a.font) $('#font').value = a.font;
}

function deleteSelected() {
  const s = selectedAnnot();
  if (!s) return;
  checkpoint();
  s.p.annots = s.p.annots.filter((x) => x !== s.a);
  state.selected = null;
  renderAnnots(s.p);
}

function editText(p, a, el, before) {
  el.classList.add('editing');
  el.contentEditable = 'plaintext-only';
  el.querySelector('.handle')?.remove();
  setTimeout(() => {
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  el.addEventListener('blur', () => {
    const text = el.innerText.replace(/\n$/, '');
    if (!text.trim()) {
      p.annots = p.annots.filter((x) => x !== a);
      if (state.selected?.annotId === a.id) state.selected = null;
      if (before !== snapshot()) pushUndo(before);
    } else if (text !== a.text) {
      a.text = text;
      pushUndo(before);
    }
    renderAnnots(p);
  }, { once: true });
}

function onAnnotDown(e, p, a) {
  if (state.tool !== 'select' || e.currentTarget.classList.contains('editing') || e.button !== 0) return;
  e.stopPropagation();
  e.preventDefault();
  setCurrentPage(p.id);
  setSelected(p, a);
  const z = state.zoom;
  const resizing = e.target.classList.contains('handle');
  const start = { x: e.clientX, y: e.clientY, ax: a.x, ay: a.y, aw: a.w, ah: a.h, size: a.size };
  const lines = a.type === 'text' ? a.text.split('\n').length : 1;
  let moved = false;
  drag((ev) => {
    const dx = (ev.clientX - start.x) / z;
    const dy = (ev.clientY - start.y) / z;
    if (!moved) {
      if (Math.abs(dx) + Math.abs(dy) < 2 / z) return;
      checkpoint();
      moved = true;
    }
    if (!resizing) {
      a.x = start.ax + dx;
      a.y = start.ay + dy;
    } else if (a.type === 'text') {
      a.size = Math.max(4, start.size + dy / (1.2 * lines));
    } else if (a.type === 'image' && !ev.shiftKey) {
      a.w = Math.max(8, start.aw + dx);
      a.h = (a.w * start.ah) / start.aw;
    } else {
      a.w = Math.max(3, start.aw + dx);
      a.h = Math.max(3, start.ah + dy);
    }
    renderAnnots(p);
  }, () => moved && syncToolbar(a));
}

function onOverlayDown(e, p) {
  if (e.button !== 0) return;
  const ov = e.currentTarget;
  const r = ov.getBoundingClientRect();
  const z = state.zoom;
  const pt = (ev) => ({ x: (ev.clientX - r.left) / z, y: (ev.clientY - r.top) / z });
  const s = pt(e);
  const st = style();
  setCurrentPage(p.id);

  if (state.pendingImage) {
    const { src, w, h } = state.pendingImage;
    const a = { id: uid(), type: 'image', src, w, h, x: s.x - w / 2, y: s.y - h / 2 };
    checkpoint();
    p.annots.push(a);
    state.pendingImage = null;
    setTool('select');
    setSelected(p, a);
    renderAnnots(p);
    return;
  }
  if (state.tool === 'select') {
    setSelected(null);
    return;
  }
  e.preventDefault();

  if (state.tool === 'text') {
    const before = snapshot();
    const a = { id: uid(), type: 'text', x: s.x, y: s.y - st.size * 0.6, text: '', size: st.size, color: st.color, font: st.font };
    p.annots.push(a);
    renderAnnots(p);
    editText(p, a, ov.querySelector(`[data-id="${a.id}"]`), before);
    return;
  }

  if (BOX_TYPES.includes(state.tool)) {
    const before = snapshot();
    const a = { id: uid(), type: state.tool, x: s.x, y: s.y, w: 0, h: 0, color: st.color, width: st.width };
    if (a.type === 'highlight' && st.color === '#d0021b') a.color = '#ffe14d';
    p.annots.push(a);
    drag((ev) => {
      const q = pt(ev);
      a.x = Math.min(s.x, q.x);
      a.y = Math.min(s.y, q.y);
      a.w = Math.abs(q.x - s.x);
      a.h = Math.abs(q.y - s.y);
      renderAnnots(p);
    }, () => {
      if (a.w < 3 || a.h < 3) p.annots = p.annots.filter((x) => x !== a);
      else pushUndo(before);
      renderAnnots(p);
    });
    return;
  }

  if (state.tool === 'draw') {
    const { w, h } = displaySize(p);
    const pts = [[s.x, s.y]];
    ov.insertAdjacentHTML('beforeend', `<svg class="live" viewBox="0 0 ${w} ${h}"
      style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none"><path fill="none"
      stroke="${st.color}" stroke-width="${st.width}" stroke-linecap="round" stroke-linejoin="round"/></svg>`);
    const svg = ov.lastElementChild;
    const path = svg.querySelector('path');
    const update = () => path.setAttribute('d', pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' '));
    update();
    drag((ev) => {
      const q = pt(ev);
      pts.push([q.x, q.y]);
      update();
    }, () => {
      svg.remove();
      const xs = pts.map((q) => q[0]);
      const ys = pts.map((q) => q[1]);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      const bw = Math.max(1, Math.max(...xs) - x);
      const bh = Math.max(1, Math.max(...ys) - y);
      checkpoint();
      p.annots.push({
        id: uid(), type: 'ink', x, y, w: bw, h: bh, vw: bw, vh: bh,
        pts: pts.map(([px, py]) => [px - x, py - y]), color: st.color, width: st.width,
      });
      renderAnnots(p);
    });
  }
}

function applyStyleToSelected(key) {
  const s = selectedAnnot();
  if (!s) return;
  const st = style();
  const a = s.a;
  const applies = {
    color: ['text', 'ink', 'rect', 'highlight'],
    size: ['text'],
    width: ['ink', 'rect'],
    font: ['text'],
  }[key];
  if (!applies.includes(a.type)) return;
  checkpoint();
  a[key] = st[key];
  renderAnnots(s.p);
}

// ---------- tools ----------

function setTool(tool) {
  state.tool = tool;
  if (tool !== 'place') state.pendingImage = null;
  document.body.className = `tool-${tool}`;
  document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
  if (tool !== 'select') setSelected(null);
}

function startPlacing(src, maxW) {
  const img = new Image();
  img.onload = () => {
    const scale = Math.min(1, maxW / img.naturalWidth);
    state.pendingImage = { src, w: img.naturalWidth * scale, h: img.naturalHeight * scale };
    setTool('place');
    toast('Click on a page to place it (Esc to cancel)');
  };
  img.src = src;
}

/** Re-encode any image as PNG (or keep JPEG) so pdf-lib can embed it. */
function normalizeImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL(file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.92));
    };
    img.onerror = () => reject(new Error('Unsupported image'));
    img.src = url;
  });
}

// ---------- page operations ----------

function targetPages() {
  const list = state.pages.filter((p) => state.selectedPages.has(p.id));
  if (list.length) return list;
  const cur = pageById(state.currentPageId);
  return cur ? [cur] : [];
}

function setCurrentPage(id) {
  if (state.currentPageId === id) return;
  state.currentPageId = id;
  updateThumbClasses();
}

function onThumbClick(e, p) {
  if (e.ctrlKey || e.metaKey) {
    state.selectedPages.has(p.id) ? state.selectedPages.delete(p.id) : state.selectedPages.add(p.id);
  } else if (e.shiftKey && state.currentPageId) {
    const a = state.pages.findIndex((x) => x.id === state.currentPageId);
    const b = state.pages.indexOf(p);
    state.selectedPages = new Set(state.pages.slice(Math.min(a, b), Math.max(a, b) + 1).map((x) => x.id));
  } else {
    state.selectedPages = new Set([p.id]);
  }
  state.currentPageId = p.id;
  updateThumbClasses();
  pageEl(p)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function movePages(dragId, beforeId) {
  const moving = state.selectedPages.has(dragId)
    ? state.pages.filter((p) => state.selectedPages.has(p.id))
    : [pageById(dragId)];
  if (!moving[0] || moving.some((p) => p.id === beforeId)) return;
  checkpoint();
  const rest = state.pages.filter((p) => !moving.includes(p));
  const idx = beforeId ? rest.findIndex((p) => p.id === beforeId) : rest.length;
  rest.splice(idx, 0, ...moving);
  state.pages = rest;
  renderAll();
}

/** Rotate a page 90° clockwise, carrying its annotations along. */
function rotateCW(p) {
  const { h: H } = displaySize(p);
  for (const a of p.annots) {
    if (a.type === 'ink') {
      const sx = a.w / a.vw;
      const sy = a.h / a.vh;
      const abs = a.pts.map(([x, y]) => [H - (a.y + y * sy), a.x + x * sx]);
      const xs = abs.map((q) => q[0]);
      const ys = abs.map((q) => q[1]);
      a.x = Math.min(...xs);
      a.y = Math.min(...ys);
      a.w = a.vw = Math.max(1, Math.max(...xs) - a.x);
      a.h = a.vh = Math.max(1, Math.max(...ys) - a.y);
      a.pts = abs.map(([x, y]) => [x - a.x, y - a.y]);
    } else if (a.type === 'text') {
      [a.x, a.y] = [H - a.y - a.size, a.x];
    } else if (a.type === 'image') {
      const cx = a.x + a.w / 2;
      const cy = a.y + a.h / 2;
      a.x = H - cy - a.w / 2;
      a.y = cx - a.h / 2;
    } else {
      [a.x, a.y, a.w, a.h] = [H - (a.y + a.h), a.x, a.h, a.w];
    }
  }
  p.rot = (p.rot + 90) % 360;
}

function rotatePages(dir) {
  const list = targetPages();
  if (!list.length) return;
  checkpoint();
  for (const p of list) for (let i = 0; i < (dir > 0 ? 1 : 3); i++) rotateCW(p);
  renderAll();
}

function deletePages() {
  const list = targetPages();
  if (!list.length) return;
  checkpoint();
  state.pages = state.pages.filter((p) => !list.includes(p));
  state.selectedPages.clear();
  state.currentPageId = state.pages[0]?.id ?? null;
  state.selected = null;
  renderAll();
  toast(`Deleted ${list.length} page(s) — Ctrl+Z to undo`);
}

function duplicatePages() {
  const list = targetPages();
  if (!list.length) return;
  checkpoint();
  for (const p of list) {
    const copy = JSON.parse(JSON.stringify(p));
    copy.id = uid();
    copy.annots.forEach((a) => (a.id = uid()));
    state.pages.splice(state.pages.indexOf(p) + 1, 0, copy);
  }
  renderAll();
}

function insertBlank() {
  const ref = targetPages().at(-1);
  const { w, h } = ref ? displaySize(ref) : { w: 612, h: 792 };
  checkpoint();
  const blank = { id: uid(), srcId: null, srcIndex: 0, origRot: 0, rot: 0, view: [0, 0, w, h], annots: [] };
  state.pages.splice(ref ? state.pages.indexOf(ref) + 1 : state.pages.length, 0, blank);
  state.currentPageId = blank.id;
  renderAll();
  pageEl(blank)?.scrollIntoView({ block: 'start' });
}

// ---------- saving ----------

const baseName = () => state.fileName.replace(/\.pdf$/i, '');

async function saveBytes(name, bytes) {
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: name,
        types: [{ description: 'PDF document', accept: { 'application/pdf': ['.pdf'] } }],
      });
      const w = await handle.createWritable();
      await w.write(bytes);
      await w.close();
      return true;
    } catch (e) {
      if (e.name === 'AbortError') return false;
    }
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return true;
}

async function exportPages(pages, opts) {
  document.activeElement?.blur(); // commit any text being edited
  toast('Building PDF…', 60000);
  try {
    return await buildPdf(state.sources, pages, opts);
  } catch (e) {
    console.error(e);
    toast(`Export failed: ${e.message}`, 6000);
    return null;
  }
}

async function extractPages() {
  const list = targetPages();
  if (!list.length) return toast('Select pages to extract first');
  const bytes = await exportPages(list);
  if (bytes && (await saveBytes(`${baseName()}-extract.pdf`, bytes))) toast('Saved extracted pages');
}

async function splitPages() {
  if (!state.pages.length) return;
  let dir = null;
  if (window.showDirectoryPicker) {
    try {
      dir = await window.showDirectoryPicker({ mode: 'readwrite' });
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  const pad = String(state.pages.length).length;
  for (const [i, p] of state.pages.entries()) {
    const bytes = await exportPages([p]);
    if (!bytes) return;
    const name = `${baseName()}-p${String(i + 1).padStart(pad, '0')}.pdf`;
    if (dir) {
      const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
      await w.write(bytes);
      await w.close();
    } else {
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      Object.assign(document.createElement('a'), { href: url, download: name }).click();
    }
  }
  toast(`Split into ${state.pages.length} file(s)`);
}

function openSaveDialog() {
  if (!state.pages.length) return toast('Open a PDF first');
  $('#save-name').value = state.fileName;
  $('#dlg-save').showModal();
}

async function doSave() {
  $('#dlg-save').close();
  let name = $('#save-name').value.trim() || 'document.pdf';
  if (!/\.pdf$/i.test(name)) name += '.pdf';
  const bytes = await exportPages(state.pages, {
    title: $('#save-title').value.trim(),
    author: $('#save-author').value.trim(),
    pageNumbers: $('#save-numbers').checked,
    watermark: $('#save-watermark').value.trim(),
  });
  if (bytes && (await saveBytes(name, bytes))) {
    state.fileName = name;
    toast(`Saved ${name}`);
  }
}

// ---------- forms ----------

function openForms() {
  const list = $('#form-list');
  list.innerHTML = '';
  const sources = [...state.sources.values()].filter((s) => s.fields.length);
  if (!sources.length) {
    list.innerHTML = '<p>No fillable form fields in the open documents.</p>';
  }
  for (const s of sources) {
    const h = document.createElement('h3');
    h.textContent = s.name;
    list.appendChild(h);
    for (const f of s.fields) {
      const label = document.createElement('label');
      const span = document.createElement('span');
      span.textContent = f.name;
      span.title = f.name;
      let input;
      const value = s.formValues[f.name] ?? f.value;
      if (f.type === 'checkbox') {
        input = Object.assign(document.createElement('input'), { type: 'checkbox', checked: !!value });
        input.onchange = () => (s.formValues[f.name] = input.checked);
      } else if (f.type === 'choice') {
        input = document.createElement('select');
        for (const o of ['', ...f.options]) input.add(new Option(o, o, false, o === value));
        input.onchange = () => (s.formValues[f.name] = input.value);
      } else {
        input = Object.assign(document.createElement('input'), { value });
        input.oninput = () => (s.formValues[f.name] = input.value);
      }
      label.append(span, input);
      list.appendChild(label);
    }
  }
  $('#dlg-forms').showModal();
}

// ---------- signature pad ----------

function setupSignaturePad() {
  const pad = $('#sign-pad');
  const ctx = pad.getContext('2d');
  const clear = () => ctx.clearRect(0, 0, pad.width, pad.height);
  pad.addEventListener('pointerdown', (e) => {
    const r = pad.getBoundingClientRect();
    const pos = (ev) => [((ev.clientX - r.left) * pad.width) / r.width, ((ev.clientY - r.top) * pad.height) / r.height];
    ctx.lineWidth = 3;
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111';
    ctx.beginPath();
    ctx.moveTo(...pos(e));
    drag((ev) => {
      ctx.lineTo(...pos(ev));
      ctx.stroke();
    }, () => {});
  });
  $('#sign-clear').onclick = clear;
  $('#sign-cancel').onclick = () => $('#dlg-sign').close();
  $('#btn-sign').onclick = () => {
    clear();
    $('#dlg-sign').showModal();
  };
  $('#sign-ok').onclick = () => {
    // Crop to the inked area.
    const { data, width, height } = ctx.getImageData(0, 0, pad.width, pad.height);
    let x0 = width, y0 = height, x1 = -1, y1 = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3]) {
          x0 = Math.min(x0, x); x1 = Math.max(x1, x);
          y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        }
      }
    }
    if (x1 < 0) return toast('Draw a signature first');
    const out = document.createElement('canvas');
    out.width = x1 - x0 + 9;
    out.height = y1 - y0 + 9;
    out.getContext('2d').drawImage(pad, x0 - 4, y0 - 4, out.width, out.height, 0, 0, out.width, out.height);
    $('#dlg-sign').close();
    startPlacing(out.toDataURL('image/png'), 180);
  };
}

// ---------- zoom ----------

function setZoom(z) {
  const v = $('#viewer');
  const ratio = v.scrollTop / Math.max(1, v.scrollHeight);
  state.zoom = Math.min(4, Math.max(0.25, Math.round(z * 100) / 100));
  renderAll();
  v.scrollTop = ratio * v.scrollHeight;
}

// ---------- wiring ----------

function wire() {
  $('#btn-open').onclick = $('#btn-open-2').onclick = () => $('#file-open').click();
  $('#btn-add').onclick = () => $('#file-add').click();
  $('#file-open').onchange = async (e) => {
    const [f] = e.target.files;
    if (f) await loadPdf(await f.arrayBuffer(), f.name, false);
    e.target.value = '';
  };
  $('#file-add').onchange = async (e) => {
    await loadFiles([...e.target.files], true);
    e.target.value = '';
  };
  $('#btn-image').onclick = () => {
    if (!state.pages.length) return toast('Open a PDF first');
    $('#file-image').click();
  };
  $('#file-image').onchange = async (e) => {
    const [f] = e.target.files;
    e.target.value = '';
    if (!f) return;
    try {
      startPlacing(await normalizeImage(f), 250);
    } catch (err) {
      toast(err.message);
    }
  };

  document.querySelectorAll('[data-tool]').forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
  $('#color').onchange = () => applyStyleToSelected('color');
  $('#size').onchange = () => applyStyleToSelected('size');
  $('#stroke').onchange = () => applyStyleToSelected('width');
  $('#font').onchange = () => applyStyleToSelected('font');
  $('#btn-delete').onclick = deleteSelected;
  $('#btn-undo').onclick = undo;
  $('#btn-redo').onclick = redo;
  $('#btn-forms').onclick = openForms;
  $('#forms-close').onclick = () => $('#dlg-forms').close();
  $('#btn-zoom-in').onclick = () => setZoom(state.zoom * 1.2);
  $('#btn-zoom-out').onclick = () => setZoom(state.zoom / 1.2);
  $('#btn-save').onclick = openSaveDialog;
  $('#save-ok').onclick = doSave;
  $('#save-cancel').onclick = () => $('#dlg-save').close();
  $('#dlg-save').addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), doSave()));

  $('#pg-rotl').onclick = () => rotatePages(-1);
  $('#pg-rotr').onclick = () => rotatePages(1);
  $('#pg-dup').onclick = duplicatePages;
  $('#pg-blank').onclick = insertBlank;
  $('#pg-del').onclick = deletePages;
  $('#pg-extract').onclick = extractPages;
  $('#pg-split').onclick = splitPages;

  // Dropping a page on empty sidebar space moves it to the end.
  $('#thumbs').addEventListener('dragover', (e) => e.dataTransfer.types.includes('text/x-page') && e.preventDefault());
  $('#thumbs').addEventListener('drop', (e) => {
    if (!e.dataTransfer.types.includes('text/x-page')) return;
    e.preventDefault();
    e.stopPropagation();
    movePages(e.dataTransfer.getData('text/x-page'), null);
  });

  // Dropping files anywhere opens them (or appends if a document is open).
  window.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    document.body.classList.add('drag-over');
  });
  window.addEventListener('dragleave', (e) => !e.relatedTarget && document.body.classList.remove('drag-over'));
  window.addEventListener('drop', (e) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    document.body.classList.remove('drag-over');
    loadFiles([...e.dataTransfer.files], false);
  });

  // Track the page in view.
  let ticking = false;
  $('#viewer').addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const top = $('#viewer').getBoundingClientRect().top + 80;
      const el = [...document.querySelectorAll('.page')].find((n) => n.getBoundingClientRect().bottom > top);
      if (el) setCurrentPage(el.dataset.id);
    });
  });
  $('#viewer').addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    setZoom(state.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    const t = e.target;
    const typing = t.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName);
    if (e.key === 'Escape') {
      if (t.isContentEditable) return t.blur();
      setTool('select');
      setSelected(null);
      return;
    }
    if (typing || document.querySelector('dialog[open]')) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === 'o') { e.preventDefault(); $('#file-open').click(); }
    else if (mod && key === 's') { e.preventDefault(); openSaveDialog(); }
    else if (mod && key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    else if (mod && (key === '=' || key === '+')) { e.preventDefault(); setZoom(state.zoom * 1.2); }
    else if (mod && key === '-') { e.preventDefault(); setZoom(state.zoom / 1.2); }
    else if (key === 'delete' || key === 'backspace') { e.preventDefault(); deleteSelected(); }
    else if (!mod) {
      const tool = { v: 'select', t: 'text', d: 'draw', h: 'highlight', r: 'rect', w: 'whiteout' }[key];
      if (tool) setTool(tool);
    }
  });

  setupSignaturePad();
}

wire();
renderAll();

// Desktop (Electron) integration: open a file passed on the command line / "Open with".
if (window.folioDesktop) {
  window.folioDesktop.initialFile().then((f) => f && loadPdf(f.data, f.name, false));
  window.folioDesktop.onOpenFile((f) => loadPdf(f.data, f.name, false));
}

// Shared helpers for every SafeMerge tool. Everything here runs in the
// visitor's browser; no function in this file sends data anywhere.
window.SM = (() => {
  const $ = (sel, root = document) => root.querySelector(sel);

  const fmtSize = (n) => n < 1048576
    ? Math.max(1, Math.round(n / 1024)) + ' KB'
    : (n / 1048576).toFixed(1) + ' MB';

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  const baseName = (name) => name.replace(/\.[^.]+$/, '') || 'file';

  const isPdf = (file) => /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
  const isImage = (file) => /^image\//.test(file.type) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(file.name);

  // Status line under each tool
  function status(msg, kind = '') {
    const el = $('#status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'status' + (kind ? ' ' + kind : '');
  }

  function progress(fraction) {
    const bar = $('#progress');
    if (!bar) return;
    bar.hidden = fraction == null;
    bar.firstElementChild.style.width = Math.round((fraction || 0) * 100) + '%';
  }

  // Drop zone: click, keyboard or drag files in. Calls onFiles(File[]).
  function dropzone(el, { accept, onFiles }) {
    const input = el.querySelector('input[type=file]');
    const pick = () => input.click();
    el.addEventListener('click', pick);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
    });
    input.addEventListener('change', () => {
      const files = [...input.files].filter(accept);
      input.value = '';
      if (files.length) onFiles(files);
    });
    const isFileDrag = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    ['dragenter', 'dragover'].forEach((ev) => el.addEventListener(ev, (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      el.classList.add('over');
    }));
    ['dragleave', 'drop'].forEach((ev) => el.addEventListener(ev, () => el.classList.remove('over')));
    el.addEventListener('drop', (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      const files = [...e.dataTransfer.files].filter(accept);
      if (files.length) onFiles(files);
      else status('That file type is not supported by this tool.', 'bad');
    });
  }
  // A file dropped outside a drop zone would otherwise open in the browser
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  // Save a file to the visitor's device
  function download(data, filename, type = 'application/octet-stream') {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return blob.size;
  }

  async function zip(entries) {
    const z = new JSZip();
    const used = new Set();
    for (const { name, data } of entries) {
      let n = name, i = 2;
      while (used.has(n)) n = name.replace(/(\.[^.]+)$/, ` (${i++})$1`);
      used.add(n);
      z.file(n, data);
    }
    return z.generateAsync({ type: 'blob' });
  }

  // "1-3, 5, 8-" → [[1,3],[5,5],[8,max]] (1-based, inclusive)
  function parseRanges(text, max) {
    const parts = text.split(/[,;\s]+/).filter(Boolean);
    if (!parts.length) throw new Error('Type at least one page or range, like 1-3, 5.');
    return parts.map((p) => {
      const m = p.match(/^(\d*)\s*-\s*(\d*)$|^(\d+)$/);
      if (!m) throw new Error(`"${p}" is not a page or range. Use forms like 4 or 2-6.`);
      let a, b;
      if (m[3]) a = b = +m[3];
      else { a = m[1] ? +m[1] : 1; b = m[2] ? +m[2] : max; }
      if (a < 1 || b < 1 || a > max || b > max) throw new Error(`"${p}" is outside this PDF, which has ${plural(max, 'page')}.`);
      if (a > b) throw new Error(`"${p}" goes backwards. Write the smaller page first.`);
      return [a, b];
    });
  }

  // Load a PDF with pdf-lib, with plain-language errors
  async function loadPdf(bytes) {
    let doc;
    try {
      doc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
    } catch (e) {
      throw new Error('This file could not be read as a PDF. It may be damaged.');
    }
    if (doc.isEncrypted) throw new Error('This PDF is password-protected. Remove the password with Unlock PDF first, then try again.');
    return doc;
  }

  async function readFile(file) {
    return new Uint8Array(await file.arrayBuffer());
  }

  // pdf.js, used to draw page previews and render pages to images
  function pdfjs() {
    if (!window.pdfjsLib) throw new Error('The page preview library did not load. Reload the page.');
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js';
    return pdfjsLib;
  }

  async function openForRender(bytes) {
    // pdf.js takes ownership of the buffer it gets, so give it a copy
    return pdfjs().getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  }

  async function renderPage(pdf, pageNumber, { scale, maxWidth }) {
    const page = await pdf.getPage(pageNumber);
    let vp = page.getViewport({ scale: 1 });
    const s = scale || (maxWidth / vp.width);
    vp = page.getViewport({ scale: s });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // 'print' intent renders without waiting for animation frames, so long
    // conversions keep going while the tab is in the background
    await page.render({ canvasContext: ctx, viewport: vp, intent: 'print' }).promise;
    page.cleanup();
    return canvas;
  }

  // Map a point measured on the page as the reader sees it (origin bottom-left,
  // after the page's own rotation) into PDF coordinates, plus the text angle
  // needed so drawn text reads upright.
  function visualFrame(page) {
    const box = page.getCropBox();
    const r = ((page.getRotation().angle % 360) + 360) % 360;
    const w = box.width, h = box.height;
    const swap = r === 90 || r === 270;
    return {
      width: swap ? h : w,
      height: swap ? w : h,
      rotation: r,
      toPdf(vx, vy) {
        let u, v;
        if (r === 90) { u = w - vy; v = vx; }
        else if (r === 180) { u = w - vx; v = h - vy; }
        else if (r === 270) { u = vy; v = h - vx; }
        else { u = vx; v = vy; }
        return { x: box.x + u, y: box.y + v };
      },
    };
  }

  // Simple reorderable file list used by Merge and Images to PDF.
  // items: array of objects with an `id`; renderRow(item, index) returns inner HTML pieces.
  function sortableList(listEl, items, { renderRow, onChange }) {
    let dragId = null;
    const indexOf = (id) => items.findIndex((it) => String(it.id) === String(id));
    const move = (from, to) => {
      if (to < 0 || to >= items.length || from === to) return;
      const [it] = items.splice(from, 1);
      items.splice(to, 0, it);
      render();
    };
    function render() {
      listEl.innerHTML = '';
      items.forEach((it, i) => {
        const li = document.createElement('li');
        li.draggable = true;
        li.dataset.id = it.id;
        li.innerHTML = `<span class="grip" title="Drag to reorder" aria-hidden="true">⋮⋮</span>
          <span class="num">${i + 1}</span>`;
        renderRow(it, li);
        li.insertAdjacentHTML('beforeend', `
          <button class="icon" data-act="up" title="Move up" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="icon" data-act="down" title="Move down" aria-label="Move down" ${i === items.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="icon" data-act="remove" title="Remove" aria-label="Remove">✕</button>`);
        listEl.appendChild(li);
      });
      onChange();
    }
    listEl.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const i = indexOf(btn.closest('li').dataset.id);
      if (btn.dataset.act === 'up') move(i, i - 1);
      if (btn.dataset.act === 'down') move(i, i + 1);
      if (btn.dataset.act === 'remove') { items.splice(i, 1); render(); }
    });
    listEl.addEventListener('dragstart', (e) => {
      const li = e.target.closest('li'); if (!li) return;
      dragId = li.dataset.id;
      li.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragId);
    });
    listEl.addEventListener('dragend', () => { dragId = null; render(); });
    listEl.addEventListener('dragover', (e) => {
      if (dragId == null) return;
      e.preventDefault();
      listEl.querySelectorAll('li').forEach((l) => l.classList.remove('target'));
      e.target.closest('li')?.classList.add('target');
    });
    listEl.addEventListener('drop', (e) => {
      if (dragId == null) return;
      e.preventDefault();
      e.stopPropagation();
      const li = e.target.closest('li'); if (!li) return;
      const from = indexOf(dragId), to = indexOf(li.dataset.id);
      dragId = null;
      move(from, to);
    });
    return { render };
  }

  // Grid of page previews used by Split, Rotate and Organize.
  // opts: { select, rotate, reorder, remove }
  function pageGrid(gridEl, opts) {
    let pages = []; // { id, index (0-based source page), rotation (added degrees), selected, canvas }
    let dragId = null, onChange = () => {}, loadToken = 0;

    function card(p, i) {
      const el = document.createElement('div');
      el.className = 'page' + (opts.select ? ' selectable' : '') + (p.selected ? ' selected' : '');
      el.dataset.id = p.id;
      if (opts.reorder) el.draggable = true;
      el.innerHTML = `${opts.select ? '<span class="check" aria-hidden="true">✓</span>' : ''}
        <div class="frame"></div>
        <div class="label">Page ${p.index + 1}${opts.reorder && p.index !== i ? ` → ${i + 1}` : ''}</div>
        <div class="actions"></div>`;
      if (opts.select) {
        el.setAttribute('role', 'checkbox');
        el.setAttribute('aria-checked', p.selected);
        el.tabIndex = 0;
      }
      const frame = el.querySelector('.frame');
      if (p.canvas) frame.appendChild(p.canvas);
      else frame.textContent = '…';
      const actions = el.querySelector('.actions');
      if (opts.reorder) actions.insertAdjacentHTML('beforeend',
        `<button class="icon" data-act="left" title="Move earlier" aria-label="Move earlier" ${i === 0 ? 'disabled' : ''}>←</button>
         <button class="icon" data-act="right" title="Move later" aria-label="Move later" ${i === pages.length - 1 ? 'disabled' : ''}>→</button>`);
      if (opts.rotate) actions.insertAdjacentHTML('beforeend',
        `<button class="icon" data-act="ccw" title="Rotate left" aria-label="Rotate left">↺</button>
         <button class="icon" data-act="cw" title="Rotate right" aria-label="Rotate right">↻</button>`);
      if (opts.remove) actions.insertAdjacentHTML('beforeend',
        `<button class="icon" data-act="remove" title="Delete page" aria-label="Delete page">✕</button>`);
      return el;
    }

    // Size and turn a preview so it fits its frame at any rotation
    function orient(p) {
      const c = p.canvas, frame = c?.parentElement;
      if (!frame || !frame.clientWidth) return;
      const sideways = p.rotation % 180 !== 0;
      const boxW = sideways ? c.height : c.width, boxH = sideways ? c.width : c.height;
      const k = Math.min(frame.clientWidth / boxW, frame.clientHeight / boxH);
      c.style.width = c.width * k + 'px';
      c.style.height = c.height * k + 'px';
      c.style.transform = `rotate(${p.rotation}deg)`;
    }

    function render() {
      gridEl.innerHTML = '';
      pages.forEach((p, i) => gridEl.appendChild(card(p, i)));
      pages.forEach(orient);
      onChange(pages);
    }

    const indexOf = (id) => pages.findIndex((p) => String(p.id) === String(id));

    gridEl.addEventListener('click', (e) => {
      const el = e.target.closest('.page'); if (!el) return;
      const i = indexOf(el.dataset.id), p = pages[i];
      const act = e.target.closest('button[data-act]')?.dataset.act;
      if (act === 'cw') p.rotation = (p.rotation + 90) % 360;
      else if (act === 'ccw') p.rotation = (p.rotation + 270) % 360;
      else if (act === 'remove') pages.splice(i, 1);
      else if (act === 'left' && i > 0) pages.splice(i - 1, 0, pages.splice(i, 1)[0]);
      else if (act === 'right' && i < pages.length - 1) pages.splice(i + 1, 0, pages.splice(i, 1)[0]);
      else if (!act && opts.select) p.selected = !p.selected;
      else return;
      render();
    });
    gridEl.addEventListener('keydown', (e) => {
      if (!opts.select || (e.key !== ' ' && e.key !== 'Enter') || e.target.closest('button')) return;
      const el = e.target.closest('.page'); if (!el) return;
      e.preventDefault();
      const p = pages[indexOf(el.dataset.id)];
      p.selected = !p.selected;
      render();
      gridEl.querySelector(`[data-id="${p.id}"]`)?.focus();
    });
    if (opts.reorder) {
      gridEl.addEventListener('dragstart', (e) => {
        const el = e.target.closest('.page'); if (!el) return;
        dragId = el.dataset.id;
        el.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', dragId);
      });
      gridEl.addEventListener('dragend', () => { dragId = null; render(); });
      gridEl.addEventListener('dragover', (e) => {
        if (dragId == null) return;
        e.preventDefault();
        gridEl.querySelectorAll('.page').forEach((x) => x.classList.remove('target'));
        e.target.closest('.page')?.classList.add('target');
      });
      gridEl.addEventListener('drop', (e) => {
        if (dragId == null) return;
        e.preventDefault();
        e.stopPropagation();
        const el = e.target.closest('.page'); if (!el) return;
        const from = indexOf(dragId), to = indexOf(el.dataset.id);
        dragId = null;
        if (from !== to) pages.splice(to, 0, pages.splice(from, 1)[0]);
        render();
      });
    }

    return {
      // Draw previews for a PDF; resolves when all thumbnails are in.
      async load(bytes, count) {
        pages = Array.from({ length: count }, (_, i) => ({ id: i, index: i, rotation: 0, selected: false, canvas: null }));
        render();
        const pdf = await openForRender(bytes);
        const all = pages.slice(), token = ++loadToken;
        for (const p of all) {
          if (token !== loadToken) break; // a newer load (Undo, new file) took over
          try { p.canvas = await renderPage(pdf, p.index + 1, { maxWidth: 220 }); } catch (e) { /* leave placeholder */ }
          const el = gridEl.querySelector(`[data-id="${p.id}"] .frame`);
          if (el && p.canvas) {
            el.textContent = '';
            el.appendChild(p.canvas);
            orient(p);
          }
          progress((p.index + 1) / all.length);
        }
        progress(null);
        pdf.destroy();
      },
      get pages() { return pages; },
      set onChange(fn) { onChange = fn; },
      render,
      rotateAll(deg) { pages.forEach((p) => { p.rotation = (p.rotation + deg + 360) % 360; }); render(); },
      selectAll(on) { pages.forEach((p) => { p.selected = on; }); render(); },
      clear() { loadToken++; pages = []; render(); progress(null); },
    };
  }

  // Lets visitors install the site as an app that works offline
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }

  return {
    $, fmtSize, plural, baseName, isPdf, isImage, status, progress, dropzone, download, zip,
    parseRanges, loadPdf, readFile, openForRender, renderPage, visualFrame, sortableList, pageGrid,
  };
})();

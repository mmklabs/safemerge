// Put the front and back of an ID card on one page (PDF or JPG), at real
// card size, ready to print or upload. Everything happens in the browser.
(() => {
  const { $ } = SM;
  const MM = 72 / 25.4;                 // PDF points per millimetre
  const CARD = { w: 85.6, h: 53.98 };   // ID-1 card size (bank cards, most IDs)
  const PAGES = { a4: [210, 297], letter: [215.9, 279.4] };

  // ---- One slot per side ----------------------------------------------

  const slots = {};
  document.querySelectorAll('.id-slot').forEach((el) => {
    const side = el.dataset.side;
    const s = slots[side] = {
      el, side, bitmap: null, crop: null, name: '',
      drop: el.querySelector('.dropzone'),
      area: el.querySelector('.crop-area'),
      canvas: el.querySelector('canvas'),
      actions: el.querySelector('.slot-actions'),
      view: null, // {k, w, h}: image px → canvas css px
    };
    SM.dropzone(s.drop, {
      accept: SM.isImage,
      async onFiles(files) { await load(s, files[0]); },
    });
    s.actions.addEventListener('click', async (e) => {
      const act = e.target.closest('button')?.dataset.act;
      if (act === 'rotate') { s.bitmap = await rotate(s.bitmap); s.crop = autoCrop(s.bitmap); draw(s); changed(); }
      if (act === 'reset-crop') { s.crop = full(s.bitmap); draw(s); changed(); }
      if (act === 'auto-crop') { s.crop = autoCrop(s.bitmap); draw(s); changed(); }
      if (act === 'remove') { s.bitmap?.close?.(); s.bitmap = null; show(s); changed(); }
    });
    attachCrop(s);
  });

  const full = (b) => ({ x: 0, y: 0, w: b.width, h: b.height });

  // Guess where the card is: compare every pixel with the colour of the photo's
  // border (the table or background) and box in what differs. Falls back to the
  // whole photo if nothing card-like stands out.
  function autoCrop(b) {
    const k = Math.min(1, 400 / Math.max(b.width, b.height));
    const w = Math.max(1, Math.round(b.width * k)), h = Math.max(1, Math.round(b.height * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.drawImage(b, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    const px = (x, y) => { const i = (y * w + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
    // Background colour = median of the outer ring of pixels
    const ring = [];
    for (let x = 0; x < w; x += 2) { ring.push(px(x, 0), px(x, h - 1)); }
    for (let y = 0; y < h; y += 2) { ring.push(px(0, y), px(w - 1, y)); }
    const med = [0, 1, 2].map((ch) => ring.map((p) => p[ch]).sort((a, z) => a - z)[ring.length >> 1]);
    const diff = (p) => Math.abs(p[0] - med[0]) + Math.abs(p[1] - med[1]) + Math.abs(p[2] - med[2]);
    // Count "different" pixels per row and column, keep rows/cols where enough differ
    const rows = new Array(h).fill(0), cols = new Array(w).fill(0);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (diff(px(x, y)) > 60) { rows[y]++; cols[x]++; }
    const span = (arr, len, other) => {
      const need = other * 0.15;
      let a = arr.findIndex((v) => v > need), z = len - 1 - [...arr].reverse().findIndex((v) => v > need);
      return a < 0 ? null : [a, z];
    };
    const ys = span(rows, h, w), xs = span(cols, w, h);
    if (!ys || !xs) return full(b);
    const cw = xs[1] - xs[0], ch = ys[1] - ys[0];
    const area = (cw * ch) / (w * h);
    if (area < 0.08 || area > 0.92) return full(b);
    const m = 2; // small margin
    return {
      x: Math.max(0, (xs[0] - m) / k), y: Math.max(0, (ys[0] - m) / k),
      w: Math.min(b.width, (cw + 2 * m) / k), h: Math.min(b.height, (ch + 2 * m) / k),
    };
  }

  async function load(s, f) {
    try {
      const b = await createImageBitmap(f);
      s.bitmap?.close?.();
      s.bitmap = b;
      s.crop = autoCrop(b);
      s.name = f.name;
    } catch (e) {
      SM.status(/\.hei[cf]$/i.test(f.name) ? 'This browser can\'t open HEIC photos. Share the photo as JPG, or set your iPhone camera to Most Compatible.' : 'This file could not be opened as an image.', 'bad');
      return;
    }
    SM.status('');
    show(s);
    changed();
  }

  function show(s) {
    const has = !!s.bitmap;
    s.drop.hidden = has;
    s.area.hidden = !has;
    s.actions.hidden = !has;
    if (has) draw(s);
    $('#run').disabled = !(slots.front.bitmap || slots.back.bitmap);
    $('#crop-hint').hidden = !(slots.front.bitmap || slots.back.bitmap);
  }

  async function rotate(b) {
    const c = document.createElement('canvas');
    c.width = b.height; c.height = b.width;
    const g = c.getContext('2d');
    g.translate(c.width, 0);
    g.rotate(Math.PI / 2);
    g.drawImage(b, 0, 0);
    b.close?.();
    return createImageBitmap(c);
  }

  // ---- Crop rectangle with draggable corners ---------------------------

  function draw(s) {
    if (!s.bitmap) return;
    const box = s.area.clientWidth || 280;
    const k = Math.min(box / s.bitmap.width, 320 / s.bitmap.height);
    const w = s.bitmap.width * k, h = s.bitmap.height * k;
    const dpr = window.devicePixelRatio || 1;
    const c = s.canvas;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    c.style.width = w + 'px'; c.style.height = h + 'px';
    s.view = { k, w, h };
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.drawImage(s.bitmap, 0, 0, w, h);
    const r = { x: s.crop.x * k, y: s.crop.y * k, w: s.crop.w * k, h: s.crop.h * k };
    g.fillStyle = 'rgba(0,0,0,.45)';
    g.beginPath();
    g.rect(0, 0, w, h);
    g.rect(r.x, r.y, r.w, r.h);
    g.fill('evenodd');
    g.strokeStyle = '#fff'; g.lineWidth = 2;
    g.strokeRect(r.x, r.y, r.w, r.h);
    g.fillStyle = '#fff';
    for (const [x, y] of corners(r)) { g.beginPath(); g.arc(x, y, 7, 0, 7); g.fill(); }
  }

  const corners = (r) => [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]];

  function attachCrop(s) {
    let drag = null;
    const c = s.canvas;
    const pos = (e) => { const b = c.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
    c.addEventListener('pointerdown', (e) => {
      if (!s.bitmap) return;
      const p = pos(e), k = s.view.k;
      const r = { x: s.crop.x * k, y: s.crop.y * k, w: s.crop.w * k, h: s.crop.h * k };
      const hit = corners(r).findIndex(([x, y]) => Math.hypot(p.x - x, p.y - y) < 22);
      if (hit >= 0) drag = { mode: hit, start: p, crop: { ...s.crop } };
      else if (p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h) drag = { mode: 'move', start: p, crop: { ...s.crop } };
      else return;
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const p = pos(e), k = s.view.k;
      const dx = (p.x - drag.start.x) / k, dy = (p.y - drag.start.y) / k;
      const W = s.bitmap.width, H = s.bitmap.height, min = Math.min(W, H) * 0.08;
      let { x, y, w, h } = drag.crop;
      if (drag.mode === 'move') {
        x = Math.min(W - w, Math.max(0, x + dx));
        y = Math.min(H - h, Math.max(0, y + dy));
      } else {
        let x2 = x + w, y2 = y + h;
        if (drag.mode === 0 || drag.mode === 2) x = Math.min(x2 - min, Math.max(0, x + dx));
        else x2 = Math.max(x + min, Math.min(W, x2 + dx));
        if (drag.mode === 0 || drag.mode === 1) y = Math.min(y2 - min, Math.max(0, y + dy));
        else y2 = Math.max(y + min, Math.min(H, y2 + dy));
        w = x2 - x; h = y2 - y;
      }
      s.crop = { x, y, w, h };
      draw(s);
    });
    const end = () => { if (drag) { drag = null; changed(); } };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }

  window.addEventListener('resize', () => Object.values(slots).forEach(draw));

  // ---- Options -----------------------------------------------------------

  const pick = (name) => document.querySelector(`input[name=${name}]:checked`).value;
  function changed() { $('#result').hidden = true; }
  document.querySelectorAll('#options input').forEach((i) => i.addEventListener('input', changed));

  // ---- Building the page ---------------------------------------------------

  // Card frames in mm, positioned on the page
  function layout() {
    const [pw, ph] = PAGES[pick('page')];
    const cards = ['front', 'back'].map((k) => slots[k]).filter((s) => s.bitmap);
    const large = pick('cardsize') === 'large';
    const side = pick('arrange') === 'side' && cards.length === 2;
    const margin = 12, gap = 10;
    // Width for each card: real card size, or as large as the page allows
    const frames = cards.map((s) => {
      const aspect = s.crop.h / s.crop.w;
      const portrait = aspect > 1;
      let w = portrait ? CARD.h : CARD.w;
      if (large) w *= side ? 1.05 : 1.6;
      return { s, w, h: w * aspect };
    });
    // Shrink everything if it doesn't fit
    const totalW = side ? frames.reduce((a, f) => a + f.w, 0) + gap * (frames.length - 1) : Math.max(...frames.map((f) => f.w));
    const totalH = side ? Math.max(...frames.map((f) => f.h)) : frames.reduce((a, f) => a + f.h, 0) + gap * (frames.length - 1);
    const fit = Math.min(1, (pw - 2 * margin) / totalW, (ph - 2 * margin) / totalH);
    frames.forEach((f) => { f.w *= fit; f.h *= fit; });
    // Position: centred horizontally, from the top margin
    let x = (pw - (side ? totalW * fit : 0)) / 2, y = margin + 10;
    for (const f of frames) {
      if (side) { f.x = x; f.y = y; x += f.w + gap * fit; }
      else { f.x = (pw - f.w) / 2; f.y = y; y += f.h + gap; }
    }
    return { pw, ph, frames };
  }

  // Crop + scale one side to the given dpi; returns a canvas
  function cardCanvas(f, dpi, gray) {
    const w = Math.max(1, Math.round((f.w / 25.4) * dpi)), h = Math.max(1, Math.round((f.h / 25.4) * dpi));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    const { x, y, w: cw, h: ch } = f.s.crop;
    g.drawImage(f.s.bitmap, x, y, cw, ch, 0, 0, w, h);
    if (gray) toGray(g, w, h);
    return c;
  }

  function toGray(g, w, h) {
    const img = g.getImageData(0, 0, w, h), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    g.putImageData(img, 0, 0);
  }

  const jpeg = async (canvas, q) => new Uint8Array(await (await new Promise((r) => canvas.toBlob(r, 'image/jpeg', q))).arrayBuffer());

  async function buildPdf(L, dpi, q, gray, cutlines) {
    const doc = await PDFLib.PDFDocument.create();
    const page = doc.addPage([L.pw * MM, L.ph * MM]);
    for (const f of L.frames) {
      const img = await doc.embedJpg(await jpeg(cardCanvas(f, dpi, gray), q));
      const x = f.x * MM, y = (L.ph - f.y - f.h) * MM;
      page.drawImage(img, { x, y, width: f.w * MM, height: f.h * MM });
      if (cutlines) {
        page.drawRectangle({ x: x - 2 * MM, y: y - 2 * MM, width: (f.w + 4) * MM, height: (f.h + 4) * MM,
          borderColor: PDFLib.rgb(0.6, 0.6, 0.6), borderWidth: 0.5, borderDashArray: [3, 3] });
      }
    }
    return { bytes: await doc.save(), type: 'application/pdf', ext: 'pdf' };
  }

  function pageCanvas(L, dpi, gray, cutlines) {
    const k = dpi / 25.4;
    const c = document.createElement('canvas');
    c.width = Math.round(L.pw * k); c.height = Math.round(L.ph * k);
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    for (const f of L.frames) {
      g.drawImage(cardCanvas(f, dpi, gray), f.x * k, f.y * k, f.w * k, f.h * k);
      if (cutlines) {
        g.setLineDash([3 * k / 2.8, 3 * k / 2.8]);
        g.strokeStyle = '#999'; g.lineWidth = Math.max(1, k * 0.18);
        g.strokeRect((f.x - 2) * k, (f.y - 2) * k, (f.w + 4) * k, (f.h + 4) * k);
      }
    }
    return c;
  }

  async function build() {
    const L = layout();
    if (!L.frames.length) throw new Error('Add at least one side of the card.');
    const gray = $('#gray').checked, cutlines = $('#cutlines').checked;
    const maxKb = parseFloat($('#max-kb').value);
    const maxBytes = maxKb > 0 ? maxKb * 1024 : null;
    const asJpg = pick('output') === 'jpg';
    const make = (dpi, q) => asJpg
      ? jpeg(pageCanvas(L, dpi, gray, cutlines), q).then((bytes) => ({ bytes, type: 'image/jpeg', ext: 'jpg' }))
      : buildPdf(L, dpi, q, gray, cutlines);
    // Best quality first; under a limit, search quality, then lower resolution
    let out = await make(300, 0.9);
    let fits = !maxBytes || out.bytes.length <= maxBytes;
    if (!fits) {
      for (const dpi of [300, 200, 150, 110]) {
        let lo = 0.3, hi = 0.9, best = null;
        for (let i = 0; i < 6; i++) {
          const q = (lo + hi) / 2;
          const r = await make(dpi, q);
          if (r.bytes.length <= maxBytes) { best = r; lo = q; } else hi = q;
        }
        if (best) { out = best; fits = true; break; }
        out = await make(dpi, 0.3);
      }
    }
    return { ...out, fits, maxBytes, L };
  }

  let result = null;
  $('#run').addEventListener('click', async () => {
    $('#run').disabled = true;
    SM.status('Creating the page…');
    try {
      result = await build();
      await showResult();
      SM.status('');
    } catch (e) {
      SM.status(e.message, 'bad');
    }
    $('#run').disabled = false;
  });

  async function showResult() {
    const r = result;
    $('#result-sizes').textContent = `${r.ext.toUpperCase()} · ${SM.fmtSize(r.bytes.length)}`;
    const v = $('#result-verdict');
    if (r.maxBytes) {
      v.textContent = r.fits ? `✓ Under ${SM.fmtSize(r.maxBytes)}` : `✕ Over ${SM.fmtSize(r.maxBytes)}`;
      v.className = 'verdict ' + (r.fits ? 'good' : 'bad');
    } else { v.textContent = ''; v.className = 'verdict'; }
    const note = $('#result-note');
    note.textContent = r.fits ? (pick('cardsize') === 'actual'
      ? 'Printed at 100% scale ("Actual size"), each card comes out at its real size.'
      : '') : 'This is the smallest we could make it. Try Black & white, or a larger limit.';
    note.hidden = !note.textContent;
    // Preview
    const holder = $('#preview');
    holder.textContent = '';
    const c = pageCanvas(r.L, 40, $('#gray').checked, $('#cutlines').checked);
    holder.appendChild(c);
    $('#download').textContent = `Download ${r.ext.toUpperCase()} (${SM.fmtSize(r.bytes.length)})`;
    $('#result').hidden = false;
  }

  $('#download').addEventListener('click', () => {
    if (!result) return;
    SM.download(result.bytes, `id-card-front-back.${result.ext}`, result.type);
  });

  $('#reset').addEventListener('click', () => {
    Object.values(slots).forEach((s) => { s.bitmap?.close?.(); s.bitmap = null; show(s); });
    changed();
    SM.status('');
  });

  window.SMIdCard = { build, slots };
})();

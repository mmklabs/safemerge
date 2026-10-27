// Resize a photo or signature to exact dimensions and/or a file-size limit,
// for upload forms. Everything happens on a canvas in the browser.
(() => {
  const { $ } = SM;

  // width, height, unit; mm sizes are converted at the chosen DPI
  const PRESETS = {
    original: null,
    'form-photo': { w: 200, h: 230, unit: 'px', maxKb: 50, minKb: 20 },
    signature: { w: 140, h: 60, unit: 'px', maxKb: 20, minKb: 10, cleanup: true, fit: 'pad' },
    passport: { w: 35, h: 45, unit: 'mm', dpi: 300 },
    square: { w: 600, h: 600, unit: 'px' },
    custom: {},
  };
  const MM_PER_UNIT = { mm: 1, cm: 10, in: 25.4 };

  let file = null, bitmap = null, output = null;
  let zoom = 1, offX = 0, offY = 0; // crop position, in output pixels
  const stage = $('#stage');
  const runBtn = $('#run');

  // ---- Settings from the form ------------------------------------------

  const val = (id) => $('#' + id).value;
  const pick = (name) => document.querySelector(`input[name=${name}]:checked`).value;

  function targetSize() {
    if (val('preset') === 'original') return null;
    const w = parseFloat(val('w')), h = parseFloat(val('h'));
    if (!(w > 0 && h > 0)) return undefined;
    const unit = val('unit');
    if (unit === 'px') return { w: Math.round(w), h: Math.round(h) };
    const dpi = parseFloat(val('dpi')) || 300;
    const toPx = (v) => Math.round((v * MM_PER_UNIT[unit] / 25.4) * dpi);
    return { w: toPx(w), h: toPx(h) };
  }

  const kb = (id) => { const v = parseFloat(val(id)); return v > 0 ? v * 1024 : null; };
  const band = () => $('#stamp').checked;

  // Area the photo itself fills (the name/date band takes the bottom 18%)
  function photoArea(size) {
    if (!size) return null;
    const bh = band() ? Math.round(size.h * 0.18) : 0;
    return { w: size.w, h: size.h - bh, band: bh };
  }

  // ---- Source image (optionally trimmed to the ink of a signature) -------

  let trimmed = null; // cached trimmed bitmap for the current file

  async function computeTrim() {
    // Find the ink on a small copy, then crop the full image to it plus a margin
    const k = Math.min(1, 600 / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * k)), h = Math.max(1, Math.round(bitmap.height * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.drawImage(bitmap, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const cut = Math.max(60, sum / (d.length / 4) - 45);
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] < cut) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    if (x1 < 0 || (x1 - x0) < 4 || (y1 - y0) < 4) return bitmap; // no clear ink found
    const m = Math.round(Math.max(x1 - x0, y1 - y0) * 0.06) + 2;
    const sx = Math.max(0, (x0 - m) / k), sy = Math.max(0, (y0 - m) / k);
    const sw = Math.min(bitmap.width - sx, (x1 - x0 + 2 * m) / k), sh = Math.min(bitmap.height - sy, (y1 - y0 + 2 * m) / k);
    return createImageBitmap(bitmap, Math.round(sx), Math.round(sy), Math.round(sw), Math.round(sh));
  }

  async function refreshSource() {
    if (!bitmap) return;
    if ($('#cleanup').checked) {
      if (!trimmed) trimmed = await computeTrim();
    }
    renderStage();
  }

  const src = () => ($('#cleanup').checked && trimmed ? trimmed : bitmap);

  // ---- Preview with drag-to-position -----------------------------------

  function drawPhoto(g, area, scaleOut) {
    // scaleOut converts output pixels to the canvas being drawn on
    const fit = pick('fit');
    const iw = src().width, ih = src().height;
    const cover = Math.max(area.w / iw, area.h / ih);
    const contain = Math.min(area.w / iw, area.h / ih);
    const s = (fit === 'crop' ? cover * zoom : contain) * scaleOut;
    const dw = iw * s, dh = ih * s;
    let x = (area.w * scaleOut - dw) / 2, y = (area.h * scaleOut - dh) / 2;
    if (fit === 'crop') { x += offX * scaleOut; y += offY * scaleOut; }
    g.drawImage(src(), x, y, dw, dh);
  }

  // Keep the crop from leaving empty edges
  function clampOffset(area) {
    if (!area || pick('fit') !== 'crop') { offX = offY = 0; return; }
    const b = src();
    const s = Math.max(area.w / b.width, area.h / b.height) * zoom;
    const maxX = Math.max(0, (b.width * s - area.w) / 2);
    const maxY = Math.max(0, (b.height * s - area.h) / 2);
    offX = Math.min(maxX, Math.max(-maxX, offX));
    offY = Math.min(maxY, Math.max(-maxY, offY));
  }

  function renderStage() {
    if (!bitmap) return;
    const size = targetSize();
    const box = stage.parentElement.clientWidth || 320;
    const g = stage.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    let cw, ch;
    if (!size) {
      const b = src();
      const s = Math.min(1, box / b.width, 360 / b.height);
      cw = b.width * s; ch = b.height * s;
    } else {
      const s = Math.min(box / size.w, 360 / size.h);
      cw = size.w * s; ch = size.h * s;
    }
    stage.width = Math.round(cw * dpr); stage.height = Math.round(ch * dpr);
    stage.style.width = cw + 'px'; stage.style.height = ch + 'px';
    g.fillStyle = '#fff';
    g.fillRect(0, 0, stage.width, stage.height);
    if (!size) {
      g.drawImage(src(), 0, 0, stage.width, stage.height);
    } else {
      const area = photoArea(size);
      clampOffset(area);
      const k = stage.width / size.w;
      g.save();
      g.beginPath(); g.rect(0, 0, area.w * k, area.h * k); g.clip();
      drawPhoto(g, area, k);
      g.restore();
      if (area.band) drawBand(g, 0, area.h * k, stage.width, area.band * k);
    }
    if ($('#cleanup').checked) cleanSignature(g, stage.width, stage.height);
    const croppable = size && pick('fit') === 'crop';
    $('#zoom-row').hidden = !croppable;
    stage.classList.toggle('draggable', !!croppable);
    $('#stage-hint').textContent = croppable ? 'Drag the photo to position it. Use the slider to zoom.'
      : size ? 'The whole image fits inside, with white space around it if needed.' : 'Original proportions are kept.';
  }

  function drawBand(g, x, y, w, h) {
    g.fillStyle = '#fff';
    g.fillRect(x, y, w, h);
    const lines = [val('stamp-name').trim(), val('stamp-date').trim()].filter(Boolean);
    if (!lines.length) return;
    g.fillStyle = '#000';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let size = h / (lines.length === 2 ? 2.6 : 1.8);
    g.font = `600 ${size}px Arial, Helvetica, sans-serif`;
    const widest = Math.max(...lines.map((l) => g.measureText(l).width));
    if (widest > w * 0.94) { size *= (w * 0.94) / widest; g.font = `600 ${size}px Arial, Helvetica, sans-serif`; }
    lines.forEach((l, i) => g.fillText(l, x + w / 2, y + (h * (i + 1)) / (lines.length + 1)));
  }

  // White background, darker ink: makes phone photos of signatures look scanned
  function cleanSignature(g, w, h) {
    const img = g.getImageData(0, 0, w, h);
    const d = img.data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const paper = sum / (d.length / 4);           // average brightness ≈ the paper
    const cut = Math.max(60, paper - 45);          // anything clearly darker is ink
    for (let i = 0; i < d.length; i += 4) {
      const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      let v;
      if (y >= cut) v = 255;
      else v = Math.round(Math.pow(y / cut, 1.8) * 120); // dark ink, smooth edges
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    g.putImageData(img, 0, 0);
  }

  let drag = null;
  stage.addEventListener('pointerdown', (e) => {
    if (!stage.classList.contains('draggable')) return;
    drag = { x: e.clientX, y: e.clientY, ox: offX, oy: offY };
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const size = targetSize();
    const k = size.w / parseFloat(stage.style.width); // screen px → output px
    offX = drag.ox + (e.clientX - drag.x) * k;
    offY = drag.oy + (e.clientY - drag.y) * k;
    renderStage();
  });
  ['pointerup', 'pointercancel'].forEach((ev) => stage.addEventListener(ev, () => { drag = null; changed(); }));
  $('#zoom').addEventListener('input', () => { zoom = parseFloat(val('zoom')); renderStage(); changed(); });

  // ---- Form behaviour --------------------------------------------------

  function applyPreset(name, keepCrop) {
    const p = PRESETS[name];
    const custom = name !== 'original';
    $('#size-fields').hidden = !custom;
    $('#fit-field').hidden = !custom;
    if (p && p.w) {
      $('#w').value = p.w; $('#h').value = p.h; $('#unit').value = p.unit;
      if (p.dpi) $('#dpi').value = p.dpi;
    }
    if (p) {
      $('#max-kb').value = p.maxKb || document.body.dataset.maxkb || '';
      $('#min-kb').value = p.minKb || '';
      if ('cleanup' in p) $('#cleanup').checked = !!p.cleanup;
      const fit = document.querySelector(`input[name=fit][value=${p.fit || 'crop'}]`);
      if (fit && name !== 'custom') fit.checked = true;
    }
    $('#dpi-field').hidden = val('unit') === 'px';
    if (!keepCrop) { zoom = 1; offX = offY = 0; $('#zoom').value = 1; }
    refreshSource();
  }

  function changed() {
    $('#result').hidden = true;
  }

  $('#preset').addEventListener('change', () => { applyPreset(val('preset')); changed(); });
  ['w', 'h', 'unit', 'dpi'].forEach((id) => $('#' + id).addEventListener('input', () => {
    $('#preset').value = 'custom';
    $('#dpi-field').hidden = val('unit') === 'px';
    zoom = 1; offX = offY = 0; $('#zoom').value = 1;
    renderStage(); changed();
  }));
  document.querySelectorAll('input[name=fit]').forEach((r) => r.addEventListener('change', () => { offX = offY = 0; renderStage(); changed(); }));
  ['cleanup', 'stamp'].forEach((id) => $('#' + id).addEventListener('change', () => {
    $('#stamp-fields').hidden = !$('#stamp').checked;
    offX = offY = 0;
    refreshSource(); changed();
  }));
  ['stamp-name', 'stamp-date', 'max-kb', 'min-kb'].forEach((id) => $('#' + id).addEventListener('input', () => { renderStage(); changed(); }));
  document.querySelectorAll('input[name=format]').forEach((r) => r.addEventListener('change', changed));
  window.addEventListener('resize', renderStage);

  // Today's date in the visitor's own format, as a starting point
  $('#stamp-date').value = new Date().toLocaleDateString();

  // Page presets (e.g. /resize-image-to-50kb/)
  const body = document.body.dataset;
  if (body.preset) $('#preset').value = body.preset;
  applyPreset(val('preset'));
  if (body.maxkb) $('#max-kb').value = body.maxkb;
  $('#stamp-fields').hidden = !$('#stamp').checked;

  // ---- Loading the image -------------------------------------------------

  SM.dropzone($('#drop'), {
    accept: SM.isImage,
    async onFiles(files) {
      const f = files[0];
      SM.status('Reading…');
      try {
        bitmap?.close?.();
        bitmap = await createImageBitmap(f); // applies the photo's own rotation
      } catch (e) {
        const heic = /\.hei[cf]$/i.test(f.name) || /heic|heif/.test(f.type);
        SM.status(heic
          ? 'This browser can\'t open HEIC photos. On iPhone, set Camera → Formats → Most Compatible, or share the photo as JPG.'
          : 'This file could not be opened as an image.', 'bad');
        return;
      }
      file = f;
      trimmed = null;
      $('#drop').hidden = true;
      $('#workspace').hidden = false;
      $('#filename').textContent = `${f.name} · ${bitmap.width} × ${bitmap.height} px · ${SM.fmtSize(f.size)}`;
      zoom = 1; offX = offY = 0; $('#zoom').value = 1;
      runBtn.disabled = false;
      changed();
      SM.status('');
      requestAnimationFrame(refreshSource);
    },
  });

  $('#reset').addEventListener('click', () => {
    bitmap?.close?.();
    bitmap = file = output = null;
    $('#drop').hidden = false;
    $('#workspace').hidden = true;
    runBtn.disabled = true;
    SM.status('');
  });

  // ---- Producing the file ------------------------------------------------

  function renderOutput(size, scale) {
    const b = src();
    const w = size ? size.w : Math.max(1, Math.round(b.width * scale));
    const h = size ? size.h : Math.max(1, Math.round(b.height * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w, h);
    if (!size) {
      g.drawImage(b, 0, 0, w, h);
    } else {
      const area = photoArea(size);
      g.save();
      g.beginPath(); g.rect(0, 0, area.w, area.h); g.clip();
      drawPhoto(g, area, 1);
      g.restore();
      if (area.band) drawBand(g, 0, area.h, w, area.band);
    }
    if ($('#cleanup').checked) cleanSignature(g, w, h);
    return c;
  }

  const encode = (canvas, type, q) => new Promise((r) => canvas.toBlob(r, type, q));

  // Highest JPEG quality that stays under maxBytes (binary search)
  async function bestJpeg(canvas, maxBytes) {
    let lo = 0.3, hi = 0.95, best = null;
    const top = await encode(canvas, 'image/jpeg', hi);
    if (!maxBytes || top.size <= maxBytes) return { blob: top, q: hi };
    for (let i = 0; i < 7; i++) {
      const q = (lo + hi) / 2;
      const b = await encode(canvas, 'image/jpeg', q);
      if (b.size <= maxBytes) { best = { blob: b, q }; lo = q; } else hi = q;
    }
    if (best) return best;
    const low = await encode(canvas, 'image/jpeg', 0.3);
    return { blob: low, q: 0.3, over: low.size > maxBytes };
  }

  // Grows a JPEG to `goal` bytes by inserting comment segments right after
  // the start marker. Image viewers ignore comments, so the picture is unchanged.
  async function padJpeg(blob, goal) {
    const src = new Uint8Array(await blob.arrayBuffer());
    let need = goal - src.length;
    if (need <= 4) return blob;
    const parts = [src.subarray(0, 2)]; // FF D8
    while (need > 4) {
      const len = Math.min(65533, need - 2); // segment length counts its own 2 bytes
      const seg = new Uint8Array(len + 2);
      seg[0] = 0xff; seg[1] = 0xfe; seg[2] = (len >> 8) & 0xff; seg[3] = len & 0xff;
      seg.fill(0x20, 4); // spaces
      parts.push(seg);
      need -= seg.length;
    }
    parts.push(src.subarray(2));
    return new Blob(parts, { type: 'image/jpeg' });
  }

  async function produce() {
    if ($('#cleanup').checked && !trimmed) trimmed = await computeTrim();
    const size = targetSize();
    if (size === undefined) throw new Error('Type a width and a height.');
    if (size && (size.w > 8000 || size.h > 8000)) throw new Error('That size is too large. Use 8000 pixels or less on each side.');
    const maxBytes = kb('max-kb'), minBytes = kb('min-kb');
    if (maxBytes && minBytes && minBytes > maxBytes) throw new Error('The minimum size is bigger than the maximum.');
    const png = pick('format') === 'png';
    let scale = 1, canvas, blob, over = false;
    // When the dimensions aren't fixed we may shrink the image to meet the limit
    for (let step = 0; step < 12; step++) {
      canvas = renderOutput(size, scale);
      if (png) {
        blob = await encode(canvas, 'image/png');
        over = !!maxBytes && blob.size > maxBytes;
      } else {
        const r = await bestJpeg(canvas, maxBytes);
        blob = r.blob; over = !!r.over;
      }
      if (!over || size) break;
      scale *= 0.85;
    }
    let padded = false;
    if (minBytes && blob.size < minBytes && !png) {
      // Too small for the form: best quality first, then invisible padding
      const best = await encode(canvas, 'image/jpeg', 1);
      if (best.size > blob.size && (!maxBytes || best.size <= maxBytes)) blob = best;
      if (blob.size < minBytes) {
        const goal = maxBytes ? Math.min(minBytes + 512, maxBytes) : minBytes + 512;
        blob = await padJpeg(blob, goal);
        padded = true;
      }
    }
    const under = minBytes && blob.size < minBytes;
    return { blob, w: canvas.width, h: canvas.height, over, under, padded, maxBytes, minBytes, png };
  }

  runBtn.addEventListener('click', async () => {
    runBtn.disabled = true;
    SM.status('Working…');
    try {
      output = await produce();
      showResult();
      SM.status('');
    } catch (e) {
      SM.status(e.message, 'bad');
    }
    runBtn.disabled = false;
  });

  function showResult() {
    const o = output;
    $('#result-sizes').textContent = `${o.w} × ${o.h} px · ${SM.fmtSize(o.blob.size)}`;
    const v = $('#result-verdict');
    let note = '';
    if (o.over) {
      v.textContent = `✕ Over ${SM.fmtSize(o.maxBytes)}`; v.className = 'verdict bad';
      note = o.png
        ? 'PNG files can\'t be squeezed much. Choose JPG to reach the size limit.'
        : 'This is the smallest we could make it at these dimensions. Try smaller dimensions, or check the form allows a larger file.';
    } else if (o.under) {
      v.textContent = `Below ${SM.fmtSize(o.minBytes)}`; v.className = 'verdict bad';
      note = 'The image is already smaller than the minimum this form asks for, even at the best quality. Try larger dimensions.';
    } else if (o.maxBytes || o.minBytes) {
      v.textContent = '✓ Within the size limit'; v.className = 'verdict good';
      if (o.padded) note = 'The image was naturally smaller than your minimum, so invisible padding was added to the file to reach it. The picture itself is unchanged.';
    } else {
      v.textContent = ''; v.className = 'verdict';
    }
    $('#result-note').textContent = note;
    $('#result-note').hidden = !note;
    const img = $('#result-img');
    if (img.src) URL.revokeObjectURL(img.src);
    img.src = URL.createObjectURL(o.blob);
    $('#download').textContent = `Download (${SM.fmtSize(o.blob.size)})`;
    $('#result').hidden = false;
  }

  $('#download').addEventListener('click', () => {
    if (!output) return;
    const ext = output.png ? 'png' : 'jpg';
    SM.download(output.blob, `${SM.baseName(file.name)}-${output.w}x${output.h}.${ext}`);
  });

  window.SMResize = { produce, renderOutput };
})();

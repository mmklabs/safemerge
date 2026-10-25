// Compress PDF to a target size, entirely in the browser.
//
// Strategy, gentlest first:
//  1. Re-save the PDF compactly (no visible change).
//  2. Shrink and re-encode the photos/scans stored inside the PDF. Text, vector
//     drawings and fonts are untouched, so text stays sharp and selectable.
//  3. Only if 2 can't reach the target: turn each page into an image
//     ("flatten"). Text is then no longer selectable, and we say so.
// For a target size we pick the gentlest level that fits.
(() => {
  const { $ } = SM;
  const {
    PDFDocument, PDFName, PDFNumber, PDFArray, PDFRawStream, decodePDFRawStream,
  } = PDFLib;

  // ---- Settings ---------------------------------------------------------

  // [longest side in pixels, JPEG quality], gentlest first
  const IMAGE_LEVELS = [
    [2400, 0.82], [2000, 0.75], [1700, 0.68], [1400, 0.6], [1200, 0.52],
    [1000, 0.45], [850, 0.4], [700, 0.35], [560, 0.3], [440, 0.26],
  ];
  // [dots per inch, JPEG quality] for flattening pages, gentlest first
  const RASTER_LEVELS = [
    [150, 0.72], [130, 0.62], [115, 0.55], [100, 0.5], [90, 0.45],
    [80, 0.4], [72, 0.36], [62, 0.32], [52, 0.28], [44, 0.25],
  ];
  const BALANCED_LEVEL = 2; // used when there's no target size

  // ---- Small helpers ----------------------------------------------------

  const N = (s) => PDFName.of(s);
  const yieldToUI = () => new Promise((r) => setTimeout(r, 0));

  function makeCanvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  async function canvasToJpeg(canvas, quality) {
    const blob = canvas.convertToBlob
      ? await canvas.convertToBlob({ type: 'image/jpeg', quality })
      : await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
    return new Uint8Array(await blob.arrayBuffer());
  }

  function toGray(ctx, w, h) {
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = d[i + 1] = d[i + 2] = y;
    }
    ctx.putImageData(img, 0, 0);
  }

  // ---- Step 2: images inside the PDF -----------------------------------

  function filtersOf(ctx, dict) {
    const f = ctx.lookup(dict.get(N('Filter')));
    if (!f) return [];
    if (f instanceof PDFArray) return f.asArray().map((x) => String(ctx.lookup(x)).slice(1));
    return [String(f).slice(1)];
  }

  function numOf(ctx, v) {
    const x = ctx.lookup(v);
    return x instanceof PDFNumber ? x.asNumber() : NaN;
  }

  function componentsOf(ctx, csObj) {
    const cs = ctx.lookup(csObj);
    if (!cs) return 0;
    const name = String(cs);
    if (name === '/DeviceRGB' || name === '/CalRGB') return 3;
    if (name === '/DeviceGray' || name === '/CalGray') return 1;
    if (cs instanceof PDFArray) {
      const kind = String(ctx.lookup(cs.get(0)));
      if (kind === '/ICCBased') {
        const icc = ctx.lookup(cs.get(1));
        const n = icc && icc.dict ? numOf(ctx, icc.dict.get(N('N'))) : NaN;
        return n === 3 || n === 1 ? n : 0;
      }
      if (kind === '/CalRGB') return 3;
      if (kind === '/CalGray') return 1;
    }
    return 0; // Indexed, Lab, CMYK raw data etc.: leave alone
  }

  // Finds the images we can safely recompress and decodes each one once.
  async function decodeImages(doc, onProgress) {
    const ctx = doc.context;
    const all = ctx.enumerateIndirectObjects();
    const masks = new Set();
    const candidates = [];
    for (const [ref, obj] of all) {
      if (!(obj instanceof PDFRawStream)) continue;
      const d = obj.dict;
      if (ctx.lookup(d.get(N('Subtype'))) !== N('Image')) continue;
      const sm = d.get(N('SMask'));
      if (sm) masks.add(String(sm));
      candidates.push([ref, obj]);
    }
    const images = new Map(); // ref string -> { bitmap, originalBytes }
    let i = 0;
    for (const [ref, obj] of candidates) {
      i++;
      onProgress?.(i / candidates.length);
      const key = String(ref);
      const d = obj.dict;
      if (masks.has(key) || d.get(N('ImageMask')) || d.get(N('Decode')) || d.get(N('Mask'))) continue;
      const w = numOf(ctx, d.get(N('Width'))), h = numOf(ctx, d.get(N('Height')));
      if (!(w > 0 && h > 0) || w * h < 96 * 96) continue; // tiny images aren't worth it
      const filters = filtersOf(ctx, d);
      let bitmap = null;
      try {
        if (filters.length === 1 && filters[0] === 'DCTDecode') {
          bitmap = await createImageBitmap(new Blob([obj.contents], { type: 'image/jpeg' }));
        } else if (filters.every((f) => f === 'FlateDecode') && numOf(ctx, d.get(N('BitsPerComponent'))) === 8) {
          const parms = ctx.lookup(d.get(N('DecodeParms')));
          if (parms && numOf(ctx, parms.get?.(N('Predictor'))) > 1) continue;
          const n = componentsOf(ctx, d.get(N('ColorSpace')));
          if (!n) continue;
          const raw = filters.length ? decodePDFRawStream(obj).decode() : obj.contents;
          if (raw.length < w * h * n) continue;
          const rgba = new Uint8ClampedArray(w * h * 4);
          for (let p = 0, s = 0; p < w * h; p++, s += n) {
            const o = p * 4;
            if (n === 3) { rgba[o] = raw[s]; rgba[o + 1] = raw[s + 1]; rgba[o + 2] = raw[s + 2]; }
            else { rgba[o] = rgba[o + 1] = rgba[o + 2] = raw[s]; }
            rgba[o + 3] = 255;
          }
          bitmap = await createImageBitmap(new ImageData(rgba, w, h));
        }
      } catch (e) { bitmap = null; }
      if (bitmap) images.set(key, { bitmap, originalBytes: obj.contents.length });
      if (i % 5 === 0) await yieldToUI();
    }
    return images;
  }

  // Re-encodes the decoded images at one level and saves a new copy of the PDF.
  async function saveWithImages(bytes, images, level, gray, onProgress) {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    const ctx = doc.context;
    const [maxPx, quality] = level || [];
    if (level) {
      let i = 0;
      for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
        const img = images.get(String(ref));
        if (!img) continue;
        i++;
        onProgress?.(i / images.size);
        const { bitmap } = img;
        const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height));
        const w = Math.max(1, Math.round(bitmap.width * scale));
        const h = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = makeCanvas(w, h);
        const g = canvas.getContext('2d');
        g.fillStyle = '#fff';
        g.fillRect(0, 0, w, h);
        g.imageSmoothingQuality = 'high';
        g.drawImage(bitmap, 0, 0, w, h);
        if (gray) toGray(g, w, h);
        const jpeg = await canvasToJpeg(canvas, quality);
        if (jpeg.length >= img.originalBytes * 0.92) continue; // not worth replacing
        const dict = ctx.obj({});
        const drop = new Set(['/Filter', '/DecodeParms', '/Length', '/ColorSpace', '/BitsPerComponent', '/Width', '/Height', '/Decode']);
        for (const [k, v] of obj.dict.entries()) if (!drop.has(String(k))) dict.set(k, v);
        dict.set(N('Filter'), N('DCTDecode'));
        dict.set(N('Width'), ctx.obj(w));
        dict.set(N('Height'), ctx.obj(h));
        dict.set(N('ColorSpace'), N('DeviceRGB'));
        dict.set(N('BitsPerComponent'), ctx.obj(8));
        ctx.assign(ref, PDFRawStream.of(dict, jpeg));
        if (i % 3 === 0) await yieldToUI();
      }
    }
    return doc.save({ useObjectStreams: true });
  }

  // ---- Step 3: flatten pages into images -------------------------------

  async function flatten(bytes, level, gray, onProgress) {
    const [dpi, quality] = level;
    const pdf = await SM.openForRender(bytes);
    const out = await PDFDocument.create();
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const size = page.getViewport({ scale: 1 });
      const canvas = await SM.renderPage(pdf, n, { scale: dpi / 72 });
      if (gray) toGray(canvas.getContext('2d'), canvas.width, canvas.height);
      const jpeg = await canvasToJpeg(canvas, quality);
      canvas.width = canvas.height = 0;
      const img = await out.embedJpg(jpeg);
      const p = out.addPage([size.width, size.height]);
      p.drawImage(img, { x: 0, y: 0, width: size.width, height: size.height });
      onProgress?.(n / pdf.numPages);
    }
    pdf.destroy();
    return out.save({ useObjectStreams: true });
  }

  // ---- Choosing the level ----------------------------------------------

  // Smallest index in [0, levels.length) whose result fits, assuming results
  // shrink as the index grows. `run(i)` returns bytes. Returns {index, bytes}.
  async function gentlestFit(levels, target, run) {
    let lo = 0, hi = levels.length - 1, best = null;
    const last = await run(hi);
    if (last.length > target) return { index: hi, bytes: last, fits: false };
    best = { index: hi, bytes: last, fits: true };
    hi--;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const bytes = await run(mid);
      if (bytes.length <= target) { best = { index: mid, bytes, fits: true }; hi = mid - 1; }
      else lo = mid + 1;
    }
    return best;
  }

  // Two bisection steps between a gentler level (too big) and a stronger one
  // (fits). Returns the largest result that still fits.
  async function refine(gentle, strong, target, fitting, run) {
    let lo = 0, hi = 1, best = fitting; // t=0 gentle (too big), t=1 strong (fits)
    for (let step = 0; step < 2; step++) {
      const t = (lo + hi) / 2;
      const level = [Math.round(gentle[0] + (strong[0] - gentle[0]) * t), gentle[1] + (strong[1] - gentle[1]) * t];
      const bytes = await run(level);
      if (bytes.length <= target) { best = bytes.length > best.length ? bytes : best; hi = t; }
      else lo = t;
    }
    return best;
  }

  // Main entry. target = bytes or null for "balanced".
  async function compress(bytes, { target, gray, allowFlatten }, report) {
    report('Reading the PDF…', 0);
    const doc = await SM.loadPdf(bytes);
    const pageCount = doc.getPageCount();

    // 1. Compact re-save
    const plain = await saveWithImages(bytes, new Map(), null, false);
    if (target && plain.length <= target && !gray) {
      return { bytes: plain.length < bytes.length ? plain : bytes, method: 'none', fits: true, pageCount };
    }

    // 2. Images inside the PDF
    report('Looking at images inside the PDF…', 0);
    const images = await decodeImages(doc, (f) => report(null, f));
    let result = null;
    if (images.size) {
      const run = async (i) => {
        report(`Shrinking images (step ${i + 1} of ${IMAGE_LEVELS.length})…`, 0);
        return saveWithImages(bytes, images, IMAGE_LEVELS[i], gray, (f) => report(null, f));
      };
      if (!target) {
        result = { bytes: await run(BALANCED_LEVEL), method: 'images', fits: true };
      } else {
        const r = await gentlestFit(IMAGE_LEVELS, target, run);
        result = { bytes: r.bytes, method: 'images', fits: r.fits, level: r.index };
        if (r.fits && r.index > 0) {
          // Fine-tune between the level that fits and the gentler one that didn't,
          // so the file lands closer to the limit with better quality.
          report('Fine-tuning quality…', 0);
          const refined = await refine(IMAGE_LEVELS[r.index - 1], IMAGE_LEVELS[r.index], target, r.bytes,
            (lvl) => saveWithImages(bytes, images, lvl, gray, (f) => report(null, f)));
          result.bytes = refined;
        }
      }
    } else {
      result = { bytes: plain, method: 'none', fits: !target || plain.length <= target };
    }
    images.forEach((img) => img.bitmap.close?.());

    // 3. Flatten pages, only when needed and allowed
    if (target && !result.fits && allowFlatten) {
      const run = async (i) => {
        report(`Flattening pages (step ${i + 1} of ${RASTER_LEVELS.length})…`, 0);
        return flatten(bytes, RASTER_LEVELS[i], gray, (f) => report(null, f));
      };
      const r = await gentlestFit(RASTER_LEVELS, target, run);
      if (r.fits || r.bytes.length < result.bytes.length) {
        let out = r.bytes;
        if (r.fits && r.index > 0) {
          report('Fine-tuning quality…', 0);
          out = await refine(RASTER_LEVELS[r.index - 1], RASTER_LEVELS[r.index], target, r.bytes,
            (lvl) => flatten(bytes, lvl, gray, (f) => report(null, f)));
        }
        result = { bytes: out, method: 'flatten', fits: r.fits };
      }
    }

    // Never hand back something bigger than the original
    if (result.bytes.length >= bytes.length && !gray) {
      result = { bytes, method: 'original', fits: !target || bytes.length <= target };
    }
    result.pageCount = pageCount;
    return result;
  }

  // ---- Page UI ----------------------------------------------------------

  let file = null, original = null, output = null;
  const runBtn = $('#run');
  const preset = document.body.dataset.target; // e.g. "100" (KB) on preset pages

  if (preset) {
    const chip = document.querySelector(`input[name=target][value="${preset}"]`);
    if (chip) chip.checked = true;
  }

  function targetBytes() {
    const v = document.querySelector('input[name=target]:checked').value;
    if (v === 'balanced') return null;
    if (v === 'custom') {
      const kb = parseFloat($('#custom-kb').value);
      return kb > 0 ? Math.round(kb * 1024) : NaN;
    }
    return Number(v) * 1024;
  }

  function sizeLabel(n) {
    return n < 1024 * 1024 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1048576).toFixed(2)} MB`;
  }

  function refreshOptions() {
    const custom = document.querySelector('input[name=target]:checked').value === 'custom';
    $('#custom-field').hidden = !custom;
    $('#result').hidden = true;
  }
  document.querySelectorAll('input[name=target]').forEach((r) => r.addEventListener('change', refreshOptions));
  ['#custom-kb', '#gray', '#allow-flatten'].forEach((s) => $(s).addEventListener('input', () => { $('#result').hidden = true; }));
  refreshOptions();

  SM.dropzone($('#drop'), {
    accept: SM.isPdf,
    async onFiles(files) {
      const f = files[0];
      SM.status('Reading…');
      try {
        const b = await SM.readFile(f);
        await SM.loadPdf(b);
        file = f; original = b;
      } catch (e) { SM.status(e.message, 'bad'); return; }
      $('#drop').hidden = true;
      $('#workspace').hidden = false;
      $('#result').hidden = true;
      $('#filename').textContent = `${file.name} · ${sizeLabel(file.size)}`;
      runBtn.disabled = false;
      SM.status('');
    },
  });

  $('#reset').addEventListener('click', () => {
    file = original = output = null;
    $('#drop').hidden = false;
    $('#workspace').hidden = true;
    runBtn.disabled = true;
    SM.status('');
  });

  async function showPreview(bytes) {
    const holder = $('#preview');
    holder.textContent = '';
    try {
      const pdf = await SM.openForRender(bytes);
      const canvas = await SM.renderPage(pdf, 1, { maxWidth: 520 });
      holder.appendChild(canvas);
      pdf.destroy();
    } catch (e) { holder.textContent = 'Preview not available.'; }
  }

  // Full-size view to check that text is still readable (pinch/scroll to zoom on phones)
  $('#preview').addEventListener('click', async () => {
    if (!output) return;
    const overlay = $('#zoom');
    const body = overlay.querySelector('.zoom-body');
    body.textContent = 'Loading…';
    overlay.hidden = false;
    try {
      const pdf = await SM.openForRender(output.bytes);
      body.textContent = '';
      for (let n = 1; n <= Math.min(pdf.numPages, 3); n++) {
        body.appendChild(await SM.renderPage(pdf, n, { scale: 2 }));
      }
      pdf.destroy();
    } catch (e) { body.textContent = 'Could not show the full-size view.'; }
  });
  $('#zoom-close').addEventListener('click', () => { $('#zoom').hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#zoom').hidden = true; });

  runBtn.addEventListener('click', async () => {
    const target = targetBytes();
    if (Number.isNaN(target)) { SM.status('Type the size you need in KB, for example 150.', 'bad'); return; }
    runBtn.disabled = true;
    $('#result').hidden = true;
    const started = performance.now();
    try {
      output = await compress(original, {
        target, gray: $('#gray').checked, allowFlatten: $('#allow-flatten').checked,
      }, (msg, frac) => { if (msg) SM.status(msg); SM.progress(frac); });
      SM.progress(null);
      SM.status('');
      renderResult(target, (performance.now() - started) / 1000);
    } catch (e) {
      SM.progress(null);
      SM.status('Could not compress: ' + e.message, 'bad');
    }
    runBtn.disabled = false;
  });

  function renderResult(target, seconds) {
    const before = original.length, after = output.bytes.length;
    const saved = Math.max(0, Math.round((1 - after / before) * 100));
    $('#result-sizes').textContent = `${sizeLabel(before)} → ${sizeLabel(after)}`;
    $('#result-saved').textContent = saved ? `${saved}% smaller` : 'Same size';
    const verdict = $('#result-verdict');
    const note = $('#result-note');
    if (target) {
      verdict.textContent = output.fits ? `✓ Under ${sizeLabel(target)}` : `✕ Couldn't get under ${sizeLabel(target)}`;
      verdict.className = 'verdict ' + (output.fits ? 'good' : 'bad');
    } else {
      verdict.textContent = '';
      verdict.className = 'verdict';
    }
    const notes = {
      none: 'Saved in a more compact form. Nothing visible changed.',
      original: 'This PDF was already as small as we could make it without lowering quality, so you get the original file.',
      images: 'Photos and scanned pages inside the PDF were made smaller. Any typed text stays sharp and selectable.',
      flatten: 'To reach this size, pages were turned into images. The text is no longer selectable or searchable. Check it is still readable.',
    };
    let text = notes[output.method];
    if (target && !output.fits) {
      text += ` This is the smallest we could make it. Try "Black & white", or split the PDF and upload fewer pages.`;
    }
    note.textContent = text;
    note.className = 'result-note' + (output.method === 'flatten' ? ' warn' : '');
    $('#result').hidden = false;
    $('#download').textContent = `Download (${sizeLabel(after)})`;
    showPreview(output.bytes);
    SM.status(`Done in ${seconds.toFixed(1)} s.`, 'good');
  }

  $('#download').addEventListener('click', () => {
    if (!output) return;
    const t = targetBytes();
    const suffix = t ? `-${Math.round(t / 1024)}kb` : '-compressed';
    SM.download(output.bytes, `${SM.baseName(file.name)}${suffix}.pdf`, 'application/pdf');
  });

  // Exposed for automated checks
  window.SMCompress = { compress, flatten };
})();

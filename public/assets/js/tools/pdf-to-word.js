// PDF to Word: rebuilds paragraphs, headings, lists, tables and images from a
// PDF and writes a real .docx. A PDF only stores letters at positions, so the
// structure is worked out from their layout. Scanned pages go through OCR.
// Runs in the browser; nothing is uploaded.
(() => {
  const { $ } = SM;
  const TESS = {
    workerPath: '/vendor/tesseract/worker.min.js',
    corePath: '/vendor/tesseract/core',
    langPath: '/vendor/tesseract/lang',
  };
  const OCR_DPI = 300;
  const MAX_IMAGE_SIDE = 2000;
  const MARKER = /^([•●○◦▪▫■□‣⁃∙·*–—-]|\d{1,3}[.)]|[a-z][.)]|\(\w{1,3}\)|[ivx]{1,5}[.)])\s+/;
  const BULLET = /^[•●○◦▪▫■□‣⁃∙·*–—-]$/;

  let file = null, output = null;
  const runBtn = $('#run');
  const pick = (name) => document.querySelector(`input[name=${name}]:checked`).value;

  if ($('#drop')) {
    SM.dropzone($('#drop'), {
      accept: SM.isPdf,
      onFiles(list) {
        file = list[0];
        $('#drop').hidden = true;
        $('#workspace').hidden = false;
        $('#result').hidden = true;
        $('#filename').textContent = `${file.name} · ${SM.fmtSize(file.size)}`;
        runBtn.disabled = false;
        SM.status('');
      },
    });
    $('#reset').addEventListener('click', () => {
      file = null; output = null;
      $('#drop').hidden = false;
      $('#workspace').hidden = true;
      SM.status('');
    });
  }

  const median = (list) => {
    if (!list.length) return 0;
    const s = [...list].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };

  // ---- Reading a page ----------------------------------------------------

  function fontStyle(page, fontName) {
    let name = '';
    try { if (page.commonObjs.has(fontName)) name = page.commonObjs.get(fontName).name || ''; } catch (e) { /* unknown font */ }
    name = name.replace(/^[A-Z]{6}\+/, '');
    return {
      bold: /bold|black|heavy|semibold|demi/i.test(name),
      italic: /italic|oblique/i.test(name),
      font: wordFont(name),
    };
  }

  // Maps a PDF font name onto one every copy of Word has
  function wordFont(name) {
    if (/arial|helvetica/i.test(name)) return 'Arial';
    if (/times|tinos|nimbusrom/i.test(name)) return 'Times New Roman';
    if (/courier|consolas|mono/i.test(name)) return 'Courier New';
    if (/calibri|carlito/i.test(name)) return 'Calibri';
    if (/cambria|caladea/i.test(name)) return 'Cambria';
    if (/georgia/i.test(name)) return 'Georgia';
    if (/verdana/i.test(name)) return 'Verdana';
    if (/tahoma/i.test(name)) return 'Tahoma';
    return '';
  }

  const isJunk = (c) => c === 0xFFFD || c < 32 || (c >= 0xE000 && c <= 0xF8FF && c !== 0xF0B7);

  // Pages can hold text turned on its side, such as a wide table: find the
  // turn that brings most of the text upright
  function textTurn(content, vp) {
    const chars = new Map();
    for (const it of content.items) {
      const m = pdfjsLib.Util.transform(vp.transform, it.transform);
      const angle = Math.round((Math.atan2(m[1], m[0]) * 180) / Math.PI / 90) * 90;
      if (Math.abs(Math.atan2(m[1], m[0]) * 180 / Math.PI - angle) > 2) continue;
      const k = (angle + 360) % 360;
      chars.set(k, (chars.get(k) || 0) + it.str.trim().length);
    }
    const total = [...chars.values()].reduce((s, c) => s + c, 0);
    const [turn, count] = [...chars].sort((a, b) => b[1] - a[1])[0] || [0, 0];
    return count > 0.6 * total ? turn : 0;
  }

  async function readText(page, vp, content) {
    const items = [];
    let sideways = 0, junk = 0, chars = 0;
    for (const it of content.items) {
      const text = it.str.trim();
      if (!text) continue;
      const m = pdfjsLib.Util.transform(vp.transform, it.transform);
      for (const ch of text) { chars++; if (isJunk(ch.codePointAt(0))) junk++; }
      if (Math.abs(m[1]) > 0.1 * Math.abs(m[0]) || m[0] <= 0) { sideways += text.length; continue; }
      items.push({ str: it.str, x: m[4], y: m[5], w: it.width, size: Math.hypot(m[2], m[3]), ...fontStyle(page, it.fontName) });
    }
    return { items, sideways, chars, junk };
  }

  const STROKES = (ops) => [ops.stroke, ops.closeStroke, ops.fill, ops.eoFill, ops.fillStroke, ops.eoFillStroke, ops.closeFillStroke, ops.closeEOFillStroke];

  // Walks the drawing commands for images and for ruled lines (table borders)
  function readGraphics(ops, vp) {
    const OPS = pdfjsLib.OPS, U = pdfjsLib.Util;
    const inks = new Set(STROKES(OPS));
    const images = [], rules = [];
    const stack = [];
    let ctm = [1, 0, 0, 1, 0, 0];

    const addRule = (a, b) => {
      const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
      if (x1 - x0 < 2.5 && y1 - y0 > 6) rules.push({ v: true, x0, x1, y0, y1 });
      else if (y1 - y0 < 2.5 && x1 - x0 > 10) rules.push({ v: false, x0, x1, y0, y1 });
    };

    ops.fnArray.forEach((fn, i) => {
      const args = ops.argsArray[i];
      if (fn === OPS.save) stack.push(ctm);
      else if (fn === OPS.restore) ctm = stack.pop() || ctm;
      else if (fn === OPS.transform) ctm = U.transform(ctm, args);
      else if (fn === OPS.paintFormXObjectBegin) {
        stack.push(ctm);
        if (args[0]) ctm = U.transform(ctm, args[0]);
      } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || ctm;
      else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject) {
        const m = U.transform(vp.transform, ctm);
        const [a, b] = [U.applyTransform([0, 0], m), U.applyTransform([1, 1], m)];
        images.push({
          mask: fn === OPS.paintImageMaskXObject, // black-and-white scans are often stored this way
          name: fn === OPS.paintImageXObject ? args[0] : null, inline: fn === OPS.paintInlineImageXObject ? args[0] : null,
          x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), y0: Math.min(a[1], b[1]), y1: Math.max(a[1], b[1]),
        });
      } else if (fn === OPS.constructPath && inks.has(ops.fnArray[i + 1])) {
        const m = U.transform(vp.transform, ctm);
        const pt = (x, y) => U.applyTransform([x, y], m);
        const [cmds, co] = args;
        let c = 0, last = null;
        for (const cmd of cmds) {
          if (cmd === OPS.moveTo) { last = pt(co[c], co[c + 1]); c += 2; }
          else if (cmd === OPS.lineTo) { const p = pt(co[c], co[c + 1]); c += 2; if (last) addRule(last, p); last = p; }
          else if (cmd === OPS.rectangle) {
            const [x, y, w, h] = co.slice(c, c + 4); c += 4;
            const k = [pt(x, y), pt(x + w, y), pt(x + w, y + h), pt(x, y + h)];
            if (Math.abs(k[2][0] - k[0][0]) > vp.width * 0.95 && Math.abs(k[2][1] - k[0][1]) > vp.height * 0.5) continue; // page background
            for (let e = 0; e < 4; e++) addRule(k[e], k[(e + 1) % 4]);
            if (Math.min(Math.abs(k[2][0] - k[0][0]), Math.abs(k[2][1] - k[0][1])) < 2.5) addRule(k[0], k[2]);
          } else if (cmd === OPS.curveTo) c += 6;
          else if (cmd === OPS.curveTo2 || cmd === OPS.curveTo3) c += 4;
        }
      }
    });
    return { images, rules };
  }

  function pdfImage(page, name) {
    const store = name.startsWith('g_') ? page.commonObjs : page.objs;
    return Promise.race([
      new Promise((res) => store.get(name, res)),
      new Promise((res) => setTimeout(() => res(null), 4000)),
    ]);
  }

  // Turns a decoded PDF image into a JPG, or a PNG if it has transparency
  async function encodeImage(img) {
    const bitmap = img.bitmap || (img instanceof ImageBitmap ? img : null);
    const w = img.width, h = img.height;
    const full = document.createElement('canvas');
    full.width = w; full.height = h;
    const g = full.getContext('2d', { willReadFrequently: true });
    if (bitmap) g.drawImage(bitmap, 0, 0);
    else if (img.data) {
      const out = g.createImageData(w, h), d = out.data, src = img.data;
      if (img.kind === 3) d.set(src.subarray(0, d.length));
      else if (img.kind === 2) for (let i = 0, j = 0; i < d.length; i += 4, j += 3) { d[i] = src[j]; d[i + 1] = src[j + 1]; d[i + 2] = src[j + 2]; d[i + 3] = 255; }
      else {
        const row = (w + 7) >> 3;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const v = src[y * row + (x >> 3)] & (128 >> (x & 7)) ? 255 : 0, i = (y * w + x) * 4;
          d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
        }
      }
      g.putImageData(out, 0, 0);
    } else return null;
    const k = Math.min(1, MAX_IMAGE_SIDE / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    const ctx = c.getContext('2d');
    ctx.drawImage(full, 0, 0, c.width, c.height);
    const px = ctx.getImageData(0, 0, c.width, c.height).data;
    let clear = false;
    for (let i = 3; i < px.length && !clear; i += 40) clear = px[i] < 250;
    if (!clear) { ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
    const type = clear ? 'png' : 'jpeg';
    const blob = await new Promise((r) => c.toBlob(r, `image/${type}`, 0.88));
    return { data: new Uint8Array(await blob.arrayBuffer()), ext: clear ? 'png' : 'jpg', px: c.width, py: c.height };
  }

  async function keepImages(page, found, n, width, height, hasText, cache) {
    const kept = [];
    for (const f of found) {
      const w = f.x1 - f.x0, h = f.y1 - f.y0;
      if (f.mask || w < 14 || h < 14) continue;
      if (hasText && w * h > 0.8 * width * height) continue; // background or the scan behind a text layer
      const key = f.name ? (f.name.startsWith('g_') ? f.name : `${n}:${f.name}`) : `${n}:inline:${kept.length}`;
      if (!cache.has(key)) {
        const img = f.inline || await pdfImage(page, f.name);
        let enc = null;
        try { enc = img ? await encodeImage(img) : null; } catch (e) { /* skip images the browser can't decode */ }
        cache.set(key, enc && { ...enc, key });
      }
      const media = cache.get(key);
      if (media) kept.push({ media, x0: f.x0, x1: f.x1, y0: f.y0, y1: f.y1 });
    }
    return kept;
  }

  // ---- OCR for scanned pages ---------------------------------------------

  let ocrWorker = null, ocrShare = () => {};
  async function ocrItems(pdf, n, turn) {
    if (!ocrWorker) {
      SM.status('Scanned pages found. Loading text recognition (first time only, about 7 MB)…');
      ocrWorker = await Tesseract.createWorker('eng', 1, {
        ...TESS,
        logger: (m) => { if (m.status === 'recognizing text') ocrShare(m.progress); },
      });
    }
    let canvas = await SM.renderPage(pdf, n, { scale: OCR_DPI / 72 });
    if (turn) {
      const c = document.createElement('canvas');
      c.width = turn === 180 ? canvas.width : canvas.height;
      c.height = turn === 180 ? canvas.height : canvas.width;
      const g = c.getContext('2d');
      g.translate(c.width / 2, c.height / 2);
      g.rotate((turn * Math.PI) / 180);
      g.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
      canvas.width = canvas.height = 0;
      canvas = c;
    }
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    canvas.width = canvas.height = 0;
    const { data } = await ocrWorker.recognize(blob, {}, { blocks: true });
    const k = 72 / OCR_DPI, items = [];
    for (const block of data.blocks || []) for (const para of block.paragraphs) for (const line of para.lines) {
      const words = line.words.filter((w) => w.text.trim());
      if (!words.length) continue;
      const height = median(words.map((w) => w.bbox.y1 - w.bbox.y0));
      const size = Math.max(6, Math.round(height * k * 1.1 * 2) / 2);
      const y = median(words.map((w) => w.bbox.y1)) * k;
      for (const w of words) items.push({ str: w.text, x: w.bbox.x0 * k, y, w: (w.bbox.x1 - w.bbox.x0) * k, size, bold: false, italic: false, font: '', confidence: w.confidence });
    }
    // Word heights jitter on a scan: snap near-equal sizes to the page's usual size
    const usual = median(items.map((i) => i.size));
    for (const i of items) if (Math.abs(i.size - usual) < usual * 0.2) i.size = usual;
    const letters = items.reduce((s, i) => s + i.str.length, 0);
    const confidence = letters ? items.reduce((s, i) => s + i.confidence * i.str.length, 0) / letters : 0;
    return { items, letters, confidence };
  }

  // ---- Lines and segments ------------------------------------------------

  const textOf = (items) => runsOf(items).map((r) => r.t).join('');

  function runsOf(items) {
    const runs = [];
    let prev = null;
    for (const it of items) {
      const gap = prev ? it.x - (prev.x + prev.w) : 0;
      const space = prev && gap > 0.18 * it.size && !/\s$/.test(prev.str) && !/^\s/.test(it.str) ? ' ' : '';
      const size = Math.round(it.size * 2) / 2;
      const last = runs[runs.length - 1];
      if (last && last.b === it.bold && last.i === it.italic && last.size === size && last.font === it.font) last.t += space + it.str;
      else runs.push({ t: space + it.str, b: it.bold, i: it.italic, size, font: it.font });
      prev = it;
    }
    return runs;
  }

  function toLines(items, rules) {
    const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
    const lines = [];
    for (const it of sorted) {
      const line = lines[lines.length - 1];
      if (line && Math.abs(it.y - line.y) <= 0.35 * Math.max(it.size, line.size)) {
        line.items.push(it);
        if (it.size > line.size) { line.size = it.size; line.y = it.y; }
      } else lines.push({ y: it.y, size: it.size, items: [it] });
    }
    const vertical = rules.filter((r) => r.v);
    return lines.map((l) => finishLine(l, vertical));
  }

  function finishLine(line, vertical) {
    line.items.sort((a, b) => a.x - b.x);
    const limit = Math.max(9, 1.5 * line.size);
    const segs = [];
    let seg = null;
    for (const it of line.items) {
      const end = seg ? seg.x1 : 0;
      const ruled = seg && vertical.some((r) => r.x0 >= end - 1 && r.x1 <= it.x + 1 && r.y0 <= line.y && r.y1 >= line.y - line.size / 2);
      if (seg && (it.x - end > limit || ruled)) { segs.push(seg); seg = null; }
      if (!seg) seg = { x0: it.x, x1: it.x + it.w, items: [] };
      seg.items.push(it);
      seg.x1 = Math.max(seg.x1, it.x + it.w);
    }
    segs.push(seg);
    // A list marker far from its text is still one line, not two columns
    if (segs.length > 1 && MARKER.test(textOf(segs[0].items) + ' ')) {
      segs[1].items.unshift(...segs[0].items);
      segs[1].x0 = segs[0].x0;
      segs.shift();
    }
    return shape({ ...line, segs });
  }

  function shape(line) {
    line.x0 = line.segs[0].x0;
    line.x1 = line.segs[line.segs.length - 1].x1;
    line.text = line.segs.map((s) => textOf(s.items)).join('\t').trim();
    line.bold = line.segs.every((s) => s.items.every((i) => i.bold));
    return line;
  }

  // ---- Repeated headers and footers --------------------------------------

  const PAGE_NUMBER = /^(page\s*)?#(\s*(of|\/)\s*#)?$/i;

  function pullRepeats(pages) {
    const seen = new Map();
    const usable = pages.length >= 3;
    pages.forEach((p, n) => {
      for (const l of p.lines) {
        const top = l.y < p.height * 0.1, bottom = l.y > p.height * 0.9;
        if (!top && !bottom) continue;
        // Page numbers change between pages; a table row has many numbers and must stay
        const numbers = (l.text.match(/\d+/g) || []).length;
        if (numbers > 2 || l.segs.length > 2) continue;
        l.key = `${top ? 'T' : 'B'}${Math.round(l.y / 6)}${l.text.replace(/\d+/g, '#').toLowerCase()}`;
        if (!seen.has(l.key)) seen.set(l.key, { pages: new Set(), line: l, top, twice: false });
        const entry = seen.get(l.key);
        if (entry.pages.has(n)) entry.twice = true; // same text twice on a page is content
        entry.pages.add(n);
      }
    });
    const need = Math.max(3, pages.length / 2);
    const header = [], footer = [];
    if (usable) {
      for (const s of seen.values()) if (s.pages.size >= need && !s.twice) {
        const lone = PAGE_NUMBER.test(s.line.text.replace(/\d+/g, '#'));
        (s.top ? header : footer).push({ line: s.line, pageNumber: lone });
      }
      const gone = new Set([...header, ...footer].map((h) => h.line.key));
      for (const p of pages) p.lines = p.lines.filter((l) => !gone.has(l.key));
    }
    return { header, footer };
  }

  // ---- Two-column pages --------------------------------------------------

  function splitColumns(lines, width) {
    const STEP = 3;
    const bins = new Array(Math.ceil(width / STEP) + 1).fill(0);
    for (const l of lines) for (const s of l.segs) for (let b = Math.floor(s.x0 / STEP); b <= s.x1 / STEP && b < bins.length; b++) bins[Math.max(0, b)]++;
    const allowed = Math.floor(lines.length / 25);
    let best = null, start = -1;
    const from = Math.floor(width * 0.3 / STEP), to = Math.ceil(width * 0.7 / STEP);
    for (let b = from; b <= to + 1; b++) {
      if (b <= to && bins[b] <= allowed) { if (start < 0) start = b; continue; }
      if (start >= 0 && (!best || b - start > best[1] - best[0])) best = [start, b];
      start = -1;
    }
    const whole = [{ lines, left: null }];
    if (!best || (best[1] - best[0]) * STEP < 9) return whole;
    const mid = ((best[0] + best[1]) / 2) * STEP;
    const lefts = [], rights = [];
    for (const l of lines) for (const s of l.segs) (s.x1 <= mid ? lefts : s.x0 >= mid ? rights : []).push(s);
    const wide = (list) => list.reduce((t, s) => t + s.x1 - s.x0, 0) / Math.max(1, list.length);
    if (lefts.length < 8 || rights.length < 8 || wide(lefts) < width * 0.2 || wide(rights) < width * 0.2) return whole;

    // Lines crossing the gutter (titles) stay full width, between column bands
    const regions = [];
    let left = [], right = [];
    const flush = () => {
      if (left.length) regions.push({ lines: left, left: true });
      if (right.length) regions.push({ lines: right, left: true });
      left = []; right = [];
    };
    for (const l of lines) {
      if (l.segs.some((s) => s.x0 < mid && s.x1 > mid)) { flush(); regions.push({ lines: [l], left: null }); continue; }
      const a = l.segs.filter((s) => s.x1 <= mid), b = l.segs.filter((s) => s.x0 >= mid);
      if (a.length) left.push(shape({ ...l, segs: a, items: a.flatMap((s) => s.items) }));
      if (b.length) right.push(shape({ ...l, segs: b, items: b.flatMap((s) => s.items) }));
    }
    flush();
    regions.columns = true;
    return regions;
  }

  // ---- Tables ------------------------------------------------------------

  function colGaps(lines) {
    const spans = lines.flatMap((l) => l.segs).map((s) => [s.x0, s.x1]).sort((a, b) => a[0] - b[0]);
    const gaps = [];
    let end = spans[0][1];
    for (const [a, b] of spans) {
      if (a - end >= 4) gaps.push([end, a]);
      end = Math.max(end, b);
    }
    return gaps;
  }

  function buildTable(run, rules, multi) {
    // Centred headings add false gaps, so keep only as many as rows have columns
    const most = Math.max(...multi.map((l) => l.segs.length));
    const gaps = colGaps(multi).sort((a, b) => (b[1] - b[0]) - (a[1] - a[0])).slice(0, most - 1).sort((a, b) => a[0] - b[0]);
    const x0 = Math.min(...run.map((l) => l.x0)), x1 = Math.max(...run.map((l) => l.x1));
    const edges = [x0, ...gaps.map(([a, b]) => (a + b) / 2), x1];
    const top = run[0].y - run[0].size, bottom = run[run.length - 1].y + 4;
    const hRules = rules.filter((r) => !r.v && r.y0 > top - 4 && r.y0 < bottom + 4 && r.x0 <= x0 + (x1 - x0) * 0.6 && r.x1 >= x1 - (x1 - x0) * 0.6)
      .map((r) => r.y0).sort((a, b) => a - b).filter((y, i, all) => !i || y - all[i - 1] > 3);
    const ruled = hRules.length >= 2 || rules.some((r) => r.v && r.y0 < bottom && r.y1 > top);
    const blank = () => edges.slice(1).map(() => ({ runs: [] }));
    const put = (row, seg) => {
      const center = seg.x0 + Math.min(4, (seg.x1 - seg.x0) / 2);
      let c = edges.findIndex((e, i) => i && center < e) - 1;
      if (c < 0) c = edges.length - 2;
      const runs = runsOf(seg.items), cell = row[c];
      if (cell.runs.length) cell.runs.push({ ...runs[0], t: ' ' });
      cell.runs.push(...runs);
    };
    const rows = [];
    if (hRules.length >= 2) {
      const band = (l) => hRules.filter((y) => y <= l.y + 2).length;
      let last = null, row = null;
      for (const l of run) {
        const b = band(l);
        if (b !== last) { row = blank(); rows.push(row); last = b; }
        l.segs.forEach((s) => put(row, s));
      }
    } else {
      for (const l of run) {
        if (l.segs.length > 1 || !rows.length) rows.push(blank());
        l.segs.forEach((s) => put(rows[rows.length - 1], s));
      }
    }
    return { type: 'table', rows, widths: edges.slice(1).map((e, i) => e - edges[i]), x0, ruled, y: run[0].y - run[0].size };
  }

  // Bordered tables: the drawn lines give the exact rows and columns
  const cluster = (values, near) => {
    const out = [];
    for (const v of [...values].sort((a, b) => a - b)) if (!out.length || v - out[out.length - 1] > near) out.push(v);
    return out;
  };

  function findGrids(rules) {
    const groups = [];
    for (const r of rules.filter((x) => x.v).sort((a, b) => a.y0 - b.y0)) {
      const g = groups.find((k) => r.y0 <= k.y1 + 3 && r.y1 >= k.y0 - 3);
      if (g) { g.rules.push(r); g.y1 = Math.max(g.y1, r.y1); } else groups.push({ y0: r.y0, y1: r.y1, rules: [r] });
    }
    const grids = [];
    for (const g of groups) {
      const xs = cluster(g.rules.map((r) => (r.x0 + r.x1) / 2), 2.5);
      if (xs.length < 3) continue;
      const across = rules.filter((r) => !r.v && r.y0 > g.y0 - 3 && r.y0 < g.y1 + 3 && r.x1 > xs[0] && r.x0 < xs[xs.length - 1]);
      const ys = cluster([g.y0, g.y1, ...across.map((r) => (r.y0 + r.y1) / 2)], 2.5);
      if (ys.length >= 3) grids.push({ xs, ys, verticals: g.rules });
    }
    return grids;
  }

  function fillGrid(grid, items) {
    const { xs, ys, verticals } = grid;
    const inside = (it) => {
      const x = it.x + Math.min(2, it.w / 2), y = it.y - it.size * 0.3;
      return x >= xs[0] - 1 && x <= xs[xs.length - 1] + 1 && y >= ys[0] - 1 && y <= ys[ys.length - 1] + 1;
    };
    const mine = items.filter(inside), rows = [];
    for (let r = 0; r + 1 < ys.length; r++) {
      const mid = (ys[r] + ys[r + 1]) / 2;
      const walled = (x) => verticals.some((v) => Math.abs((v.x0 + v.x1) / 2 - x) < 2.5 && v.y0 <= mid && v.y1 >= mid);
      const cells = [];
      for (let c = 0; c + 1 < xs.length;) {
        let end = c + 1;
        while (end + 1 < xs.length && !walled(xs[end])) end++; // merged cell
        const held = mine.filter((it) => {
          const x = it.x + Math.min(2, it.w / 2), y = it.y - it.size * 0.3;
          return x >= xs[c] - 1 && x < xs[end] && y >= ys[r] && y < ys[r + 1];
        });
        const runs = [];
        for (const line of toLines(held, [])) {
          if (runs.length) runs.push({ ...runs[runs.length - 1], t: ' ' });
          runs.push(...line.segs.flatMap((seg) => runsOf(seg.items)));
        }
        cells.push({ runs, span: end - c });
        c = end;
      }
      rows.push(cells);
    }
    const kept = rows.filter((row) => row.some((cell) => cell.runs.length));
    return { mine, table: { type: 'table', rows: kept, widths: xs.slice(1).map((x, i) => x - xs[i]), x0: xs[0], ruled: true, y: ys[0] } };
  }

  // Splits a stretch of lines into plain text and tables
  function findTables(lines, rules) {
    const parts = [];
    let plain = [];
    const flush = () => { if (plain.length) parts.push({ type: 'lines', lines: plain }); plain = []; };
    for (let i = 0; i < lines.length;) {
      if (lines[i].segs.length < 2) { plain.push(lines[i++]); continue; }
      const multi = [lines[i]], run = [lines[i]];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const l = lines[j];
        const gap = l.y - run[run.length - 1].y;
        const rowGap = run.length > 1 ? run[run.length - 1].y - run[run.length - 2].y : 0;
        if (gap > 3.2 * l.size || (rowGap && gap > 1.6 * rowGap)) break;
        if (l.segs.length > 1) {
          if (!colGaps([...multi, l]).length) break;
          multi.push(l); run.push(l);
        } else {
          const gaps = colGaps(multi);
          if (gaps.some(([a, b]) => l.x0 < b && l.x1 > a)) break;
          run.push(l);
        }
      }
      while (run[run.length - 1].segs.length < 2) { run.pop(); j--; }
      if (multi.length >= 2 && multi.length / run.length >= 0.5) {
        flush();
        parts.push(buildTable(run, rules, multi));
        i = j;
      } else plain.push(lines[i++]);
    }
    flush();
    return parts;
  }

  // ---- Paragraphs --------------------------------------------------------

  function addLine(para, line) {
    const prev = para.lines[para.lines.length - 1];
    const before = para.runs[para.runs.length - 1];
    if (prev) {
      if (/[a-z][-­]$/.test(before.t) && /^[a-z]/.test(line.text)) before.t = before.t.slice(0, -1);
      else if (!/\s$/.test(before.t)) before.t += ' ';
    }
    const runs = line.segs.flatMap((s, i) => (i ? [{ ...s.items[0], t: '\t', b: false, i: false, size: 0, font: '' }] : []).concat(runsOf(s.items)));
    for (const r of runs) {
      const last = para.runs[para.runs.length - 1];
      if (last && last.b === r.b && last.i === r.i && last.size === r.size && last.font === r.font) last.t += r.t;
      else para.runs.push({ t: r.t, b: r.b, i: r.i, size: r.size, font: r.font });
    }
    para.lines.push(line);
  }

  // A line only wraps when the next word can't fit, so room for it means the
  // paragraph ended there. This also works for uneven right edges.
  function wordWouldFit(prev, line, box) {
    const first = line.items[0], word = first.str.trim().split(/\s/)[0];
    const wordWidth = first.w * (word.length / Math.max(1, first.str.length));
    return prev.x1 + wordWidth + 0.3 * line.size < box.right - 2;
  }

  function flowParagraphs(lines, box, ctx) {
    const paras = [];
    const pitches = lines.slice(1).map((l, i) => l.y - lines[i].y).filter((g) => g > 0 && g < 40);
    const pitch = median(pitches) || (lines[0]?.size || 12) * 1.2;
    const width = box.right - box.left;
    let cur = null;
    for (const line of lines) {
      // "1. Overview" in a large font is a heading, not a list item
      const marker = !/\t/.test(line.text) && line.size < 1.12 * ctx.bodySize && MARKER.exec(line.text + ' ');
      const prev = cur && cur.lines[cur.lines.length - 1];
      let fresh = !cur || !!marker || line.segs.length > 1;
      if (prev) {
        const gap = line.y - prev.y;
        const margin = cur.lines[1] ? cur.lines[1].x0 : prev.x0;
        fresh = fresh || prev.segs.length > 1
          || gap > 1.45 * pitch || gap < 0
          || Math.abs(line.size - prev.size) > 0.8
          || line.bold !== prev.bold
          || wordWouldFit(prev, line, box)
          || (prev.x0 > box.left + 0.25 * width && Math.abs(line.x0 - prev.x0) > 2) // right-aligned lines never wrap
          || (cur.lines[1] ? Math.abs(line.x0 - margin) > 0.8 * line.size : false)
          || (!cur.lines[1] && !cur.marker && line.x0 > prev.x0 + 0.8 * line.size);
        // Wrapped lines of a list item sit under its text, not under the marker
        if (cur.marker && !marker && line.segs.length === 1 && line.x0 > cur.lines[0].x0 + 4 && gap <= 1.45 * pitch && Math.abs(line.size - prev.size) <= 0.8 && !wordWouldFit(prev, line, box)) fresh = false;
      }
      if (fresh) {
        cur = { type: 'p', lines: [], runs: [], marker: marker ? marker[1] : null, y: line.y - line.size, gapFrom: prev ? prev.y : ctx.lastY };
        paras.push(cur);
      }
      addLine(cur, line);
    }
    for (const p of paras) finishParagraph(p, box, ctx);
    return paras;
  }

  function finishParagraph(p, box, ctx) {
    const first = p.lines[0], rest = p.lines[1] || first;
    const size = Math.max(...p.lines.map((l) => l.size));
    const chars = p.lines.reduce((s, l) => s + l.text.length, 0);
    const width = box.right - box.left;
    const ratio = size / ctx.bodySize;
    if (!p.marker && chars < 180 && p.lines.length <= 3 && (ratio >= 1.12 || (ratio >= 1.05 && first.bold))) p.heading = ratio >= 1.7 ? 1 : ratio >= 1.35 ? 2 : 3;
    if (p.gapFrom != null) p.before = Math.min(40, Math.max(0, first.y - p.gapFrom - first.size * 1.2));

    const edges = p.lines.map((l) => [l.x0 - box.left, (box.edge || box.right) - l.x1]);
    if (first.segs.length === 1 && edges.every(([a, b]) => a > 0.08 * width && Math.abs(a - b) < Math.max(8, 0.03 * width))) p.jc = 'center';
    else if (first.segs.length === 1 && edges.every(([a, b]) => b < 6 && a > 0.3 * width)) p.jc = 'right';
    else {
      const margin = Math.max(0, rest.x0 - box.left);
      if (p.marker) {
        const hang = p.lines[1] ? Math.max(10, rest.x0 - first.x0) : 18;
        p.left = Math.max(0, first.x0 - box.left) + hang; p.hanging = hang;
      } else {
        if (margin > 6) p.left = margin;
        if (p.lines[1] && first.x0 - rest.x0 > 4) p.firstLine = first.x0 - rest.x0;
      }
    }
    if (p.marker) {
      const strip = (n) => {
        while (n > 0 && p.runs[0]) {
          const r = p.runs[0], cut = Math.min(n, r.t.length);
          r.t = r.t.slice(cut); n -= cut;
          if (!r.t) p.runs.shift();
        }
      };
      const whole = MARKER.exec(p.runs.map((r) => r.t).join('') + ' ');
      if (whole) {
        strip(whole[0].length);
        if (BULLET.test(p.marker)) p.bullet = true;
        else p.runs.unshift({ t: p.marker + '\t', b: first.items[0].bold, i: first.items[0].italic, size: Math.round(first.size * 2) / 2, font: first.items[0].font });
      }
    }
    if (first.segs.length > 1) {
      p.tabs = first.segs.slice(1).map((s) => (
        Math.abs(s.x1 - box.right) < 8 ? { pos: s.x1 - box.left, val: 'right' } : { pos: s.x0 - box.left, val: 'left' }));
    }
    p.y = first.y - first.size;
  }

  // ---- Page layout -------------------------------------------------------

  function layoutPage(page, margin, ctx) {
    const blocks = [];
    const usable = page.lines.filter((l) => l.text);
    // Where lines wrap on this page; one overlong line shouldn't move it
    const ends = usable.map((l) => l.x1).sort((x, y) => x - y);
    page.textRight = ends.length ? ends[ends.length >= 10 ? Math.floor(ends.length * 0.9) : ends.length - 1] : 0;
    ctx.lastY = null;
    const regions = usable.length ? splitColumns(usable, page.width) : [];
    if (regions.columns) ctx.columnPages++;
    for (const region of regions) {
      for (const part of findTables(region.lines, page.rules)) {
        if (part.type === 'table') { blocks.push(part); ctx.tables++; continue; }
        const box = region.left === true
          ? { left: Math.min(...part.lines.map((l) => l.x0)), right: Math.max(...part.lines.map((l) => l.x1)) }
          : { left: margin.left, right: page.textRight, edge: page.width - margin.right };
        const paras = flowParagraphs(part.lines, box, ctx);
        blocks.push(...paras);
        if (part.lines.length) ctx.lastY = part.lines[part.lines.length - 1].y;
      }
    }
    const placed = [
      ...page.grids,
      ...page.images.map((img) => ({ type: 'image', img, y: img.y0, centered: Math.abs((img.x0 + img.x1) / 2 - page.width / 2) < 12 })),
    ].sort((a, b) => a.y - b.y);
    for (const block of placed) {
      if (block.type === 'table') ctx.tables++;
      const at = blocks.findIndex((b) => b.y > block.y);
      if (at < 0) { blocks.push(block); continue; }
      blocks.splice(at, 0, block);
      const next = blocks[at + 1];
      if (next.type === 'p' && next.before > 8) next.before = 8; // its gap was measured across this block
    }
    if (blocks[0]?.type === 'p') blocks[0].before = 0;
    return blocks;
  }

  function layout(pages, flow) {
    const sizes = new Map();
    for (const p of pages) for (const i of p.items) {
      const k = Math.round(i.size * 2) / 2;
      sizes.set(k, (sizes.get(k) || 0) + i.str.length);
    }
    pages.forEach((p) => {
      p.bounds = toLines(p.items, []); // every line, including those inside tables
      p.grids = [];
      let rest = p.items;
      for (const grid of findGrids(p.rules)) {
        const { mine, table } = fillGrid(grid, rest);
        if (!table.rows.length) continue;
        p.grids.push(table);
        const taken = new Set(mine);
        rest = rest.filter((it) => !taken.has(it));
      }
      p.lines = toLines(rest, p.rules);
    });
    const repeats = pullRepeats(pages);

    const fonts = new Map();
    for (const p of pages) for (const i of p.items) if (i.font) fonts.set(i.font, (fonts.get(i.font) || 0) + i.str.length);
    const bodySize = [...sizes].sort((a, b) => b[1] - a[1])[0]?.[0] || 11;
    const bodyFont = [...fonts].sort((a, b) => b[1] - a[1])[0]?.[0] || 'Calibri';

    const first = pages[0];
    const clampM = (v) => Math.min(144, Math.max(18, v));
    // The usual page's margin, so one stray line doesn't indent everything else
    const usual = (fn) => {
      const mins = pages.filter((p) => p.bounds.length).map((p) => Math.min(...p.bounds.map((l) => fn(l, p))));
      return clampM(mins.length ? median(mins) : 72);
    };
    const margin = {
      left: usual((l) => l.x0), right: usual((l, p) => p.width - l.x1),
      top: usual((l) => l.y - l.size), bottom: usual((l, p) => p.height - l.y),
    };

    const ctx = { bodySize, tables: 0, columnPages: 0, lastY: null };
    const body = [];
    pages.forEach((page, n) => {
      const blocks = layoutPage(page, margin, ctx);
      if (!blocks.length) return;
      const firstBlock = blocks[0], last = body[body.length - 1];
      if (n && body.length) {
        if (!flow) firstBlock.pageBreak = true;
        else if (last.type === 'p' && firstBlock.type === 'p' && !last.heading && !firstBlock.heading && !firstBlock.marker
          && !/[.:;!?]$/.test(last.runs[last.runs.length - 1]?.t.trim() || '.') && /^[a-z]/.test(firstBlock.runs[0]?.t || '')) {
          last.runs[last.runs.length - 1].t += ' ';
          last.runs.push(...firstBlock.runs);
          blocks.shift();
        } else if (firstBlock.type === 'p') firstBlock.before = 8;
      }
      body.push(...blocks);
    });
    return {
      body, bodySize, bodyFont, margin, repeats, tables: ctx.tables, columnPages: ctx.columnPages,
      page: { w: first.width, h: first.height },
    };
  }

  // ---- Writing the .docx -------------------------------------------------

  const WNS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
  const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const tw = (pt) => Math.round(pt * 20);

  function esc(s) {
    return s.replace(/[-]/g, '•')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F￾￿­]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function runXml(r, doc) {
    const props = [];
    if (r.font && r.font !== doc.bodyFont) props.push(`<w:rFonts w:ascii="${r.font}" w:hAnsi="${r.font}" w:cs="${r.font}"/>`);
    if (r.b) props.push('<w:b/>');
    if (r.i) props.push('<w:i/>');
    if (r.size && r.size !== doc.bodySize) props.push(`<w:sz w:val="${Math.round(r.size * 2)}"/><w:szCs w:val="${Math.round(r.size * 2)}"/>`);
    const rPr = props.length ? `<w:rPr>${props.join('')}</w:rPr>` : '';
    const safe = r.t.toWellFormed ? r.t.toWellFormed() : r.t;
    return safe.split('\t').map((part, i) => (
      (i ? `<w:r>${rPr}<w:tab/></w:r>` : '') + (part ? `<w:r>${rPr}<w:t xml:space="preserve">${esc(part)}</w:t></w:r>` : ''))).join('');
  }

  function paraXml(p, doc) {
    const pr = [];
    if (p.heading) pr.push(`<w:pStyle w:val="Heading${p.heading}"/>`);
    if (p.pageBreak) pr.push('<w:pageBreakBefore/>');
    if (p.bullet) pr.push('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>');
    if (p.tabs) pr.push(`<w:tabs>${p.tabs.map((t) => `<w:tab w:val="${t.val}" w:pos="${tw(t.pos)}"/>`).join('')}</w:tabs>`);
    if (p.before != null) pr.push(`<w:spacing w:before="${tw(p.before)}"/>`);
    const ind = [];
    if (p.left) ind.push(`w:left="${tw(p.left)}"`);
    if (p.hanging) ind.push(`w:hanging="${tw(p.hanging)}"`);
    if (p.firstLine) ind.push(`w:firstLine="${tw(p.firstLine)}"`);
    if (ind.length) pr.push(`<w:ind ${ind.join(' ')}/>`);
    if (p.jc) pr.push(`<w:jc w:val="${p.jc}"/>`);
    return `<w:p>${pr.length ? `<w:pPr>${pr.join('')}</w:pPr>` : ''}${p.runs.map((r) => runXml(r, doc)).join('')}</w:p>`;
  }

  function imageXml(b, doc, rid, id) {
    const room = doc.page.w - doc.margin.left - doc.margin.right;
    const roomTall = doc.page.h - doc.margin.top - doc.margin.bottom;
    const k = Math.min(1, room / (b.img.x1 - b.img.x0), roomTall / (b.img.y1 - b.img.y0));
    const cx = Math.round((b.img.x1 - b.img.x0) * k * 12700), cy = Math.round((b.img.y1 - b.img.y0) * k * 12700);
    const pr = (b.pageBreak ? '<w:pageBreakBefore/>' : '') + (b.centered ? '<w:jc w:val="center"/>' : '');
    return `<w:p>${pr ? `<w:pPr>${pr}</w:pPr>` : ''}<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Image ${id}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="Image ${id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  }

  function tableXml(t, doc) {
    const room = doc.page.w - doc.margin.left - doc.margin.right;
    const total = t.widths.reduce((s, w) => s + w, 0);
    const k = Math.min(1, room / total);
    const widths = t.widths.map((w) => tw(w * k));
    const line = (side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="808080"/>`;
    const borders = t.ruled ? `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(line).join('')}</w:tblBorders>` : '';
    const ind = Math.max(0, t.x0 - doc.margin.left);
    const rows = t.rows.map((row) => {
      let col = 0;
      return `<w:tr>${row.map((cell) => {
      const span = cell.span || 1;
      const width = widths.slice(col, col + span).reduce((s, w) => s + w, 0);
      col += span;
      const text = cell.runs.map((r) => r.t).join('').trim();
      const numeric = /^[\d$₹€£¥.,()%\s+-]+$/.test(text) && /\d/.test(text);
      const pPr = `<w:pPr><w:spacing w:before="20" w:after="20"/>${numeric ? '<w:jc w:val="right"/>' : ''}</w:pPr>`;
      const merged = span > 1 ? `<w:gridSpan w:val="${span}"/>` : '';
      return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${merged}</w:tcPr><w:p>${pPr}${cell.runs.map((r) => runXml(r, doc)).join('')}</w:p></w:tc>`;
    }).join('')}</w:tr>`;
    }).join('');
    const lead = t.pageBreak ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : '';
    return `${lead}<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((s, w) => s + w, 0)}" w:type="dxa"/>${ind ? `<w:tblInd w:w="${tw(ind)}" w:type="dxa"/>` : ''}${borders}<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rows}</w:tbl>`;
  }

  function bandXml(kind, entries, doc) {
    const tag = kind === 'header' ? 'hdr' : 'ftr';
    const paras = entries.map(({ line, pageNumber }) => {
      const jc = Math.abs((line.x0 + line.x1) / 2 - doc.page.w / 2) < 20 ? '<w:pPr><w:jc w:val="center"/></w:pPr>' : '';
      if (pageNumber) return `<w:p>${jc}<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`;
      return `<w:p>${jc}${line.segs.flatMap((s) => runsOf(s.items)).map((r) => runXml(r, doc)).join('')}</w:p>`;
    });
    return `${XML}<w:${tag} ${WNS}>${paras.join('')}</w:${tag}>`;
  }

  function stylesXml(doc) {
    const heading = (n, size) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:sz w:val="${size}"/></w:rPr></w:style>`;
    const sz = Math.round(doc.bodySize * 2);
    return `${XML}<w:styles ${WNS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${doc.bodyFont}" w:hAnsi="${doc.bodyFont}" w:eastAsia="${doc.bodyFont}" w:cs="${doc.bodyFont}"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${heading(1, sz + 16)}${heading(2, sz + 8)}${heading(3, sz + 4)}</w:styles>`;
  }

  const NUMBERING = `${XML}<w:numbering ${WNS}><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="360" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
  const SETTINGS = `${XML}<w:settings ${WNS}><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;

  async function writeDocx(doc) {
    const zip = new JSZip();
    const rels = [
      ['rIdS', 'styles', 'styles.xml'], ['rIdN', 'numbering', 'numbering.xml'], ['rIdT', 'settings', 'settings.xml'],
    ];
    const media = new Map();
    let imageId = 0;
    const parts = doc.body.map((b) => {
      if (b.type === 'p') return paraXml(b, doc);
      if (b.type === 'table') return tableXml(b, doc);
      const m = b.img.media;
      if (!media.has(m.key)) {
        const n = media.size + 1;
        media.set(m.key, `rIdM${n}`);
        zip.file(`word/media/image${n}.${m.ext}`, m.data);
        rels.push([`rIdM${n}`, 'image', `media/image${n}.${m.ext}`]);
      }
      return imageXml(b, doc, media.get(m.key), ++imageId);
    });
    if (doc.body[doc.body.length - 1]?.type !== 'p') parts.push('<w:p/>');

    let refs = '';
    for (const [kind, entries] of [['header', doc.repeats.header], ['footer', doc.repeats.footer]]) {
      if (!entries.length) continue;
      zip.file(`word/${kind}1.xml`, bandXml(kind, entries, doc));
      rels.push([`rId${kind}`, kind, `${kind}1.xml`]);
      refs += `<w:${kind}Reference w:type="default" r:id="rId${kind}"/>`;
    }

    const { w, h } = doc.page, m = doc.margin;
    const orient = w > h ? ' w:orient="landscape"' : '';
    const sect = `<w:sectPr>${refs}<w:pgSz w:w="${tw(w)}" w:h="${tw(h)}"${orient}/><w:pgMar w:top="${tw(m.top)}" w:right="${tw(m.right)}" w:bottom="${tw(m.bottom)}" w:left="${tw(m.left)}" w:header="${tw(Math.min(36, m.top / 2))}" w:footer="${tw(Math.min(36, m.bottom / 2))}" w:gutter="0"/></w:sectPr>`;
    zip.file('word/document.xml', `${XML}<w:document ${WNS}><w:body>${parts.join('')}${sect}</w:body></w:document>`);
    zip.file('word/styles.xml', stylesXml(doc));
    zip.file('word/numbering.xml', NUMBERING);
    zip.file('word/settings.xml', SETTINGS);

    const OFFICE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    zip.file('word/_rels/document.xml.rels', `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.map(([id, type, target]) => `<Relationship Id="${id}" Type="${OFFICE}/${type}" Target="${target}"/>`).join('')}</Relationships>`);
    zip.file('_rels/.rels', `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${OFFICE}/officeDocument" Target="word/document.xml"/></Relationships>`);
    const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
    const bands = [['header', doc.repeats.header], ['footer', doc.repeats.footer]].filter(([, e]) => e.length)
      .map(([k]) => `<Override PartName="/word/${k}1.xml" ContentType="${WML}.${k}+xml"/>`).join('');
    zip.file('[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="${WML}.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="${WML}.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="${WML}.numbering+xml"/><Override PartName="/word/settings.xml" ContentType="${WML}.settings+xml"/>${bands}</Types>`);
    return zip.generateAsync({ type: 'blob', mimeType: `${WML}.document`, compression: 'DEFLATE' });
  }

  // ---- Converting --------------------------------------------------------

  async function convert(bytes, { flow = false } = {}) {
    await SM.loadPdf(bytes); // friendly errors for damaged or locked files
    const pdf = await SM.openForRender(bytes);
    const pages = [], cache = new Map();
    let scanned = 0, sideways = 0, damaged = 0;
    try {
      for (let n = 1; n <= pdf.numPages; n++) {
        SM.status(`Reading page ${n} of ${pdf.numPages}…`);
        const base = (n - 1) / pdf.numPages;
        ocrShare = (p) => SM.progress(base + p / pdf.numPages);
        SM.progress(base);
        const page = await pdf.getPage(n);
        const ops = await page.getOperatorList(); // also loads the fonts
        const content = await page.getTextContent();
        let vp = page.getViewport({ scale: 1 });
        const turn = textTurn(content, vp);
        if (turn) vp = page.getViewport({ scale: 1, rotation: (page.rotate + 360 - turn) % 360 });
        const text = await readText(page, vp, content);
        const { images, rules } = readGraphics(ops, vp);
        // Pictures must be read now: drawing the page for OCR clears them
        let kept = await keepImages(page, images, n, vp.width, vp.height, text.chars > 300, cache);
        const covered = images.reduce((a, f) => a + (f.x1 - f.x0) * (f.y1 - f.y0), 0);
        const badText = text.chars > 0 && text.junk / text.chars > 0.3;
        let items = text.items, width = vp.width, height = vp.height, isScan = false;
        if ((text.chars <= 40 && covered > 0.5 * vp.width * vp.height) || badText) {
          // A scan may be sideways or upside down, and reading it the wrong
          // way up gives nonsense, so take the first way that reads confidently.
          // Hardly any words means a photo, such as a cover, not a scanned page.
          let best = null;
          for (const angle of [0, 90, 270, 180]) {
            SM.status(`Reading scanned page ${n} of ${pdf.numPages}…`);
            const read = await ocrItems(pdf, n, angle);
            if (read.letters >= 60 && (!best || read.confidence > best.confidence)) best = { ...read, angle };
            if (best && best.confidence >= 70) break;
          }
          if (best && best.confidence >= 45) {
            items = best.items; isScan = true; scanned++; kept = [];
            if (best.angle === 90 || best.angle === 270) [width, height] = [vp.height, vp.width];
          }
        }
        sideways += text.sideways;
        if (!isScan) damaged += text.junk;
        pages.push({ width, height, items, rules: isScan ? [] : rules, images: kept });
      }
    } finally {
      if (ocrWorker) { await ocrWorker.terminate(); ocrWorker = null; }
      pdf.destroy();
    }
    SM.status('Writing the Word file…');
    const doc = layout(pages, flow);
    if (!doc.body.length) throw new Error('no text or images were found in this PDF.');
    const blob = await writeDocx(doc);
    return {
      blob, pages: pages.length, scanned, sideways, damaged, tables: doc.tables, columnPages: doc.columnPages,
      images: doc.body.filter((b) => b.type === 'image').length,
    };
  }

  if (runBtn) runBtn.addEventListener('click', async () => {
    runBtn.disabled = true;
    $('#result').hidden = true;
    const t0 = performance.now();
    try {
      output = await convert(await SM.readFile(file), { flow: pick('pagination') === 'flow' });
      SM.progress(null);
      showResult((performance.now() - t0) / 1000);
    } catch (e) {
      SM.progress(null);
      SM.status('Could not convert this PDF: ' + e.message, 'bad');
    }
    runBtn.disabled = false;
  });

  function showResult(seconds) {
    const o = output;
    const found = [SM.plural(o.pages, 'page')];
    if (o.tables) found.push(SM.plural(o.tables, 'table'));
    if (o.images) found.push(SM.plural(o.images, 'image'));
    $('#result-sizes').textContent = `${found.join(' · ')} · ${SM.fmtSize(o.blob.size)}`;
    const notes = [];
    if (o.scanned) notes.push(`${SM.plural(o.scanned, 'scanned page')} read with OCR: check names and numbers. Pictures on scanned pages are not copied.`);
    if (o.columnPages) notes.push(`${SM.plural(o.columnPages, 'page')} had two columns and ${o.columnPages === 1 ? 'is' : 'are'} now one column.`);
    if (o.damaged) notes.push('Some letters could not be read from this PDF, usually in non-English text. Check that text carefully.');
    if (o.sideways) notes.push('Sideways or diagonal text, such as watermarks, was left out.');
    notes.push('Fonts and spacing are close matches, so give the document a quick check in Word.');
    $('#result-note').textContent = notes.join(' ');
    $('#download').textContent = `Download Word file (${SM.fmtSize(o.blob.size)})`;
    $('#result').hidden = false;
    SM.status(`Done in ${seconds.toFixed(1)} s.`, 'good');
  }

  const dl = $('#download');
  if (dl) dl.addEventListener('click', () => output && SM.download(output.blob, `${SM.baseName(file.name)}.docx`));

  window.SMWord = { convert };
})();

// OCR: turn scanned PDFs and photos of documents into searchable PDFs and
// plain text. Uses Tesseract.js, self-hosted; nothing is uploaded.
(() => {
  const { $ } = SM;
  const TESS = {
    workerPath: '/vendor/tesseract/worker.min.js',
    corePath: '/vendor/tesseract/core',
    langPath: '/vendor/tesseract/lang',
  };
  const A4_WIDTH = 595.28;

  let files = [];       // File[]
  let output = null;    // { pdf: Uint8Array, text: string }
  const runBtn = $('#run');

  const pick = (name) => document.querySelector(`input[name=${name}]:checked`).value;
  const accept = (f) => SM.isPdf(f) || SM.isImage(f);

  SM.dropzone($('#drop'), {
    accept,
    onFiles(list) {
      files = list;
      $('#drop').hidden = true;
      $('#workspace').hidden = false;
      $('#result').hidden = true;
      const total = list.reduce((s, f) => s + f.size, 0);
      $('#filename').textContent = list.length === 1
        ? `${list[0].name} · ${SM.fmtSize(total)}`
        : `${list.length} files · ${SM.fmtSize(total)}`;
      runBtn.disabled = false;
      SM.status('');
    },
  });

  $('#reset').addEventListener('click', () => {
    files = []; output = null;
    $('#drop').hidden = false;
    $('#workspace').hidden = true;
    SM.status('');
  });

  // ---- Turning inputs into page images ---------------------------------

  const toJpeg = (canvas, q = 0.82) => new Promise((r) => canvas.toBlob(r, 'image/jpeg', q));

  // Yields { kind: 'image', blob, w, h } for pages that need OCR, or
  // { kind: 'keep', bytes, index } for PDF pages that already contain text.
  async function* pagesOf(file, dpi) {
    if (SM.isPdf(file)) {
      const bytes = await SM.readFile(file);
      await SM.loadPdf(bytes); // friendly errors for damaged or locked files
      const pdf = await SM.openForRender(bytes);
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        const text = await page.getTextContent();
        const chars = text.items.reduce((s, i) => s + i.str.trim().length, 0);
        const vp = page.getViewport({ scale: 1 });
        if (chars > 40) { yield { kind: 'keep', bytes, index: n - 1, text: text.items.map((i) => i.str).join(' '), total: pdf.numPages }; continue; }
        const canvas = await SM.renderPage(pdf, n, { scale: dpi / 72 });
        const blob = await toJpeg(canvas);
        canvas.width = canvas.height = 0;
        // Keep the original page and lay the recognised text over it
        yield { kind: 'overlay', bytes, index: n - 1, blob, w: vp.width, h: vp.height, total: pdf.numPages };
      }
      pdf.destroy();
    } else {
      // Photo or scan image: browser applies the photo's own rotation
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, 3000 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close?.();
      const blob = await toJpeg(c, 0.85);
      // Page size: A4 width, keeping the photo's proportions
      yield { kind: 'image', blob, w: A4_WIDTH, h: (A4_WIDTH * c.height) / c.width, total: 1 };
    }
  }

  // ---- Placing the text layer -------------------------------------------

  // The page area as the reader sees it, plus the page's own rotation
  function visibleBox(page) {
    const b = page.getCropBox();
    return { x: b.x, y: b.y, width: b.width, height: b.height, rotation: ((page.getRotation().angle % 360) + 360) % 360 };
  }

  // The text layer was recognised on the page as displayed, so for rotated
  // pages it is turned back to line up with the page's own coordinates.
  function drawLayer(page, layer, box) {
    const { x, y, width: w, height: h, rotation: r } = box;
    const deg = PDFLib.degrees(r);
    if (r === 90) page.drawPage(layer, { x: x + w, y, width: h, height: w, rotate: deg });
    else if (r === 180) page.drawPage(layer, { x: x + w, y: y + h, width: w, height: h, rotate: deg });
    else if (r === 270) page.drawPage(layer, { x, y: y + h, width: h, height: w, rotate: deg });
    else page.drawPage(layer, { x, y, width: w, height: h });
  }

  // ---- OCR ---------------------------------------------------------------

  async function run() {
    const dpi = Number(pick('quality'));
    let worker;
    SM.status('Loading the text recognition engine (first time only, about 7 MB)…');
    SM.progress(0);
    let current = 0, pageCount = 0;
    worker = await Tesseract.createWorker('eng', 1, {
      ...TESS,
      logger: (m) => { if (m.status === 'recognizing text') SM.progress((current + m.progress) / Math.max(1, pageCount)); },
    });
    const out = await PDFLib.PDFDocument.create();
    const texts = [];
    let recognised = 0, kept = 0;
    try {
      for (const file of files) {
        for await (const p of pagesOf(file, dpi)) {
          pageCount = Math.max(pageCount, current + 1);
          if (p.kind === 'keep') {
            const src = await PDFLib.PDFDocument.load(p.bytes);
            const [copy] = await out.copyPages(src, [p.index]);
            out.addPage(copy);
            texts.push(p.text);
            kept++;
          } else {
            SM.status(`Reading text on page ${current + 1}…`);
            // Text-only output: an invisible, searchable text layer (a few KB)
            const res = await worker.recognize(p.blob, { pdfTextOnly: true }, { text: true, pdf: true });
            texts.push(res.data.text.trim());
            const layerDoc = await PDFLib.PDFDocument.load(new Uint8Array(res.data.pdf));
            const [layer] = await out.embedPdf(layerDoc, [0]);
            let page, box;
            if (p.kind === 'overlay') {
              const src = await PDFLib.PDFDocument.load(p.bytes);
              [page] = await out.copyPages(src, [p.index]);
              out.addPage(page);
              box = visibleBox(page);
            } else {
              page = out.addPage([p.w, p.h]);
              const img = await out.embedJpg(new Uint8Array(await p.blob.arrayBuffer()));
              page.drawImage(img, { x: 0, y: 0, width: p.w, height: p.h });
              box = { x: 0, y: 0, width: p.w, height: p.h, rotation: 0 };
            }
            drawLayer(page, layer, box);
            recognised++;
          }
          current++;
          SM.progress(current / Math.max(pageCount, current));
        }
      }
    } finally {
      await worker.terminate();
    }
    const pdf = await out.save({ useObjectStreams: true });
    return { pdf, text: texts.join('\n\n────────\n\n'), recognised, kept, pages: current };
  }

  runBtn.addEventListener('click', async () => {
    runBtn.disabled = true;
    $('#result').hidden = true;
    const t0 = performance.now();
    try {
      output = await run();
      SM.progress(null);
      showResult((performance.now() - t0) / 1000);
    } catch (e) {
      SM.progress(null);
      SM.status('Could not read the text: ' + e.message, 'bad');
    }
    runBtn.disabled = false;
  });

  function showResult(seconds) {
    const o = output;
    $('#result-sizes').textContent = `${SM.plural(o.pages, 'page')} · ${SM.fmtSize(o.pdf.length)}`;
    const notes = [];
    if (o.recognised) notes.push(`Text recognised on ${SM.plural(o.recognised, 'page')}.`);
    if (o.kept) notes.push(`${SM.plural(o.kept, 'page')} already had text and ${o.kept === 1 ? 'was' : 'were'} kept as ${o.kept === 1 ? 'it was' : 'they were'}.`);
    notes.push('Check names and numbers before relying on them: OCR can misread blurry or handwritten text.');
    $('#result-note').textContent = notes.join(' ');
    $('#text-out').value = o.text || '(No text was found.)';
    $('#download').textContent = `Download searchable PDF (${SM.fmtSize(o.pdf.length)})`;
    $('#result').hidden = false;
    SM.status(`Done in ${seconds.toFixed(1)} s.`, 'good');
  }

  const base = () => (files.length === 1 ? SM.baseName(files[0].name) : 'scans');
  $('#download').addEventListener('click', () => output && SM.download(output.pdf, `${base()}-searchable.pdf`, 'application/pdf'));
  $('#download-txt').addEventListener('click', () => output && SM.download(new Blob([output.text], { type: 'text/plain' }), `${base()}.txt`));
  $('#copy-text').addEventListener('click', async () => {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output.text);
      SM.status('Text copied.', 'good');
    } catch (e) {
      $('#text-out').select();
      SM.status('Press Ctrl+C (or ⌘C) to copy the selected text.');
    }
  });

  window.SMOcr = { run, setFiles: (f) => { files = f; } };
})();

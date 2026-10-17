// Shared by Add Page Numbers and Watermark PDF: <body data-tool> picks the mode.
(() => {
  const { $ } = SM;
  const tool = document.body.dataset.tool; // 'numbers' | 'watermark'
  let file = null, bytes = null, count = 0;
  const runBtn = $('#run');
  const val = (id) => $('#' + id).value;
  const pick = (name) => document.querySelector(`input[name=${name}]:checked`).value;

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  }

  // Live labels for range sliders
  document.querySelectorAll('input[type=range][data-out]').forEach((r) => {
    const out = $('#' + r.dataset.out);
    const show = () => { out.textContent = r.value + (r.dataset.unit || ''); };
    r.addEventListener('input', show);
    show();
  });

  SM.dropzone($('#drop'), {
    accept: SM.isPdf,
    async onFiles(files) {
      const f = files[0];
      SM.status('Reading…');
      try {
        const b = await SM.readFile(f);
        count = (await SM.loadPdf(b)).getPageCount();
        file = f; bytes = b;
      } catch (e) { SM.status(e.message, 'bad'); return; }
      $('#drop').hidden = true;
      $('#workspace').hidden = false;
      $('#filename').textContent = `${file.name} · ${SM.plural(count, 'page')}`;
      runBtn.disabled = false;
      SM.status('');
    },
  });

  $('#reset').addEventListener('click', () => {
    file = bytes = null;
    $('#drop').hidden = false;
    $('#workspace').hidden = true;
    runBtn.disabled = true;
    SM.status('');
  });

  function numberLabel(fmt, n, total) {
    return fmt.replace('{n}', n).replace('{total}', total);
  }

  async function addNumbers(doc) {
    const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    const size = +val('size');
    const fmt = val('format');
    const pos = pick('position'); // e.g. 'bottom-center'
    const start = Math.max(0, parseInt(val('start'), 10) || 1);
    const skipFirst = $('#skip-first').checked;
    const pages = doc.getPages();
    const numbered = skipFirst ? pages.length - 1 : pages.length;
    const margin = 28;
    pages.forEach((page, i) => {
      if (skipFirst && i === 0) return;
      const n = start + (skipFirst ? i - 1 : i);
      const text = numberLabel(fmt, n, start + numbered - 1);
      const tw = font.widthOfTextAtSize(text, size);
      const f = SM.visualFrame(page);
      const [vert, horiz] = pos.split('-');
      const vx = horiz === 'left' ? margin : horiz === 'right' ? f.width - margin - tw : (f.width - tw) / 2;
      const vy = vert === 'top' ? f.height - margin - size : margin;
      const { x, y } = f.toPdf(vx, vy);
      page.drawText(text, { x, y, size, font, color: PDFLib.rgb(0.15, 0.15, 0.15), rotate: PDFLib.degrees(f.rotation) });
    });
  }

  async function addWatermark(doc) {
    const text = val('text').trim();
    if (!text) throw new Error('Type the watermark text first.');
    const font = await doc.embedFont($('#bold').checked ? PDFLib.StandardFonts.HelveticaBold : PDFLib.StandardFonts.Helvetica);
    const opacity = +val('opacity') / 100;
    const angle = +pick('angle');
    const color = hexToRgb(val('color'));
    const rel = +val('size') / 100; // text width as a share of the page diagonal / width
    for (const page of doc.getPages()) {
      const f = SM.visualFrame(page);
      const span = angle ? Math.hypot(f.width, f.height) : f.width;
      let size = (span * rel) / Math.max(1, font.widthOfTextAtSize(text, 1));
      size = Math.min(size, f.height * 0.6);
      const tw = font.widthOfTextAtSize(text, size);
      const th = font.heightAtSize(size, { descender: false });
      const a = (angle * Math.PI) / 180;
      // Start point so the text is centred on the page, measured along its own angle
      const vx = f.width / 2 - (Math.cos(a) * tw) / 2 + (Math.sin(a) * th) / 2;
      const vy = f.height / 2 - (Math.sin(a) * tw) / 2 - (Math.cos(a) * th) / 2;
      const { x, y } = f.toPdf(vx, vy);
      page.drawText(text, { x, y, size, font, color, opacity, rotate: PDFLib.degrees(f.rotation + angle) });
    }
  }

  runBtn.addEventListener('click', async () => {
    runBtn.disabled = true;
    SM.status('Working…');
    try {
      const doc = await SM.loadPdf(bytes);
      if (tool === 'numbers') await addNumbers(doc);
      else await addWatermark(doc);
      const out = await doc.save();
      const name = `${SM.baseName(file.name)}-${tool === 'numbers' ? 'numbered' : 'watermarked'}.pdf`;
      SM.download(out, name, 'application/pdf');
      SM.status(`Done. Saved ${name}.`, 'good');
    } catch (e) {
      SM.status(e.message, 'bad');
    }
    runBtn.disabled = false;
  });
})();

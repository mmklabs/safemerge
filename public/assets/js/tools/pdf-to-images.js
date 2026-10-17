(() => {
  const { $ } = SM;
  let file = null, bytes = null, count = 0;
  const runBtn = $('#run');
  const pick = (name) => document.querySelector(`input[name=${name}]:checked`).value;

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
      SM.status(count > 1 ? `You will get ${SM.plural(count, 'image')} in a ZIP file.` : 'You will get one image.');
    },
  });

  $('#reset').addEventListener('click', () => {
    file = bytes = null;
    $('#drop').hidden = false;
    $('#workspace').hidden = true;
    runBtn.disabled = true;
    SM.status('');
  });

  runBtn.addEventListener('click', async () => {
    runBtn.disabled = true;
    const png = pick('format') === 'png';
    const dpi = +pick('dpi');
    const ext = png ? 'png' : 'jpg';
    const base = SM.baseName(file.name);
    try {
      const pdf = await SM.openForRender(bytes);
      const entries = [];
      for (let n = 1; n <= count; n++) {
        SM.status(`Rendering page ${n} of ${count}…`);
        const canvas = await SM.renderPage(pdf, n, { scale: dpi / 72 });
        const blob = await new Promise((res) => canvas.toBlob(res, png ? 'image/png' : 'image/jpeg', 0.9));
        canvas.width = canvas.height = 0; // free memory on long documents
        entries.push({ name: `${base}-page-${String(n).padStart(String(count).length, '0')}.${ext}`, data: blob });
        SM.progress(n / count);
      }
      pdf.destroy();
      if (entries.length === 1) {
        SM.download(entries[0].data, entries[0].name);
        SM.status(`Done. Saved ${entries[0].name}.`, 'good');
      } else {
        SM.status('Packing ZIP…');
        const zip = await SM.zip(entries);
        SM.download(zip, `${base}-images.zip`);
        SM.status(`Done. Saved ${base}-images.zip with ${SM.plural(entries.length, 'image')} (${SM.fmtSize(zip.size)}).`, 'good');
      }
    } catch (e) {
      SM.status('Could not convert: ' + e.message, 'bad');
    }
    SM.progress(null);
    runBtn.disabled = false;
  });
})();

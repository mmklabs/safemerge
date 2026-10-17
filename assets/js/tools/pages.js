// Shared by Rotate PDF and Organize PDF: the page's <body data-tool> picks the mode.
(() => {
  const { $ } = SM;
  const organize = document.body.dataset.tool === 'organize';
  let file = null, bytes = null, count = 0;
  const runBtn = $('#run');
  const grid = SM.pageGrid($('#pages'), { rotate: true, reorder: organize, remove: organize });

  grid.onChange = (pages) => {
    if (!file) return;
    const rotated = pages.filter((p) => p.rotation).length;
    const removed = count - pages.length;
    const reordered = pages.some((p, i, a) => i && p.index < a[i - 1].index);
    const changes = [];
    if (rotated) changes.push(`${SM.plural(rotated, 'page')} rotated`);
    if (removed) changes.push(`${SM.plural(removed, 'page')} deleted`);
    if (reordered) changes.push('order changed');
    runBtn.disabled = !pages.length || !changes.length;
    if (!pages.length) SM.status('Every page is deleted. Keep at least one page.', 'bad');
    else SM.status(changes.length ? changes.join(' · ') : (organize ? 'Drag pages to reorder, or use the buttons under each page.' : 'Use the arrows under a page, or rotate them all at once.'));
  };

  $('#rotate-left')?.addEventListener('click', () => grid.rotateAll(-90));
  $('#rotate-right')?.addEventListener('click', () => grid.rotateAll(90));
  $('#undo').addEventListener('click', () => { if (bytes) grid.load(bytes, count); });

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
      await grid.load(bytes, count);
    },
  });

  $('#reset').addEventListener('click', () => {
    file = bytes = null; count = 0;
    grid.clear();
    $('#drop').hidden = false;
    $('#workspace').hidden = true;
    SM.status('');
  });

  runBtn.addEventListener('click', async () => {
    runBtn.disabled = true;
    SM.status('Saving…');
    try {
      const src = await SM.loadPdf(bytes);
      const plan = grid.pages;
      const out = await PDFLib.PDFDocument.create();
      const copied = await out.copyPages(src, plan.map((p) => p.index));
      copied.forEach((page, i) => {
        const add = plan[i].rotation;
        if (add) page.setRotation(PDFLib.degrees((page.getRotation().angle + add) % 360));
        out.addPage(page);
      });
      const result = await out.save();
      const name = `${SM.baseName(file.name)}-${organize ? 'organized' : 'rotated'}.pdf`;
      SM.download(result, name, 'application/pdf');
      SM.status(`Done. Saved ${name}: ${SM.plural(plan.length, 'page')}.`, 'good');
    } catch (e) {
      SM.status('Could not save: ' + e.message, 'bad');
    }
    runBtn.disabled = false;
  });
})();

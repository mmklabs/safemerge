(() => {
  const { $ } = SM;
  let file = null, bytes = null, count = 0;
  const runBtn = $('#run');
  const grid = SM.pageGrid($('#pages'), { select: true });

  const mode = () => document.querySelector('input[name=mode]:checked').value;

  function refresh() {
    const m = mode();
    $('#ranges-field').hidden = m !== 'ranges';
    $('#select-tools').hidden = m !== 'selected';
    $('#pages').classList.toggle('no-select', m !== 'selected');
    const selected = grid.pages.filter((p) => p.selected).length;
    if (!file) { runBtn.disabled = true; return; }
    if (m === 'selected') {
      runBtn.disabled = selected === 0;
      SM.status(selected ? `${SM.plural(selected, 'page')} selected` : 'Click pages to select the ones you want to keep.');
    } else if (m === 'each') {
      runBtn.disabled = false;
      SM.status(`You will get ${SM.plural(count, 'PDF')} in a ZIP file.`);
    } else {
      runBtn.disabled = false;
      SM.status('Each range becomes its own PDF.');
    }
  }
  grid.onChange = refresh;
  document.querySelectorAll('input[name=mode]').forEach((r) => r.addEventListener('change', refresh));
  $('#select-all').addEventListener('click', () => grid.selectAll(true));
  $('#select-none').addEventListener('click', () => grid.selectAll(false));

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
      $('#ranges').placeholder = count > 3 ? `e.g. 1-3, 4-${count}` : 'e.g. 1, 2-3';
      refresh();
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

  async function extract(src, indices) {
    const out = await PDFLib.PDFDocument.create();
    (await out.copyPages(src, indices)).forEach((p) => out.addPage(p));
    return out.save();
  }

  runBtn.addEventListener('click', async () => {
    runBtn.disabled = true;
    const base = SM.baseName(file.name);
    try {
      const src = await SM.loadPdf(bytes);
      const m = mode();
      if (m === 'selected') {
        const idx = grid.pages.filter((p) => p.selected).map((p) => p.index);
        const out = await extract(src, idx);
        const name = `${base}-pages.pdf`;
        SM.download(out, name, 'application/pdf');
        SM.status(`Done. Saved ${name} with ${SM.plural(idx.length, 'page')}.`, 'good');
      } else {
        const groups = m === 'each'
          ? Array.from({ length: count }, (_, i) => [i + 1, i + 1])
          : SM.parseRanges($('#ranges').value, count);
        const entries = [];
        for (const [i, [a, b]] of groups.entries()) {
          SM.status(`Creating file ${i + 1} of ${groups.length}…`);
          const idx = Array.from({ length: b - a + 1 }, (_, k) => a - 1 + k);
          entries.push({ name: `${base}-${a === b ? a : `${a}-${b}`}.pdf`, data: await extract(src, idx) });
          SM.progress((i + 1) / groups.length);
        }
        if (entries.length === 1) {
          SM.download(entries[0].data, entries[0].name, 'application/pdf');
          SM.status(`Done. Saved ${entries[0].name}.`, 'good');
        } else {
          SM.status('Packing ZIP…');
          const blob = await SM.zip(entries);
          SM.download(blob, `${base}-split.zip`);
          SM.status(`Done. Saved ${base}-split.zip with ${SM.plural(entries.length, 'PDF')}.`, 'good');
        }
      }
    } catch (e) {
      SM.status(e.message, 'bad');
    }
    SM.progress(null);
    runBtn.disabled = false;
  });
})();

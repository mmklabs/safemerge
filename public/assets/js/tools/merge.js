(() => {
  const { $ } = SM;
  const items = []; // { id, file, bytes, pages, error }
  let nextId = 1;
  const runBtn = $('#run');

  const list = SM.sortableList($('#files'), items, {
    renderRow(it, li) {
      li.insertAdjacentHTML('beforeend', '<span class="name"></span><span class="meta"></span>');
      const name = li.querySelector('.name');
      name.textContent = name.title = it.file.name;
      const meta = li.querySelector('.meta');
      if (it.error) { meta.className = 'err'; meta.textContent = it.error; }
      else meta.textContent = it.pages == null ? 'reading…' : `${SM.plural(it.pages, 'page')} · ${SM.fmtSize(it.file.size)}`;
    },
    onChange() {
      const ready = items.filter((it) => it.pages != null);
      const busy = items.some((it) => it.pages == null && !it.error);
      runBtn.disabled = busy || ready.length < 2;
      $('#options').hidden = !items.length;
      const total = ready.reduce((s, it) => s + it.pages, 0);
      if (!items.length) SM.status('');
      else if (ready.length < 2 && !busy) SM.status('Add at least two PDFs to merge.');
      else SM.status(`${SM.plural(ready.length, 'file')} · ${SM.plural(total, 'page')} in total`);
    },
  });

  SM.dropzone($('#drop'), {
    accept: SM.isPdf,
    async onFiles(files) {
      for (const file of files) {
        const it = { id: nextId++, file, bytes: null, pages: null, error: null };
        items.push(it);
        list.render();
        try {
          it.bytes = await SM.readFile(file);
          it.pages = (await SM.loadPdf(it.bytes)).getPageCount();
        } catch (e) { it.error = e.message; }
        list.render();
      }
    },
  });

  $('#reset').addEventListener('click', () => { items.length = 0; list.render(); });

  runBtn.addEventListener('click', async () => {
    runBtn.disabled = true;
    SM.status('Merging…');
    try {
      const out = await PDFLib.PDFDocument.create();
      const ready = items.filter((it) => it.pages != null);
      for (const [i, it] of ready.entries()) {
        const src = await SM.loadPdf(it.bytes);
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((p) => out.addPage(p));
        SM.progress((i + 1) / ready.length);
      }
      const bytes = await out.save();
      let name = $('#outname').value.trim() || 'merged.pdf';
      if (!/\.pdf$/i.test(name)) name += '.pdf';
      SM.download(bytes, name, 'application/pdf');
      SM.status(`Done. Saved ${name}: ${SM.plural(out.getPageCount(), 'page')}, ${SM.fmtSize(bytes.length)}.`, 'good');
    } catch (e) {
      SM.status('Merge failed: ' + e.message, 'bad');
    }
    SM.progress(null);
    runBtn.disabled = false;
  });
})();

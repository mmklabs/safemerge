(() => {
  const { $ } = SM;
  const items = []; // { id, file, url, error }
  let nextId = 1;
  const runBtn = $('#run');
  const SIZES = { a4: [595.28, 841.89], letter: [612, 792] };
  const MARGINS = { none: 0, small: 18, large: 42 };

  const list = SM.sortableList($('#files'), items, {
    renderRow(it, li) {
      li.insertAdjacentHTML('beforeend', '<img class="thumb" alt=""><span class="name"></span><span class="meta"></span>');
      li.querySelector('.thumb').src = it.url;
      const name = li.querySelector('.name');
      name.textContent = name.title = it.file.name;
      li.querySelector('.meta').textContent = SM.fmtSize(it.file.size);
    },
    onChange() {
      runBtn.disabled = !items.length;
      $('#options').hidden = !items.length;
      SM.status(items.length ? `${SM.plural(items.length, 'image')} · one page each` : '');
    },
  });

  SM.dropzone($('#drop'), {
    accept: SM.isImage,
    onFiles(files) {
      files.forEach((file) => items.push({ id: nextId++, file, url: URL.createObjectURL(file) }));
      list.render();
    },
  });

  $('#reset').addEventListener('click', () => {
    items.forEach((it) => URL.revokeObjectURL(it.url));
    items.length = 0;
    list.render();
  });

  const pick = (name) => document.querySelector(`input[name=${name}]:checked`).value;

  // Decode with the browser so phone photos come out the right way up
  // (it applies the EXIF orientation), then embed in the PDF.
  async function embed(doc, file) {
    if (file.type === 'image/png' || /\.png$/i.test(file.name)) {
      try { return await doc.embedPng(await SM.readFile(file)); } catch (e) { /* fall through to re-encode */ }
    }
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.92));
    return doc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
  }

  runBtn.addEventListener('click', async () => {
    runBtn.disabled = true;
    const size = pick('size'), orient = pick('orient'), margin = MARGINS[pick('margin')];
    try {
      const doc = await PDFLib.PDFDocument.create();
      for (const [i, it] of items.entries()) {
        SM.status(`Adding image ${i + 1} of ${items.length}…`);
        let img;
        try { img = await embed(doc, it.file); }
        catch (e) { throw new Error(`${it.file.name} could not be read as an image.`); }
        let pw, ph;
        if (size === 'fit') {
          pw = img.width + margin * 2; ph = img.height + margin * 2;
        } else {
          [pw, ph] = SIZES[size];
          const landscape = orient === 'landscape' || (orient === 'auto' && img.width > img.height);
          if (landscape) [pw, ph] = [ph, pw];
        }
        const page = doc.addPage([pw, ph]);
        const scale = Math.min((pw - margin * 2) / img.width, (ph - margin * 2) / img.height, size === 'fit' ? 1 : Infinity);
        const w = img.width * scale, h = img.height * scale;
        page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
        SM.progress((i + 1) / items.length);
      }
      const bytes = await doc.save();
      const name = items.length === 1 ? `${SM.baseName(items[0].file.name)}.pdf` : 'images.pdf';
      SM.download(bytes, name, 'application/pdf');
      SM.status(`Done. Saved ${name}: ${SM.plural(items.length, 'page')}, ${SM.fmtSize(bytes.length)}.`, 'good');
    } catch (e) {
      SM.status(e.message, 'bad');
    }
    SM.progress(null);
    runBtn.disabled = false;
  });
})();

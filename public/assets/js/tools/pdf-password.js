// Unlock PDF (remove a password you know) and Protect PDF (add a password).
// Both use qpdf compiled to WebAssembly, loaded only on these two pages.
(() => {
  const { $ } = SM;
  const mode = document.body.dataset.tool; // 'unlock' | 'protect'
  let file = null, bytes = null, output = null;

  // A fresh qpdf instance per job keeps its virtual file system clean
  async function qpdf() {
    if (typeof Module !== 'function') throw new Error('The encryption library did not load. Reload the page.');
    const log = [];
    const q = await Module({
      noInitialRun: true,
      locateFile: () => '/vendor/qpdf/qpdf.wasm',
      print: (t) => log.push(t), printErr: (t) => log.push(t),
    });
    q.run = (args) => {
      log.length = 0;
      let code = 0;
      try { code = q.callMain(args); } catch (e) { code = typeof e?.status === 'number' ? e.status : 2; }
      return { code, log: log.join('\n') };
    };
    return q;
  }
  // qpdf exit codes: 0 = ok, 3 = ok with warnings, 2 = error
  const ok = (r) => r.code === 0 || r.code === 3;

  function isEncrypted(b) {
    return PDFLib.PDFDocument.load(b, { ignoreEncryption: true }).then((d) => d.isEncrypted);
  }

  // ---- Shared loading --------------------------------------------------

  SM.dropzone($('#drop'), {
    accept: SM.isPdf,
    async onFiles(files) {
      const f = files[0];
      SM.status('Reading…');
      try {
        const b = await SM.readFile(f);
        let enc;
        try { enc = await isEncrypted(b); } catch (e) { throw new Error('This file could not be read as a PDF. It may be damaged.'); }
        file = f; bytes = b; output = null;
        $('#drop').hidden = true;
        $('#workspace').hidden = false;
        $('#result').hidden = true;
        $('#filename').textContent = `${f.name} · ${SM.fmtSize(f.size)}`;
        SM.status('');
        if (mode === 'unlock') await prepareUnlock(enc);
        else prepareProtect(enc);
      } catch (e) { SM.status(e.message, 'bad'); }
    },
  });

  $('#reset').addEventListener('click', () => {
    file = bytes = output = null;
    $('#drop').hidden = false;
    $('#workspace').hidden = true;
    document.querySelectorAll('input[type=password]').forEach((i) => { i.value = ''; });
    SM.status('');
  });

  // Show/hide password text
  document.querySelectorAll('[data-reveal]').forEach((btn) => btn.addEventListener('click', () => {
    const input = $('#' + btn.dataset.reveal);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.textContent = show ? 'Hide' : 'Show';
  }));

  function showResult(title, note, name) {
    $('#result-sizes').textContent = title;
    $('#result-note').textContent = note;
    $('#download').textContent = `Download (${SM.fmtSize(output.length)})`;
    $('#download').dataset.name = name;
    $('#result').hidden = false;
  }

  $('#download').addEventListener('click', () => {
    if (output) SM.download(output, $('#download').dataset.name, 'application/pdf');
  });

  // ---- Unlock ------------------------------------------------------------

  async function prepareUnlock(enc) {
    $('#pw-row').hidden = true;
    if (!enc) {
      SM.status('This PDF has no password or restrictions. You can use it as it is.', 'good');
      return;
    }
    // Restrictions only (printing/copying blocked, but no password to open)?
    SM.status('Checking the protection…');
    const q = await qpdf();
    q.FS.writeFile('/in.pdf', bytes);
    const r = q.run(['--decrypt', '/in.pdf', '/out.pdf']);
    if (ok(r)) {
      output = q.FS.readFile('/out.pdf');
      SM.status('');
      showResult('✓ Restrictions removed',
        'This PDF opened without a password but blocked printing, copying or editing. Those limits are now gone.',
        `${SM.baseName(file.name)}-unlocked.pdf`);
      return;
    }
    SM.status('This PDF needs a password to open. Type it below.');
    $('#pw-row').hidden = false;
    $('#password').focus();
  }

  async function unlock() {
    const pw = $('#password').value;
    if (!pw) { SM.status('Type the password first.', 'bad'); return; }
    $('#run').disabled = true;
    SM.status('Unlocking…');
    try {
      const q = await qpdf();
      q.FS.writeFile('/in.pdf', bytes);
      const r = q.run([`--password=${pw}`, '--decrypt', '/in.pdf', '/out.pdf']);
      if (!ok(r)) {
        // We already know this file needs a password, so a failure here means the password was wrong
        SM.status('That password didn\'t work. Check capital letters and spaces, then try again.', 'bad');
        $('#password').select();
      } else {
        output = q.FS.readFile('/out.pdf');
        $('#password').value = '';
        SM.status('');
        showResult('✓ Password removed', 'The PDF now opens without a password. Keep it somewhere safe.',
          `${SM.baseName(file.name)}-unlocked.pdf`);
      }
    } catch (e) {
      SM.status('Could not unlock: ' + e.message, 'bad');
    }
    $('#run').disabled = false;
  }

  // ---- Protect -----------------------------------------------------------

  function prepareProtect(enc) {
    if (enc) SM.status('This PDF is already protected. Remove its password with Unlock PDF first, then protect it again.', 'bad');
    $('#run').disabled = enc;
  }

  function randomPassword() {
    const a = new Uint8Array(18);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(36).padStart(2, '0')).join('');
  }

  async function protect() {
    const pw = $('#password').value, pw2 = $('#password2').value;
    if (pw.length < 4) { SM.status('Use a password of at least 4 characters. Longer is safer.', 'bad'); return; }
    if (pw !== pw2) { SM.status('The two passwords don\'t match.', 'bad'); return; }
    const blockPrint = $('#no-print').checked, blockCopy = $('#no-copy').checked, blockEdit = $('#no-edit').checked;
    const restricted = blockPrint || blockCopy || blockEdit;
    // With restrictions, a hidden random owner password stops anyone lifting them
    const owner = restricted ? randomPassword() : pw;
    const args = ['/in.pdf', '--encrypt', pw, owner, '256'];
    if (blockPrint) args.push('--print=none');
    if (blockCopy) args.push('--extract=n');
    if (blockEdit) args.push('--modify=none');
    args.push('--', '/out.pdf');
    $('#run').disabled = true;
    SM.status('Protecting…');
    try {
      const q = await qpdf();
      q.FS.writeFile('/in.pdf', bytes);
      const r = q.run(args);
      if (!ok(r)) throw new Error('qpdf could not encrypt this file.');
      output = q.FS.readFile('/out.pdf');
      $('#password').value = $('#password2').value = '';
      SM.status('');
      showResult('✓ Password added',
        'The PDF now needs your password to open (AES-256 encryption). If you forget the password, the file cannot be recovered.',
        `${SM.baseName(file.name)}-protected.pdf`);
    } catch (e) {
      SM.status('Could not protect: ' + e.message, 'bad');
    }
    $('#run').disabled = false;
  }

  $('#run').addEventListener('click', () => (mode === 'unlock' ? unlock() : protect()));
  $('#password').addEventListener('keydown', (e) => { if (e.key === 'Enter' && mode === 'unlock') unlock(); });

  window.SMPassword = { qpdf };
})();

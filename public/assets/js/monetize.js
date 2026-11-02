// Ads, donations (UPI and Ko-fi) and the ad-cookie choice.
//
// Rules this file follows:
//  • Google AdSense loads ONLY after the visitor clicks "Allow ad cookies".
//    Nothing from Google loads before that, in any country.
//  • Everyone else sees EthicalAds (no cookies, no tracking) if it is set up.
//  • If neither is set up, no ad code loads and no banner is shown.
//  • None of this code can see the visitor's files.
(() => {
  const cfg = window.SAFEMERGE_CONFIG || {};
  const KEY = 'safemerge-ad-choice'; // 'allow' | 'deny'
  const hasAdsense = !!(cfg.adsenseClient && cfg.adsenseSlot);
  const hasEthical = !!cfg.ethicalAdsPublisher;

  const getChoice = () => { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
  const setChoice = (v) => { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch (e) { /* private mode */ } };

  function loadScript(src, attrs = {}) {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    Object.entries(attrs).forEach(([k, v]) => s.setAttribute(k, v));
    document.head.appendChild(s);
    return s;
  }

  function fillSlots() {
    const slots = [...document.querySelectorAll('.ad-slot')];
    if (!slots.length) return;
    const choice = getChoice();
    if (hasAdsense && choice === 'allow') {
      loadScript(`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(cfg.adsenseClient)}`, { crossorigin: 'anonymous' });
      slots.forEach((slot) => {
        slot.innerHTML = `<div style="width:100%"><span class="ad-label">Advertisement</span>
          <ins class="adsbygoogle" style="display:block" data-ad-client="${cfg.adsenseClient}"
            data-ad-slot="${cfg.adsenseSlot}" data-ad-format="auto" data-full-width-responsive="true"></ins></div>`;
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      });
    } else if (hasEthical) {
      loadScript('https://media.ethicalads.io/media/client/ethicalads.min.js');
      slots.forEach((slot) => {
        slot.innerHTML = `<div data-ea-publisher="${cfg.ethicalAdsPublisher}" data-ea-type="image" data-ea-style="stickybox-off"></div>`;
      });
    }
  }

  function showBanner() {
    if (document.querySelector('.consent')) return;
    const el = document.createElement('div');
    el.className = 'consent';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Ad cookie choice');
    el.innerHTML = `<div class="wrap">
      <p><strong>Your files never leave your device, whatever you choose.</strong>
      SafeMerge is free because of ads. You can allow Google ads, which use cookies,
      or keep cookie-free ads only. <a href="/privacy/">Details</a></p>
      <div class="bar">
        <button class="btn small" data-choice="deny">Cookie-free ads only</button>
        <button class="btn small primary" data-choice="allow">Allow ad cookies</button>
      </div></div>`;
    el.addEventListener('click', (e) => {
      const c = e.target.closest('[data-choice]')?.dataset.choice;
      if (!c) return;
      const before = getChoice();
      setChoice(c);
      el.remove();
      // Google's code can't be unloaded from a running page, so reload when turning it off
      if (before === 'allow' && c === 'deny') location.reload();
      else fillSlots();
    });
    document.body.appendChild(el);
  }

  // UPI only works for people with an Indian bank account, so offer it by time zone.
  // Nothing is sent anywhere to decide this; the browser already knows its time zone.
  function wantsUpi() {
    if (!cfg.upiId) return false;
    try { return ['Asia/Kolkata', 'Asia/Calcutta'].includes(Intl.DateTimeFormat().resolvedOptions().timeZone); }
    catch (e) { return false; }
  }

  function upiLink() {
    const q = new URLSearchParams({ pa: cfg.upiId, pn: cfg.upiName || cfg.siteName || '', cu: 'INR' });
    // Some UPI apps don't decode %40, so keep the @ in the UPI ID as is
    return `upi://pay?${q.toString().replace(/\+/g, '%20').replace(/%40/g, '@')}`;
  }

  function showSupport() {
    let dlg = document.querySelector('.support-dialog');
    if (!dlg) {
      const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      const phone = matchMedia('(pointer: coarse)').matches;
      dlg = document.createElement('dialog');
      dlg.className = 'support-dialog';
      dlg.setAttribute('aria-labelledby', 'support-title');
      dlg.innerHTML = `
        <h2 id="support-title">Support SafeMerge</h2>
        <p>SafeMerge is free, with no sign-up, and your files never leave your device.
        If it helped you, you can chip in any amount by UPI.</p>
        ${phone ? `<a class="btn primary upi-pay" href="${esc(upiLink())}">Pay with a UPI app</a>` : ''}
        <div class="upi-qr" ${phone ? 'hidden' : ''} aria-label="UPI QR code"></div>
        ${phone ? '' : '<p class="upi-hint">Scan with any UPI app.</p>'}
        <div class="upi-id"><span>UPI ID</span> <code>${esc(cfg.upiId)}</code>
          <button class="btn small" data-copy>Copy</button></div>
        ${cfg.donateUrl ? `<p class="upi-hint">No UPI? <a href="${esc(cfg.donateUrl)}" rel="noopener" target="_blank">Support us here</a>.</p>` : ''}
        <div class="bar"><button class="btn small" data-close>Close</button></div>`;
      dlg.addEventListener('click', (e) => {
        if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();
        const copy = e.target.closest('[data-copy]');
        if (copy) {
          navigator.clipboard?.writeText(cfg.upiId).then(() => { copy.textContent = 'Copied'; }, () => {});
        }
      });
      document.body.appendChild(dlg);
      if (!phone) {
        // Drawn on this device from the UPI ID; no QR service is contacted
        const draw = () => {
          const qr = window.qrcode(0, 'M');
          qr.addData(upiLink());
          qr.make();
          dlg.querySelector('.upi-qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 16, scalable: true });
        };
        if (window.qrcode) draw();
        else loadScript('/vendor/qrcode/qrcode.js').addEventListener('load', draw);
      }
    }
    dlg.showModal();
  }

  function init() {
    if (wantsUpi()) {
      document.querySelectorAll('[data-donate]').forEach((a) => {
        a.removeAttribute('target');
        a.hidden = false;
        a.addEventListener('click', (e) => { e.preventDefault(); showSupport(); });
      });
    } else if (cfg.donateUrl) {
      document.querySelectorAll('[data-donate]').forEach((a) => { a.href = cfg.donateUrl; a.hidden = false; });
    }
    const choicesLink = document.querySelector('#ad-choices');
    if (choicesLink) {
      choicesLink.hidden = !hasAdsense;
      choicesLink.addEventListener('click', showBanner);
    }
    if (hasAdsense && !getChoice()) showBanner();
    fillSlots();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

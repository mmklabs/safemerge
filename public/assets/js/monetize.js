// Ads, donations and the ad-cookie choice.
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

  function init() {
    if (cfg.donateUrl) {
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

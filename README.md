# SafeMerge

Private PDF tools that run entirely in the browser. Files are never uploaded.

**Copyright © 2026 mmklabs. All rights reserved.** The code is public so anyone can verify that files never leave their device. It is not open source: see [COPYRIGHT](COPYRIGHT).

**Tools:** Merge · Compress (to a target size) · Split · Rotate · Organize (reorder/delete) · Images → PDF · PDF → images · Page numbers · Watermark

It is a plain static website: HTML, CSS and JavaScript, with no server, no database and no build tools to install. Any static host can serve it for free.

---

## 1. Try it on your Mac

```bash
cd ~/projects/public_project/pdf_merger/public
python3 -m http.server 8770
```

Then open http://localhost:8770 in your browser. Stop it with Ctrl+C.

## 2. Put it on the internet (free)

### Step 1: Buy the domain
`safemergefiles.com` was free when checked (October 2026). Buy it from **Cloudflare Registrar** (sold at cost, about $10/year) or Namecheap or Porkbun. If you pick a different domain, change `SITE_URL` in `scripts/build_pages.py` and run `python3 scripts/build_pages.py`.

### Step 2: Put the code on GitHub
1. Create a free account at github.com.
2. Create a new **public or private** repository called `safemerge`.
3. Push this folder to it (GitHub shows the exact commands after you create the repository).

### Step 3: Host it on Cloudflare
1. Create a free account at dash.cloudflare.com → **Workers & Pages** → **Create** → **Import a repository** → pick `mmklabs/safemerge`.
2. Leave **Build command** empty and keep **Deploy command** as `npx wrangler deploy`. The `wrangler.jsonc` file tells Cloudflare to serve the `public` folder.
3. Deploy. You get a `safemerge.<your-subdomain>.workers.dev` address within a minute.
4. Project → **Settings** → **Domains & Routes** → add `safemergefiles.com`. If you bought the domain at Cloudflare, it connects automatically.

Every time you push a change to GitHub, the site updates by itself.

(Netlify or Cloudflare Pages work too: set the publish/output directory to `public`.)

### Step 4: Tell Google about it
1. Go to **Google Search Console** (search.google.com/search-console) → add your domain → verify it.
2. Submit `https://safemergefiles.com/sitemap.xml`.

New sites usually take weeks to months to show up in search results.

---

## 3. Turn on earnings

All settings live in **`public/assets/js/config.js`**. Anything left empty stays switched off, and the site works without any of it.

### Donations (do this first: instant, no approval)
1. Make a free page on **Ko-fi** (ko-fi.com) or **Buy Me a Coffee**.
2. Put the link in `donateUrl`. A "Support us" button appears in the header and footer.

### EthicalAds (cookie-free ads, shown to everyone by default)
1. Apply at ethicalads.io/publishers. They review sites by hand and focus on developer and tech audiences, so approval isn't guaranteed. Apply once you have some traffic.
2. Put your publisher id in `ethicalAdsPublisher`.
- Alternative if they decline: **Carbon Ads** (carbonads.net), another privacy-focused ad network. Check their current cookie policy before adding it. It needs a small code change in `public/assets/js/monetize.js`, so ask for help when you get there.

### Google AdSense (only for visitors who click "Allow ad cookies")
1. Apply at adsense.google.com once the site is live on your domain and has its privacy page. Google often rejects brand-new sites with little traffic, so try again after a few months if you're refused.
2. In AdSense: **Privacy & messaging → European regulations → create a message** (Google's certified consent form). This is **required** to show ads in the EU, UK and Switzerland. Also set up the **US state regulations** message.
3. Create a **display ad unit** (Ads → By ad unit). Copy:
   - the client id (`ca-pub-…`) → `adsenseClient`
   - the slot id → `adsenseSlot`
4. Edit `public/ads.txt` with your publisher id (instructions are inside the file).

**How it behaves:** first-time visitors see a small banner. Google's code never loads unless the visitor clicks **Allow ad cookies**. If they choose **Cookie-free ads only**, they see EthicalAds. They can change their mind with the **Ad cookie choice** link in the footer. In the EU, UK and Switzerland, Google then shows its own consent form as well.

---

## 4. What you can promise visitors

| Claim | True? |
|---|---|
| "Your files never leave your device / are never uploaded" | ✅ Always, in every country, whatever ads run |
| "SafeMerge doesn't track you" | ✅ Visits are counted with cookie-free Cloudflare Web Analytics; no advertising trackers |
| "No data is collected at all" | ⚠️ Only while AdSense is off. Once a visitor allows ad cookies, Google collects data, and the privacy page says so |

Visitor counts come from Cloudflare's cookie-free **Web Analytics** (Cloudflare dashboard → Analytics & Logs → Web Analytics). Don't add Google Analytics or other trackers: it would break the promise on the privacy page.

**Before launch:** set up a real email address for `privacy@safemergefiles.com` (Cloudflare Email Routing forwards it to your Gmail for free), or change the address at the bottom of the privacy page in `scripts/build_pages.py`.

This isn't legal advice. If the site starts earning real money, a short review by a lawyer familiar with GDPR is worth it.

---

## 5. Changing the site

| To change… | Edit | Then |
|---|---|---|
| Page text, titles, FAQs, header, footer, privacy page | `scripts/build_pages.py` | run `python3 scripts/build_pages.py` |
| Colours and layout | `public/assets/css/site.css` | — |
| How a tool works | `public/assets/js/tools/*.js` | — |
| Ads, donation link | `public/assets/js/config.js` | — |

After changing CSS or JS on the live site, bump `VERSION` in `scripts/build_pages.py`, run it, and bump `CACHE` in `public/sw.js`, so visitors' browsers fetch the new files.

After a deploy that adds or changes pages, tell Bing and other IndexNow search engines:

```bash
python3 scripts/notify_indexnow.py
```

## Third-party libraries (all stored in `public/vendor`, nothing loads from other sites)
- pdf-lib 1.17.1, MIT licence
- PDF.js 3.11.174 (Mozilla), Apache 2.0 licence
- JSZip 3.10.1, MIT licence

# SafeMerge

Private PDF tools that run entirely in the browser. Files are never uploaded.

**Tools:** Merge · Split · Rotate · Organize (reorder/delete) · Images → PDF · PDF → images · Page numbers · Watermark

It is a plain static website: HTML, CSS and JavaScript, with no server, no database and no build tools to install. Any static host can serve it for free.

---

## 1. Try it on your Mac

```bash
cd ~/projects/public_project/pdf_merger
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

### Step 3: Host it on Cloudflare Pages
1. Create a free account at dash.cloudflare.com → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. Pick the `safemerge` repository.
3. Build settings: **Framework preset: None**, **Build command: empty**, **Output directory: `/`**.
4. Deploy. You get a `*.pages.dev` address within a minute.
5. **Custom domains** → add `safemergefiles.com`. If you bought the domain at Cloudflare, it connects automatically.

Every time you push a change to GitHub, the site updates by itself.

(Netlify works the same way and also reads the `_headers` file.)

### Step 4: Tell Google about it
1. Go to **Google Search Console** (search.google.com/search-console) → add your domain → verify it.
2. Submit `https://safemergefiles.com/sitemap.xml`.

New sites usually take weeks to months to show up in search results.

---

## 3. Turn on earnings

All settings live in **`assets/js/config.js`**. Anything left empty stays switched off, and the site works without any of it.

### Donations (do this first: instant, no approval)
1. Make a free page on **Ko-fi** (ko-fi.com) or **Buy Me a Coffee**.
2. Put the link in `donateUrl`. A "Support us" button appears in the header and footer.

### EthicalAds (cookie-free ads, shown to everyone by default)
1. Apply at ethicalads.io/publishers. They review sites by hand and focus on developer and tech audiences, so approval isn't guaranteed. Apply once you have some traffic.
2. Put your publisher id in `ethicalAdsPublisher`.
- Alternative if they decline: **Carbon Ads** (carbonads.net), another privacy-focused ad network. Check their current cookie policy before adding it. It needs a small code change in `assets/js/monetize.js`, so ask for help when you get there.

### Google AdSense (only for visitors who click "Allow ad cookies")
1. Apply at adsense.google.com once the site is live on your domain and has its privacy page. Google often rejects brand-new sites with little traffic, so try again after a few months if you're refused.
2. In AdSense: **Privacy & messaging → European regulations → create a message** (Google's certified consent form). This is **required** to show ads in the EU, UK and Switzerland. Also set up the **US state regulations** message.
3. Create a **display ad unit** (Ads → By ad unit). Copy:
   - the client id (`ca-pub-…`) → `adsenseClient`
   - the slot id → `adsenseSlot`
4. Edit `ads.txt` at the top of the site with your publisher id (instructions are inside the file).

**How it behaves:** first-time visitors see a small banner. Google's code never loads unless the visitor clicks **Allow ad cookies**. If they choose **Cookie-free ads only**, they see EthicalAds. They can change their mind with the **Ad cookie choice** link in the footer. In the EU, UK and Switzerland, Google then shows its own consent form as well.

---

## 4. What you can promise visitors

| Claim | True? |
|---|---|
| "Your files never leave your device / are never uploaded" | ✅ Always, in every country, whatever ads run |
| "SafeMerge collects no data" | ✅ The site has no analytics or tracking of its own |
| "No data is collected at all" | ⚠️ Only while AdSense is off. Once a visitor allows ad cookies, Google collects data, and the privacy page says so |

Don't add Google Analytics or other trackers. It would break the promise on the privacy page. If you want visitor counts, Cloudflare Pages has built-in cookie-free **Web Analytics**. Update the privacy page if you turn it on.

**Before launch:** set up a real email address for `privacy@safemergefiles.com` (Cloudflare Email Routing forwards it to your Gmail for free), or change the address at the bottom of the privacy page in `scripts/build_pages.py`.

This isn't legal advice. If the site starts earning real money, a short review by a lawyer familiar with GDPR is worth it.

---

## 5. Changing the site

| To change… | Edit | Then |
|---|---|---|
| Page text, titles, FAQs, header, footer, privacy page | `scripts/build_pages.py` | run `python3 scripts/build_pages.py` |
| Colours and layout | `assets/css/site.css` | — |
| How a tool works | `assets/js/tools/*.js` | — |
| Ads, donation link | `assets/js/config.js` | — |

After changing CSS or JS on the live site, bump `VERSION` in `scripts/build_pages.py`, run it, and bump `CACHE` in `sw.js`, so visitors' browsers fetch the new files.

## Open-source libraries (all stored in `/vendor`, nothing loads from other sites)
- pdf-lib 1.17.1, MIT licence
- PDF.js 3.11.174 (Mozilla), Apache 2.0 licence
- JSZip 3.10.1, MIT licence

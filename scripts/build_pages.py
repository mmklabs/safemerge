#!/usr/bin/env python3
"""Generates every SafeMerge HTML page, plus sitemap.xml.

Edit the text in this file, then run:   python3 scripts/build_pages.py
Header, footer and page text live here so a change applies to every page.
"""
import html
import json
from pathlib import Path

SITE_NAME = "SafeMerge"
SITE_URL = "https://safemergefiles.com"  # change if you buy a different domain
ROOT = Path(__file__).resolve().parent.parent
VERSION = "1"  # bump to make browsers fetch fresh CSS/JS after an update

LOGO = """<svg viewBox="0 0 32 32" aria-hidden="true">
  <rect x="4" y="3" width="17" height="22" rx="3" fill="none" stroke="currentColor" stroke-width="2" opacity=".45"/>
  <rect x="11" y="7" width="17" height="22" rx="3" fill="var(--accent)"/>
  <path d="M15.5 18.2l3 3 5.5-6" fill="none" stroke="var(--accent-ink)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
</svg>"""

SHIELD = """<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5l5.5 2v4c0 3.4-2.3 6-5.5 7-3.2-1-5.5-3.6-5.5-7v-4z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5.5 8l1.8 1.8L10.7 6.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>"""

# Small line icons for the home page cards
ICONS = {
    "merge": '<path d="M6 6h10v12H6zM14 10h10v12H14z"/><path d="M18 26v4m-3-3 3 3 3-3"/>',
    "split": '<path d="M8 6h16v20H8z"/><path d="M4 16h24" stroke-dasharray="3 3"/>',
    "rotate": '<path d="M10 8h12v18H10z"/><path d="M26 6a10 10 0 0 0-8-3m8 3V1m0 5h-5"/>',
    "organize": '<path d="M5 6h9v11H5zM18 6h9v11h-9zM5 21h9v6H5zM18 21h9v6h-9z"/>',
    "jpg": '<path d="M6 5h20v22H6z"/><path d="M6 21l6-6 5 5 3-3 6 6"/><circle cx="20" cy="11" r="2"/>',
    "pdfjpg": '<path d="M5 5h13v18H5z"/><path d="M14 13h13v14H14z"/><path d="M14 24l4-4 3 3 2-2 4 4"/>',
    "numbers": '<path d="M8 4h16v24H8z"/><path d="M14.5 19.5l2-1.5v6m-2 0h4"/>',
    "watermark": '<path d="M8 4h16v24H8z"/><path d="M11 21l10-10M12 13h3m3 7h3"/>',
}

def icon(key):
    return f'<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{ICONS[key]}</svg>'

COMMON_FAQ = [
    ("Are my files uploaded?",
     "No. SafeMerge runs entirely in your browser. Your files are read and changed on your own device and are never sent to any server, including ours."),
    ("Does it work offline?",
     "Yes. Once the page has loaded you can turn off Wi-Fi and it keeps working. In Chrome or Edge you can also install SafeMerge as an app from the address bar."),
    ("Is it free?",
     "Yes, with no sign-up, watermarks or file limits. Ads and donations pay for the site. Very large files are limited only by your device's memory."),
]

# ---------------------------------------------------------------------------
# Tool pages
# ---------------------------------------------------------------------------

DROP_PDF = """<div id="drop" class="dropzone" tabindex="0" role="button" aria-label="Choose {what}">
  <strong>{label}</strong><span>or click to choose · nothing is uploaded</span>
  <input type="file" accept="{accept}" {multiple} hidden>
</div>"""

def drop(label, what, accept="application/pdf,.pdf", multiple=False):
    return DROP_PDF.format(label=label, what=what, accept=accept, multiple="multiple" if multiple else "")

STATUS = """<div id="status" class="status" role="status" aria-live="polite"></div>
<div id="progress" class="progress" hidden><div></div></div>"""

def file_head(extra=""):
    return f"""<div class="bar"><strong id="filename" class="grow"></strong>{extra}
  <button id="reset" class="btn small">Choose another file</button></div>"""

def radios(name, options, checked):
    out = []
    for value, label in options:
        c = " checked" if value == checked else ""
        out.append(f'<label><input type="radio" name="{name}" value="{value}"{c}> {label}</label>')
    return '<div class="choices">' + "".join(out) + "</div>"

TOOLS = [
    {
        "slug": "merge-pdf", "icon": "merge", "js": ["merge.js"], "body": "merge",
        "card": ("Merge PDF", "Combine several PDFs into one, in any order."),
        "title": "Merge PDF files privately, without uploading | SafeMerge",
        "description": "Combine PDF files into one in your browser. Free, no sign-up, and your files are never uploaded.",
        "h1": "Merge PDF files",
        "lede": "Combine PDFs into one document. Drag to put them in order.",
        "ui": drop("Drop PDF files here", "PDF files", multiple=True) + """
<ul id="files" class="file-list"></ul>
<div id="options" class="bar" hidden>
  <input id="outname" type="text" value="merged.pdf" aria-label="File name for the merged PDF" class="grow" style="flex-basis:200px">
  <button id="reset" class="btn">Clear</button>
  <button id="run" class="btn primary" disabled>Merge PDFs</button>
</div>""",
        "steps": ["Drop your PDFs in, or click to choose them.",
                  "Drag them into the order you want, or use the arrows.",
                  "Click Merge PDFs. The combined file saves to your device."],
        "faq": [("Can I merge password-protected PDFs?",
                 "Not yet. Remove the password in your PDF reader first, then merge.")],
    },
    {
        "slug": "split-pdf", "icon": "split", "js": ["split.js"], "body": "split", "pdfjs": True, "zip": True,
        "card": ("Split PDF", "Pull out pages or break a PDF into parts."),
        "title": "Split PDF and extract pages privately | SafeMerge",
        "description": "Extract pages from a PDF or split it into several files in your browser. Free, and your file is never uploaded.",
        "h1": "Split PDF",
        "lede": "Keep only the pages you need, or break one PDF into several.",
        "ui": drop("Drop a PDF here", "a PDF file") + """
<div id="workspace" class="tool" hidden>
""" + file_head() + """
  <div class="options">
    <fieldset class="field full"><legend>How to split</legend>""" + radios("mode", [
            ("selected", "Extract the pages I select"),
            ("each", "Every page as its own PDF"),
            ("ranges", "Custom ranges")], "selected") + """</fieldset>
    <label id="ranges-field" class="field full" hidden><span>Ranges</span>
      <input id="ranges" type="text" autocomplete="off" spellcheck="false">
    </label>
    <div id="select-tools" class="bar full">
      <button id="select-all" class="btn small">Select all</button>
      <button id="select-none" class="btn small">Select none</button>
    </div>
  </div>
  <div id="pages" class="pages"></div>
  <div class="bar"><span class="grow"></span><button id="run" class="btn primary" disabled>Split PDF</button></div>
</div>""",
        "steps": ["Drop your PDF in.",
                  "Pick a mode: select pages, split every page, or type ranges like 1-3, 4-10.",
                  "Click Split PDF. Several files come as one ZIP."],
        "faq": [("How do I write ranges?",
                 "Separate ranges with commas. 1-3, 5, 8- gives three files: pages 1 to 3, page 5, and page 8 to the end.")],
    },
    {
        "slug": "rotate-pdf", "icon": "rotate", "js": ["pages.js"], "body": "rotate", "pdfjs": True,
        "card": ("Rotate PDF", "Turn sideways or upside-down pages."),
        "title": "Rotate PDF pages privately, without uploading | SafeMerge",
        "description": "Rotate one page or every page of a PDF in your browser. Free, and your file is never uploaded.",
        "h1": "Rotate PDF",
        "lede": "Fix sideways scans. Rotate single pages or all of them at once.",
        "ui": drop("Drop a PDF here", "a PDF file") + """
<div id="workspace" class="tool" hidden>
""" + file_head() + """
  <div class="bar">
    <button id="rotate-left" class="btn small">↺ Rotate all left</button>
    <button id="rotate-right" class="btn small">↻ Rotate all right</button>
    <button id="undo" class="btn small">Undo changes</button>
  </div>
  <div id="pages" class="pages"></div>
  <div class="bar"><span class="grow"></span><button id="run" class="btn primary" disabled>Save rotated PDF</button></div>
</div>""",
        "steps": ["Drop your PDF in.",
                  "Click ↺ or ↻ under any page, or rotate them all.",
                  "Click Save rotated PDF."],
        "faq": [("Does rotating lower the quality?",
                 "No. Rotation only changes how the page is displayed. The content is not re-compressed.")],
    },
    {
        "slug": "organize-pdf", "icon": "organize", "js": ["pages.js"], "body": "organize", "pdfjs": True,
        "card": ("Organize PDF", "Reorder, delete and rotate pages."),
        "title": "Reorder and delete PDF pages privately | SafeMerge",
        "description": "Rearrange, delete and rotate PDF pages in your browser. Free, and your file is never uploaded.",
        "h1": "Organize PDF pages",
        "lede": "Drag pages into a new order, delete the ones you don't need, rotate the rest.",
        "ui": drop("Drop a PDF here", "a PDF file") + """
<div id="workspace" class="tool" hidden>
""" + file_head() + """
  <div class="bar"><button id="undo" class="btn small">Undo changes</button></div>
  <div id="pages" class="pages"></div>
  <div class="bar"><span class="grow"></span><button id="run" class="btn primary" disabled>Save PDF</button></div>
</div>""",
        "steps": ["Drop your PDF in.",
                  "Drag pages to reorder (or use ← →), ✕ to delete, ↺ ↻ to rotate.",
                  "Click Save PDF."],
        "faq": [("Can I undo a deleted page?",
                 "Yes. Undo changes brings back the original order and every page, as long as you haven't chosen another file.")],
    },
    {
        "slug": "jpg-to-pdf", "icon": "jpg", "js": ["images-to-pdf.js"], "body": "images",
        "card": ("JPG to PDF", "Turn photos and scans into one PDF."),
        "title": "JPG and PNG to PDF converter, no upload | SafeMerge",
        "description": "Convert JPG, PNG and WebP images to a PDF in your browser. Free, and your photos are never uploaded.",
        "h1": "Images to PDF",
        "lede": "Turn JPG, PNG or WebP images into a PDF, one image per page.",
        "ui": drop("Drop images here", "images", accept="image/*", multiple=True) + """
<ul id="files" class="file-list"></ul>
<div id="options" class="tool" hidden>
  <div class="options">
    <fieldset class="field"><legend>Page size</legend>""" + radios("size", [("a4", "A4"), ("letter", "Letter"), ("fit", "Same as image")], "a4") + """</fieldset>
    <fieldset class="field"><legend>Orientation</legend>""" + radios("orient", [("auto", "Auto"), ("portrait", "Portrait"), ("landscape", "Landscape")], "auto") + """</fieldset>
    <fieldset class="field"><legend>Margin</legend>""" + radios("margin", [("none", "None"), ("small", "Small"), ("large", "Large")], "small") + """</fieldset>
  </div>
  <div class="bar"><span class="grow"></span>
    <button id="reset" class="btn">Clear</button>
    <button id="run" class="btn primary" disabled>Create PDF</button>
  </div>
</div>""",
        "steps": ["Drop your images in. Photos from your phone work too.",
                  "Put them in order and choose a page size.",
                  "Click Create PDF."],
        "faq": [("Will my phone photos come out sideways?",
                 "No. SafeMerge reads the photo's orientation and places it the right way up."),
                ("What about HEIC photos from an iPhone?",
                 "Browsers can't read HEIC yet, except Safari. On an iPhone, share the photo as JPG or set Camera → Formats → Most Compatible.")],
    },
    {
        "slug": "pdf-to-jpg", "icon": "pdfjpg", "js": ["pdf-to-images.js"], "body": "pdf-images", "pdfjs": True, "zip": True,
        "card": ("PDF to JPG", "Save every page as an image."),
        "title": "PDF to JPG and PNG converter, no upload | SafeMerge",
        "description": "Convert each PDF page to a JPG or PNG image in your browser. Free, and your file is never uploaded.",
        "h1": "PDF to images",
        "lede": "Save each page of a PDF as a JPG or PNG image.",
        "ui": drop("Drop a PDF here", "a PDF file") + """
<div id="workspace" class="tool" hidden>
""" + file_head() + """
  <div class="options">
    <fieldset class="field"><legend>Format</legend>""" + radios("format", [("jpg", "JPG"), ("png", "PNG")], "jpg") + """</fieldset>
    <fieldset class="field"><legend>Quality</legend>""" + radios("dpi", [("72", "Screen"), ("150", "Standard"), ("300", "Print")], "150") + """</fieldset>
  </div>
  <div class="bar"><span class="grow"></span><button id="run" class="btn primary" disabled>Convert to images</button></div>
</div>""",
        "steps": ["Drop your PDF in.",
                  "Choose JPG (smaller) or PNG (sharper), and a quality.",
                  "Click Convert. Several pages come as one ZIP."],
        "faq": [("Which quality should I pick?",
                 "Standard (150 dpi) suits screens and email. Print (300 dpi) is sharper but files are about four times larger.")],
    },
    {
        "slug": "add-page-numbers", "icon": "numbers", "js": ["stamp.js"], "body": "numbers",
        "card": ("Page numbers", "Number pages in the corner you choose."),
        "title": "Add page numbers to a PDF privately | SafeMerge",
        "description": "Add page numbers to a PDF in your browser, in any corner and format. Free, and your file is never uploaded.",
        "h1": "Add page numbers",
        "lede": "Number every page, with the position and style you choose.",
        "ui": drop("Drop a PDF here", "a PDF file") + """
<div id="workspace" class="tool" hidden>
""" + file_head() + """
  <div class="options">
    <fieldset class="field full"><legend>Position</legend>""" + radios("position", [
            ("bottom-left", "Bottom left"), ("bottom-center", "Bottom centre"), ("bottom-right", "Bottom right"),
            ("top-left", "Top left"), ("top-center", "Top centre"), ("top-right", "Top right")], "bottom-center") + """</fieldset>
    <label class="field"><span>Format</span>
      <select id="format">
        <option value="{n}">1</option>
        <option value="Page {n}">Page 1</option>
        <option value="{n} / {total}">1 / 10</option>
        <option value="Page {n} of {total}">Page 1 of 10</option>
      </select></label>
    <label class="field"><span>Start at</span><input id="start" type="number" min="0" value="1"></label>
    <label class="field"><span>Text size <output id="size-out"></output></span>
      <input id="size" type="range" min="8" max="24" value="11" data-out="size-out" data-unit=" pt"></label>
    <label class="check-row full"><input id="skip-first" type="checkbox"> Don't number the first page (cover)</label>
  </div>
  <div class="bar"><span class="grow"></span><button id="run" class="btn primary" disabled>Add page numbers</button></div>
</div>""",
        "steps": ["Drop your PDF in.",
                  "Pick a corner, a format and a starting number.",
                  "Click Add page numbers."],
        "faq": [("Can I skip the cover page?",
                 "Yes. Tick \"Don't number the first page\", and numbering starts on page two from the number you choose.")],
    },
    {
        "slug": "watermark-pdf", "icon": "watermark", "js": ["stamp.js"], "body": "watermark",
        "card": ("Watermark PDF", "Stamp text like DRAFT or CONFIDENTIAL."),
        "title": "Add a watermark to a PDF privately | SafeMerge",
        "description": "Stamp a text watermark such as CONFIDENTIAL on every PDF page in your browser. Free, and your file is never uploaded.",
        "h1": "Watermark PDF",
        "lede": "Stamp text such as DRAFT or CONFIDENTIAL across every page.",
        "ui": drop("Drop a PDF here", "a PDF file") + """
<div id="workspace" class="tool" hidden>
""" + file_head() + """
  <div class="options">
    <label class="field full"><span>Text</span><input id="text" type="text" value="CONFIDENTIAL" maxlength="80"></label>
    <fieldset class="field"><legend>Angle</legend>""" + radios("angle", [("45", "Diagonal"), ("0", "Straight")], "45") + """</fieldset>
    <label class="field"><span>Colour</span><input id="color" type="color" value="#b4372f"></label>
    <label class="field"><span>Size <output id="wsize-out"></output></span>
      <input id="size" type="range" min="20" max="90" value="60" data-out="wsize-out" data-unit="%"></label>
    <label class="field"><span>Opacity <output id="op-out"></output></span>
      <input id="opacity" type="range" min="5" max="100" value="20" data-out="op-out" data-unit="%"></label>
    <label class="check-row full"><input id="bold" type="checkbox" checked> Bold</label>
  </div>
  <div class="bar"><span class="grow"></span><button id="run" class="btn primary" disabled>Add watermark</button></div>
</div>""",
        "steps": ["Drop your PDF in.",
                  "Type the text and choose angle, colour, size and opacity.",
                  "Click Add watermark."],
        "faq": [("Can the watermark be removed?",
                 "It is added as normal page content, so a determined person with PDF editing software could remove it. It is a clear label, not copy protection.")],
    },
]

# ---------------------------------------------------------------------------
# Page shell
# ---------------------------------------------------------------------------

def head(title, description, path, extra=""):
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{html.escape(title)}</title>
<meta name="description" content="{html.escape(description)}">
<link rel="canonical" href="{SITE_URL}{path}">
<meta property="og:title" content="{html.escape(title)}">
<meta property="og:description" content="{html.escape(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="{SITE_URL}{path}">
<meta name="theme-color" content="#0b7a6c">
<meta name="referrer" content="strict-origin-when-cross-origin">
<link rel="icon" href="/assets/img/icon.svg" type="image/svg+xml">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="stylesheet" href="/assets/css/site.css?v={VERSION}">
{extra}</head>"""

def header():
    return f"""<header class="site-header"><div class="wrap">
  <a class="brand" href="/">{LOGO}<span>{SITE_NAME}</span></a>
  <nav class="site-nav" aria-label="Main">
    <a href="/merge-pdf/">Merge</a><a href="/split-pdf/">Split</a><a href="/organize-pdf/">Organize</a>
    <a href="/#tools">All tools</a>
    <a class="donate" href="#" data-donate hidden rel="noopener" target="_blank">Support us</a>
  </nav>
</div></header>"""

def footer():
    links = "".join(f'<a href="/{t["slug"]}/">{t["card"][0]}</a>' for t in TOOLS)
    return f"""<footer class="site-footer"><div class="wrap">
  <div>
    <strong style="color:var(--ink)">{SITE_NAME}</strong> · Your files never leave your device.<br>
    <a href="/privacy/">Privacy</a> · <button id="ad-choices" class="linklike" hidden>Ad cookie choice</button>
    <a href="#" data-donate hidden rel="noopener" target="_blank">Support us</a>
  </div>
  <nav aria-label="Tools">{links}</nav>
</div></footer>"""

def scripts(tool=None):
    v = VERSION
    tags = [f'<script src="/assets/js/config.js?v={v}"></script>',
            f'<script src="/assets/js/monetize.js?v={v}" defer></script>']
    if tool:
        tags.append('<script src="/vendor/pdf-lib/pdf-lib.min.js" defer></script>')
        if tool.get("pdfjs"):
            tags.append('<script src="/vendor/pdfjs/pdf.min.js" defer></script>')
        if tool.get("zip"):
            tags.append('<script src="/vendor/jszip/jszip.min.js" defer></script>')
        tags.append(f'<script src="/assets/js/core.js?v={v}" defer></script>')
        tags += [f'<script src="/assets/js/tools/{js}?v={v}" defer></script>' for js in tool["js"]]
    else:
        tags.append(f'<script src="/assets/js/core.js?v={v}" defer></script>')
    return "\n".join(tags)

def faq_html(items):
    return "".join(f"<details><summary>{html.escape(q)}</summary><p>{html.escape(a)}</p></details>" for q, a in items)

def faq_schema(items):
    data = {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in items]}
    return f'<script type="application/ld+json">{json.dumps(data)}</script>\n'

def tool_page(t):
    faqs = t["faq"] + COMMON_FAQ
    others = "".join(f'<a class="tool-card" href="/{o["slug"]}/">{icon(o["icon"])}<div><h3>{o["card"][0]}</h3><p>{o["card"][1]}</p></div></a>'
                     for o in TOOLS if o is not t)
    steps = "".join(f"<li>{html.escape(s)}</li>" for s in t["steps"])
    return f"""{head(t["title"], t["description"], f'/{t["slug"]}/', faq_schema(faqs))}
<body data-tool="{t["body"]}">
{header()}
<main><div class="wrap narrow">
  <h1>{t["h1"]}</h1>
  <p class="lede">{t["lede"]}</p>
  <div class="promise">{SHIELD} Private: files are processed on your device and never uploaded</div>
  <section class="tool" aria-label="{t["h1"]} tool">
{t["ui"]}
{STATUS}
  </section>
  <div class="ad-slot" aria-label="Advertisement"></div>
  <div class="content">
    <section><h2>How it works</h2><ol class="steps">{steps}</ol></section>
    <section><h2>Questions</h2><div class="faq">{faq_html(faqs)}</div></section>
  </div>
</div>
<div class="wrap" style="margin-top:48px"><h2>More tools</h2><div class="tool-grid">{others}</div></div>
</main>
{footer()}
{scripts(t)}
</body>
</html>
"""

def home_page():
    cards = "".join(f'<a class="tool-card" href="/{t["slug"]}/">{icon(t["icon"])}<div><h3>{t["card"][0]}</h3><p>{t["card"][1]}</p></div></a>' for t in TOOLS)
    return f"""{head(f"{SITE_NAME}: private PDF tools that never upload your files",
                 "Merge, split, rotate, convert and number PDFs in your browser. Free, no sign-up, and your files never leave your device.", "/",
                 faq_schema(COMMON_FAQ))}
<body>
{header()}
<main>
  <div class="wrap">
    <section class="hero">
      <h1>PDF tools that never upload your files</h1>
      <p class="lede">Merge, split, convert and edit PDFs right in your browser. Your documents stay on your device, so contracts, medical records and payslips stay private.</p>
      <div class="promise">{SHIELD} Free · no sign-up · works offline</div>
    </section>
    <section id="tools" aria-label="Tools"><div class="tool-grid">{cards}</div></section>
    <div class="ad-slot" aria-label="Advertisement"></div>
    <section class="content">
      <div class="why">
        <div><h3>Nothing is uploaded</h3><p>Other PDF sites send your file to their servers. SafeMerge does the work inside your browser, so your file never travels.</p></div>
        <div><h3>Works with Wi-Fi off</h3><p>Load the page once, then disconnect. Everything still works, which shows that nothing is being sent.</p></div>
        <div><h3>No account, no limits</h3><p>No email, no daily caps, no watermarks on your files. Just open a tool and use it.</p></div>
      </div>
      <section><h2>Questions</h2><div class="faq">{faq_html(COMMON_FAQ)}</div></section>
    </section>
  </div>
</main>
{footer()}
{scripts()}
</body>
</html>
"""

def privacy_page():
    body = f"""
<h1>Privacy</h1>
<p class="lede">Short version: your files never leave your device. The only data that can be collected is through ads, and Google ads load only if you allow them.</p>

<h2>Your files</h2>
<p>Every SafeMerge tool runs inside your web browser. When you choose a file, your browser reads it from your device, changes it there, and saves the result back to your device. Files are never sent to SafeMerge or anyone else. We have no server that could receive them.</p>
<p>You can check this yourself: load a tool, turn off your internet connection, and use it. It still works.</p>

<h2>What we collect</h2>
<p>SafeMerge itself collects nothing. There are no analytics, no tracking pixels, no accounts and no SafeMerge cookies. We remember one setting in your browser's local storage, your ad cookie choice, so we don't ask again. It stays on your device.</p>

<h2>Ads</h2>
<p>Ads keep SafeMerge free. Which ads you see depends on your choice:</p>
<div class="table-scroll"><table>
<thead><tr><th>Your choice</th><th>Ads shown</th><th>What the ad company receives</th></tr></thead>
<tbody>
<tr><td>Cookie-free ads only (default)</td><td>EthicalAds</td><td>Your IP address and the page you're on, to deliver the ad. No cookies, no profile. <a href="https://www.ethicalads.io/privacy-policy/" rel="noopener">EthicalAds privacy policy</a></td></tr>
<tr><td>Allow ad cookies</td><td>Google AdSense</td><td>Google sets cookies and may use them to personalise ads and measure them. In the EU, UK and Switzerland Google will also ask for your consent. <a href="https://policies.google.com/technologies/partner-sites" rel="noopener">How Google uses data from partner sites</a></td></tr>
</tbody></table></div>
<p>Ad companies never get your files or anything in them. You can change your choice at any time with the <em>Ad cookie choice</em> link at the bottom of every page.</p>

<h2>Hosting</h2>
<p>Like every website, our hosting provider handles the requests that load these pages and may keep standard server logs (such as IP address and time) for security. Those requests never contain your files.</p>

<h2>Your rights</h2>
<p>Because SafeMerge stores no personal data, there is nothing for us to access, correct or delete. For data held by Google, use <a href="https://myadcenter.google.com/" rel="noopener">My Ad Center</a>. California residents: SafeMerge does not sell personal information. Choosing "Cookie-free ads only" opts you out of Google ad cookies on this site.</p>

<h2>Contact</h2>
<p>Questions about privacy: <span class="contact-email">privacy@safemergefiles.com</span></p>
<p style="color:var(--muted)">Last updated: October 2026</p>
"""
    return f"""{head(f"Privacy | {SITE_NAME}", "How SafeMerge keeps your files on your device, and exactly what the ads on this site can and cannot see.", "/privacy/")}
<body>
{header()}
<main><div class="wrap narrow prose">{body}</div></main>
{footer()}
{scripts()}
</body>
</html>
"""

def not_found_page():
    return f"""{head(f"Page not found | {SITE_NAME}", "This page doesn't exist.", "/404.html")}
<body>
{header()}
<main><div class="wrap narrow"><h1>Page not found</h1><p class="lede">That page doesn't exist. <a href="/">See all tools</a>.</p></div></main>
{footer()}
{scripts()}
</body>
</html>
"""

def write(path, text):
    p = ROOT / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")
    print("wrote", path)

def main():
    write("index.html", home_page())
    for t in TOOLS:
        write(f'{t["slug"]}/index.html', tool_page(t))
    write("privacy/index.html", privacy_page())
    write("404.html", not_found_page())
    urls = ["/"] + [f'/{t["slug"]}/' for t in TOOLS] + ["/privacy/"]
    sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    sitemap += "".join(f"  <url><loc>{SITE_URL}{u}</loc></url>\n" for u in urls) + "</urlset>\n"
    write("sitemap.xml", sitemap)
    write("robots.txt", f"User-agent: *\nAllow: /\nSitemap: {SITE_URL}/sitemap.xml\n")

if __name__ == "__main__":
    main()

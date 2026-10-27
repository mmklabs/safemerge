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
ROOT = Path(__file__).resolve().parent.parent / "public"
VERSION = "6"  # bump to make browsers fetch fresh CSS/JS after an update
GITHUB_URL = "https://github.com/mmklabs/safemerge"
LASTMOD = "2026-10-27"  # update when page content changes, so search engines recrawl
INDEXNOW_KEY = "8c42d1759bf31b4b4230e170536651d3"  # proves to Bing/IndexNow that we own the site

LOGO = """<svg viewBox="0 0 32 32" aria-hidden="true">
  <rect x="4" y="3" width="17" height="22" rx="3" fill="none" stroke="currentColor" stroke-width="2" opacity=".45"/>
  <rect x="11" y="7" width="17" height="22" rx="3" fill="var(--accent)"/>
  <path d="M15.5 18.2l3 3 5.5-6" fill="none" stroke="var(--accent-ink)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
</svg>"""

SHIELD = """<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5l5.5 2v4c0 3.4-2.3 6-5.5 7-3.2-1-5.5-3.6-5.5-7v-4z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5.5 8l1.8 1.8L10.7 6.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>"""

# Small line icons for the home page cards
ICONS = {
    "ocr": '<path d="M5 10V5h5M22 5h5v5M27 22v5h-5M10 27H5v-5"/><path d="M10 12h12M10 16h12M10 20h8"/>',
    "unlock": '<rect x="7" y="14" width="18" height="14" rx="2"/><path d="M11 14V9a5 5 0 0 1 9.6-2"/><circle cx="16" cy="21" r="1.6"/>',
    "lock": '<rect x="7" y="14" width="18" height="14" rx="2"/><path d="M11 14V9a5 5 0 0 1 10 0v5"/><circle cx="16" cy="21" r="1.6"/>',
    "idcard": '<path d="M6 5h20v22H6z"/><rect x="9" y="8" width="14" height="7" rx="1"/><rect x="9" y="18" width="14" height="7" rx="1"/>',
    "resize": '<path d="M5 9h15v15H5z"/><path d="M20 12h7v15H12v-3"/><path d="M9 20l4-4 3 3"/>',
    "compress": '<path d="M9 4h14v24H9z"/><path d="M16 7v7m-3.5-3.5L16 14l3.5-3.5M16 25v-7m-3.5 3.5L16 18l3.5 3.5"/>',
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

COMPRESS_UI = drop("Drop a PDF here", "a PDF file") + """
<div id="workspace" class="tool" hidden>
""" + file_head() + """
  <div class="options">
    <fieldset class="field full"><legend>Make it smaller than</legend>""" + radios("target", [
        ("100", "100 KB"), ("200", "200 KB"), ("500", "500 KB"), ("1024", "1 MB"),
        ("custom", "Other size"), ("balanced", "No limit, just smaller")], "balanced") + """</fieldset>
    <label id="custom-field" class="field" hidden><span>Size in KB</span>
      <input id="custom-kb" type="number" min="10" step="1" value="150" inputmode="numeric"></label>
    <label class="check-row full"><input id="gray" type="checkbox"> Black &amp; white: much smaller for text documents and scans</label>
    <label class="check-row full"><input id="allow-flatten" type="checkbox" checked> If needed, turn pages into images to reach the size (text won't be selectable)</label>
  </div>
  <div class="bar"><span class="grow"></span><button id="run" class="btn primary" disabled>Compress PDF</button></div>
  <section id="result" class="result" hidden aria-live="polite">
    <div class="result-head">
      <div><div id="result-sizes" class="result-sizes"></div><div id="result-saved" class="meta"></div></div>
      <div id="result-verdict" class="verdict"></div>
    </div>
    <p id="result-note" class="result-note"></p>
    <div class="result-body">
      <div id="preview" class="preview" role="button" tabindex="0" title="View full size"></div>
      <div class="result-actions">
        <p class="meta">Tap the preview to check the text is readable at full size.</p>
        <button id="download" class="btn primary">Download</button>
      </div>
    </div>
  </section>
</div>
<div id="zoom" class="zoom" hidden role="dialog" aria-label="Full-size preview">
  <div class="zoom-bar"><strong>Full-size preview</strong><button id="zoom-close" class="btn small">Close</button></div>
  <div class="zoom-body"></div>
</div>"""

COMPRESS_STEPS = ["Drop your PDF in.",
                  "Pick the size you need, such as 100 KB or 200 KB, or type your own.",
                  "Click Compress PDF, check the preview, then download."]

COMPRESS_FAQ = [
    ("Will the text stay sharp?",
     "Usually, yes. SafeMerge first shrinks only the photos and scans inside the PDF, so typed text stays sharp and selectable. Only if that isn't enough does it turn pages into images, and it tells you when it does."),
    ("What if it can't reach my size?",
     "You get the smallest version possible and a clear message. Ticking Black & white often halves the size of scanned documents. For very strict limits, remove pages you don't need first with Split PDF."),
]

def compress_variant(kb, label, extra_faq):
    return {
        "slug": f"compress-pdf-to-{label.lower().replace(' ', '')}", "icon": "compress", "js": ["compress.js"],
        "body": "compress", "pdfjs": True, "target": str(kb), "variant": True,
        "card": (f"Compress PDF to {label}", f"Shrink a PDF to under {label}."),
        "title": f"Compress PDF to {label} free, without uploading | SafeMerge",
        "description": f"Make a PDF smaller than {label} for upload forms and email, right in your browser. Free, no sign-up, and your file never leaves your device.",
        "h1": f"Compress PDF to {label}",
        "lede": f"Many upload forms only accept PDFs under {label}. Get yours under the limit in seconds, without sending it anywhere.",
        "ui": COMPRESS_UI, "steps": COMPRESS_STEPS, "faq": extra_faq + COMPRESS_FAQ,
    }

RESIZE_UI = drop("Drop a photo or signature here", "an image", accept="image/*") + """
<div id="workspace" class="tool" hidden>
""" + file_head() + """
  <div class="resize-layout">
    <div class="stage-col">
      <div class="stage-wrap"><canvas id="stage" aria-label="Preview of the resized image"></canvas></div>
      <label id="zoom-row" class="field" hidden><span>Zoom</span><input id="zoom" type="range" min="1" max="4" step="0.01" value="1"></label>
      <p id="stage-hint" class="meta"></p>
    </div>
    <div class="options">
      <label class="field full"><span>Size</span>
        <select id="preset">
          <option value="original">Keep the original size</option>
          <option value="form-photo">Form photo · 200 × 230 px · 20–50 KB</option>
          <option value="signature">Signature · 140 × 60 px · 10–20 KB</option>
          <option value="passport">Passport photo · 35 × 45 mm</option>
          <option value="square">Square · 600 × 600 px</option>
          <option value="custom">Custom size</option>
        </select></label>
      <div id="size-fields" class="size-fields full" hidden>
        <label class="field"><span>Width</span><input id="w" type="number" min="1" value="200" inputmode="decimal"></label>
        <label class="field"><span>Height</span><input id="h" type="number" min="1" value="230" inputmode="decimal"></label>
        <label class="field"><span>Unit</span><select id="unit"><option value="px">pixels</option><option value="mm">mm</option><option value="cm">cm</option><option value="in">inches</option></select></label>
        <label id="dpi-field" class="field" hidden><span>DPI</span><input id="dpi" type="number" min="50" max="1200" value="300" inputmode="numeric"></label>
      </div>
      <fieldset id="fit-field" class="field full" hidden><legend>If the shape is different</legend>""" + radios("fit", [("crop", "Crop to fill"), ("pad", "Fit inside, add white space")], "crop") + """</fieldset>
      <div class="size-fields full">
        <label class="field"><span>Max file size (KB)</span><input id="max-kb" type="number" min="1" placeholder="No limit" inputmode="numeric"></label>
        <label class="field"><span>Min file size (KB)</span><input id="min-kb" type="number" min="1" placeholder="None" inputmode="numeric"></label>
      </div>
      <fieldset class="field full"><legend>Format</legend>""" + radios("format", [("jpg", "JPG"), ("png", "PNG")], "jpg") + """</fieldset>
      <label class="check-row full"><input id="cleanup" type="checkbox"> Clean up signature: white background, darker ink</label>
      <label class="check-row full"><input id="stamp" type="checkbox"> Add name and date below the photo</label>
      <div id="stamp-fields" class="size-fields full" hidden>
        <label class="field"><span>Name</span><input id="stamp-name" type="text" maxlength="40" autocomplete="name"></label>
        <label class="field"><span>Date</span><input id="stamp-date" type="text" maxlength="20"></label>
      </div>
    </div>
  </div>
  <div class="bar"><span class="grow"></span><button id="run" class="btn primary" disabled>Resize image</button></div>
  <section id="result" class="result" hidden aria-live="polite">
    <div class="result-head"><div id="result-sizes" class="result-sizes"></div><div id="result-verdict" class="verdict"></div></div>
    <p id="result-note" class="result-note" hidden></p>
    <div class="result-body">
      <img id="result-img" class="result-img" alt="Resized image">
      <div class="result-actions"><button id="download" class="btn primary">Download</button></div>
    </div>
  </section>
</div>"""

RESIZE_STEPS = ["Drop your photo or signature in. Phone photos work too.",
                "Pick a size, or type the exact pixels, mm and KB your form asks for.",
                "Drag to position the crop, click Resize image, then download."]

RESIZE_FAQ = [
    ("My form says the photo must be 20–50 KB. How do I do that?",
     "Type 50 in Max file size and 20 in Min file size. SafeMerge keeps the best quality that fits between the two."),
    ("Can I add my name and the date to the photo?",
     "Yes. Tick “Add name and date below the photo”. Some application forms require this."),
    ("How do I make a signature photo look scanned?",
     "Choose the Signature size or tick “Clean up signature”. It turns the paper white and the ink dark."),
]

def resize_variant(slug, h1, card, lede, data, faq):
    return {
        "slug": slug, "icon": "resize", "js": ["resize-image.js"], "body": "resize", "variant": True, "data": data,
        "card": (h1, card),
        "title": f"{h1} free, without uploading | SafeMerge",
        "description": f"{lede} Free, no sign-up, and your photo never leaves your device.",
        "h1": h1, "lede": lede, "ui": RESIZE_UI, "steps": RESIZE_STEPS, "faq": faq + RESIZE_FAQ,
    }

IDCARD_UI = """
<div class="tool">
  <div class="id-slots">
    <div class="id-slot" data-side="front">
      <h3>Front</h3>
      <div class="dropzone compact" tabindex="0" role="button" aria-label="Choose the front of the card">
        <strong>Drop the front</strong><span> or click to choose</span>
        <input type="file" accept="image/*" hidden>
      </div>
      <div class="crop-area" hidden><canvas aria-label="Crop the front of the card"></canvas></div>
      <div class="bar slot-actions" hidden>
        <button class="btn small" data-act="rotate">↻ Rotate</button>
        <button class="btn small" data-act="auto-crop">Find card</button>
        <button class="btn small" data-act="reset-crop">Whole photo</button>
        <button class="btn small" data-act="remove">Remove</button>
      </div>
    </div>
    <div class="id-slot" data-side="back">
      <h3>Back</h3>
      <div class="dropzone compact" tabindex="0" role="button" aria-label="Choose the back of the card">
        <strong>Drop the back</strong><span> or click to choose</span>
        <input type="file" accept="image/*" hidden>
      </div>
      <div class="crop-area" hidden><canvas aria-label="Crop the back of the card"></canvas></div>
      <div class="bar slot-actions" hidden>
        <button class="btn small" data-act="rotate">↻ Rotate</button>
        <button class="btn small" data-act="auto-crop">Find card</button>
        <button class="btn small" data-act="reset-crop">Whole photo</button>
        <button class="btn small" data-act="remove">Remove</button>
      </div>
    </div>
  </div>
  <p id="crop-hint" class="meta" hidden>SafeMerge tries to find the card for you. Drag the white corners to adjust, or drag inside the box to move it.</p>
  <div id="options" class="options">
    <fieldset class="field"><legend>Page</legend>""" + radios("page", [("a4", "A4"), ("letter", "Letter")], "a4") + """</fieldset>
    <fieldset class="field"><legend>Card size</legend>""" + radios("cardsize", [("actual", "Real card size"), ("large", "Larger")], "actual") + """</fieldset>
    <fieldset class="field"><legend>Layout</legend>""" + radios("arrange", [("stacked", "One above the other"), ("side", "Side by side")], "stacked") + """</fieldset>
    <fieldset class="field"><legend>Save as</legend>""" + radios("output", [("pdf", "PDF"), ("jpg", "JPG")], "pdf") + """</fieldset>
    <label class="field"><span>Max file size (KB)</span><input id="max-kb" type="number" min="10" placeholder="No limit" inputmode="numeric"></label>
    <label class="check-row full"><input id="gray" type="checkbox"> Black &amp; white (like a photocopy)</label>
    <label class="check-row full"><input id="cutlines" type="checkbox"> Add dashed cut lines for printing</label>
  </div>
  <div class="bar"><button id="reset" class="btn">Start over</button><span class="grow"></span><button id="run" class="btn primary" disabled>Create page</button></div>
  <section id="result" class="result" hidden aria-live="polite">
    <div class="result-head"><div id="result-sizes" class="result-sizes"></div><div id="result-verdict" class="verdict"></div></div>
    <p id="result-note" class="result-note" hidden></p>
    <div class="result-body">
      <div id="preview" class="preview page-preview"></div>
      <div class="result-actions"><button id="download" class="btn primary">Download</button></div>
    </div>
  </section>
</div>"""

UNLOCK_UI = drop("Drop a password-protected PDF here", "a PDF file") + """
<div id="workspace" class="tool" hidden>
""" + file_head() + """
  <div id="pw-row" class="options" hidden>
    <label class="field full"><span>Password</span>
      <div class="pw-input"><input id="password" type="password" autocomplete="off" spellcheck="false"><button class="btn small" type="button" data-reveal="password">Show</button></div>
    </label>
    <div class="bar full"><span class="grow"></span><button id="run" class="btn primary">Unlock PDF</button></div>
  </div>
  <section id="result" class="result" hidden aria-live="polite">
    <div class="result-head"><div id="result-sizes" class="result-sizes"></div></div>
    <p id="result-note" class="result-note"></p>
    <div class="bar"><button id="download" class="btn primary">Download</button></div>
  </section>
</div>"""

PROTECT_UI = drop("Drop a PDF here", "a PDF file") + """
<div id="workspace" class="tool" hidden>
""" + file_head() + """
  <div class="options">
    <label class="field"><span>Password</span>
      <div class="pw-input"><input id="password" type="password" autocomplete="new-password" spellcheck="false"><button class="btn small" type="button" data-reveal="password">Show</button></div></label>
    <label class="field"><span>Type it again</span>
      <div class="pw-input"><input id="password2" type="password" autocomplete="new-password" spellcheck="false"><button class="btn small" type="button" data-reveal="password2">Show</button></div></label>
    <fieldset class="field full"><legend>Also block (optional)</legend>
      <label class="check-row"><input id="no-print" type="checkbox"> Printing</label>
      <label class="check-row"><input id="no-copy" type="checkbox"> Copying text</label>
      <label class="check-row"><input id="no-edit" type="checkbox"> Editing</label>
    </fieldset>
  </div>
  <div class="bar"><span class="grow"></span><button id="run" class="btn primary">Protect PDF</button></div>
  <section id="result" class="result" hidden aria-live="polite">
    <div class="result-head"><div id="result-sizes" class="result-sizes"></div></div>
    <p id="result-note" class="result-note"></p>
    <div class="bar"><button id="download" class="btn primary">Download</button></div>
  </section>
</div>"""

UNLOCK_FAQ = [
    ("Can SafeMerge unlock a PDF if I don't know the password?",
     "No. You need the password that opens the file. If a PDF only blocks printing or copying but opens without a password, SafeMerge can remove those limits."),
    ("Is it safe to type my password here?",
     "Yes. The password and the file stay in your browser and are never sent anywhere. SafeMerge has no server that could receive them."),
]

def unlock_page(slug, h1, title, description, lede, faq, variant=False):
    return {
        "slug": slug, "icon": "unlock", "js": ["pdf-password.js"], "body": "unlock", "qpdf": True, "variant": variant,
        "card": ("Unlock PDF", "Remove a password you know."),
        "title": title, "description": description, "h1": h1, "lede": lede, "ui": UNLOCK_UI,
        "steps": ["Drop the password-protected PDF in.",
                  "Type its password (the one you use to open it).",
                  "Click Unlock PDF and download the version without a password."],
        "faq": faq + UNLOCK_FAQ,
    }

OCR_UI = drop("Drop scanned PDFs or photos of documents", "PDFs or images", accept="application/pdf,.pdf,image/*", multiple=True) + """
<div id="workspace" class="tool" hidden>
""" + file_head() + """
  <div class="options">
    <fieldset class="field"><legend>Language</legend><div class="choices"><label><input type="radio" name="lang" value="eng" checked> English</label></div></fieldset>
    <fieldset class="field"><legend>Mode</legend>""" + radios("quality", [("200", "Fast"), ("300", "Most accurate")], "300") + """</fieldset>
  </div>
  <div class="bar"><span class="grow"></span><button id="run" class="btn primary" disabled>Recognise text</button></div>
  <section id="result" class="result" hidden aria-live="polite">
    <div class="result-head"><div id="result-sizes" class="result-sizes"></div></div>
    <p id="result-note" class="result-note"></p>
    <label class="field"><span>Recognised text</span><textarea id="text-out" class="text-out" rows="10" readonly spellcheck="false"></textarea></label>
    <div class="bar">
      <button id="download" class="btn primary">Download searchable PDF</button>
      <button id="download-txt" class="btn">Download text (.txt)</button>
      <button id="copy-text" class="btn">Copy text</button>
    </div>
  </section>
</div>"""

OCR_STEPS = ["Drop a scanned PDF, or photos of a document. Several files are combined into one PDF.",
             "Click Recognise text. Each page takes a few seconds.",
             "Download a searchable PDF (you can search, select and copy its text), or copy the plain text."]

OCR_FAQ = [
    ("Which languages are supported?",
     "English for now. More languages are coming. Text in other Latin-alphabet languages is often recognised too, but accents may be missed."),
    ("How accurate is it?",
     "Very accurate on clear printed text. Blurry photos, unusual fonts and handwriting give poorer results, so check names and numbers."),
    ("Why does the first run take longer?",
     "The first time, your browser downloads the text recognition engine (about 7 MB). After that it's stored on your device and starts instantly, even offline."),
    ("Are my documents uploaded for OCR?",
     "No. Recognition runs inside your browser. Your scans never leave your device."),
]

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
        "slug": "compress-pdf", "icon": "compress", "js": ["compress.js"], "body": "compress", "pdfjs": True,
        "card": ("Compress PDF", "Shrink a PDF to 100 KB, 200 KB or any size."),
        "title": "Compress PDF to any size, free and private | SafeMerge",
        "description": "Reduce PDF file size to 100 KB, 200 KB, 500 KB or any size you need, right in your browser. Text stays sharp, and your file is never uploaded.",
        "h1": "Compress PDF",
        "lede": "Shrink a PDF to the size an upload form or email allows, such as 100 KB or 200 KB. Text stays sharp.",
        "ui": COMPRESS_UI, "steps": COMPRESS_STEPS,
        "faq": [("How do I compress a PDF to exactly 100 KB?",
                 "Choose 100 KB and click Compress PDF. SafeMerge tries gentle settings first and keeps the best-quality version that fits under your limit.")] + COMPRESS_FAQ,
    },
    {
        "slug": "resize-image", "icon": "resize", "js": ["resize-image.js"], "body": "resize",
        "card": ("Resize image", "Photos and signatures to exact pixels and KB."),
        "title": "Resize image to KB and pixels for online forms | SafeMerge",
        "description": "Resize a photo or signature to exact pixels, mm or cm and a file size such as 20 KB or 50 KB, in your browser. Free, and your photo is never uploaded.",
        "h1": "Resize photo or signature",
        "lede": "Get a photo or signature to the exact size an online form asks for: pixels, mm or cm, and KB.",
        "ui": RESIZE_UI, "steps": RESIZE_STEPS,
        "faq": [("Does resizing make my photo blurry?",
                 "SafeMerge uses high-quality scaling and picks the best JPG quality that fits your size limit, so photos stay as sharp as the limit allows.")] + RESIZE_FAQ,
    },
    {
        "slug": "id-card-on-one-page", "icon": "idcard", "js": ["id-card.js"], "body": "idcard",
        "card": ("ID card on one page", "Front and back of a card on one page."),
        "title": "Put both sides of an ID card on one page (PDF or JPG) | SafeMerge",
        "description": "Combine the front and back of an ID card, driving licence or any card onto one A4 or Letter page, at real size, as PDF or JPG. Free, and your photos are never uploaded.",
        "h1": "ID card front and back on one page",
        "lede": "Put both sides of an ID card, driving licence or any card onto one page, ready to print or upload. Crop each side, keep the real card size, and set a size limit if your form has one.",
        "ui": IDCARD_UI,
        "steps": ["Add a photo or scan of the front, then the back.",
                  "Drag the corners to crop each side to the card's edges. Rotate if needed.",
                  "Choose the page and format, then click Create page and download."],
        "faq": [("Will it print at the real card size?",
                 "Yes. With Real card size selected, print the PDF at 100% (\u201cActual size\u201d, not \u201cFit to page\u201d) and each side comes out at 85.6 × 54 mm, the standard size for ID and bank cards."),
                ("My form wants one file under 200 KB. Can I do that?",
                 "Yes. Type 200 in Max file size. SafeMerge picks the best quality that fits."),
                ("Is it safe to use with ID documents?",
                 "Yes. Your photos never leave your device: the page is built inside your browser and nothing is uploaded.")],
    },
    unlock_page("unlock-pdf", "Unlock PDF",
        "Unlock PDF: remove a password you know, privately | SafeMerge",
        "Remove the password from a PDF you can open, so it opens without one. Works in your browser; your file and password are never uploaded.",
        "Remove the password from a PDF you can open, so you can upload, merge or print it without typing the password every time.",
        [("Why would I remove a password from a PDF?",
          "Many statements and documents arrive password-protected, but upload forms and other tools reject protected files. Unlocking a copy fixes that.")]),
    {
        "slug": "protect-pdf", "icon": "lock", "js": ["pdf-password.js"], "body": "protect", "qpdf": True,
        "card": ("Protect PDF", "Add a password to a PDF."),
        "title": "Protect PDF with a password (AES-256), privately | SafeMerge",
        "description": "Add a password to a PDF with strong AES-256 encryption, and optionally block printing or copying. Works in your browser; your file is never uploaded.",
        "h1": "Protect PDF with a password",
        "lede": "Add a password so only people you share it with can open the PDF. Uses strong AES-256 encryption.",
        "ui": PROTECT_UI,
        "steps": ["Drop your PDF in.", "Type a password twice. Optionally block printing, copying or editing.", "Click Protect PDF and download."],
        "faq": [("How strong is the protection?",
                 "SafeMerge uses AES-256, the strongest encryption standard PDFs support. Choose a long password: the encryption is only as strong as the password."),
                ("What if I forget the password?",
                 "The file can't be opened without it, by you or anyone else. Keep the password somewhere safe, or keep an unprotected copy."),
                ("Is my password sent anywhere?",
                 "No. Encryption happens in your browser. The password and the file never leave your device.")],
    },
    {
        "slug": "ocr-pdf", "icon": "ocr", "js": ["ocr.js"], "body": "ocr", "pdfjs": True, "tesseract": True,
        "card": ("OCR PDF", "Make scans searchable and copy their text."),
        "title": "OCR PDF: make scanned PDFs searchable, privately | SafeMerge",
        "description": "Turn scanned PDFs and photos of documents into searchable PDFs and copyable text, right in your browser. Free, and your scans are never uploaded.",
        "h1": "OCR: make a scanned PDF searchable",
        "lede": "Turn scans and photos of documents into PDFs you can search, select and copy text from. Or just copy the text.",
        "ui": OCR_UI, "steps": OCR_STEPS, "faq": OCR_FAQ,
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

# Extra search-landing pages: same tools with a preset, not shown as separate cards
VARIANTS = [
    {
        "slug": "image-to-text", "icon": "ocr", "js": ["ocr.js"], "body": "ocr", "pdfjs": True, "tesseract": True, "variant": True,
        "card": ("Image to text", "Copy text from a photo or screenshot."),
        "title": "Image to text: copy text from photos and scans, free | SafeMerge",
        "description": "Extract text from a photo, screenshot or scanned image in your browser and copy it. Free, and your image is never uploaded.",
        "h1": "Image to text",
        "lede": "Copy the text out of a photo, screenshot or scanned document. Drop the image, then copy the text.",
        "ui": OCR_UI, "steps": OCR_STEPS, "faq": OCR_FAQ,
    },
    unlock_page("remove-pdf-password", "Remove password from PDF",
        "Remove password from PDF (bank statements and more), free | SafeMerge",
        "Remove the password from a PDF you have the password for, such as a bank statement, so upload forms accept it. Free, and nothing is uploaded.",
        "Bank statements and many official PDFs arrive password-protected, and upload forms often reject them. Remove the password from a copy in seconds.",
        [("Why do upload forms reject my bank statement?",
          "Most portals can't read password-protected PDFs. Remove the password with your statement's password (often a date of birth or part of your name, as the bank's email explains), then upload the unlocked copy.")],
        variant=True),
    resize_variant("resize-image-to-20kb", "Resize image to 20 KB", "Shrink a photo under 20 KB.",
        "Shrink a photo or signature to under 20 KB for upload forms.", {"maxkb": "20"},
        [("Will a 20 KB photo still look clear?", "At typical form sizes such as 200 × 230 pixels, yes. Very large dimensions may need to be reduced to fit 20 KB.")]),
    resize_variant("resize-image-to-50kb", "Resize image to 50 KB", "Shrink a photo under 50 KB.",
        "Shrink a photo or signature to under 50 KB for upload forms.", {"maxkb": "50"},
        [("Why do forms ask for photos under 50 KB?", "Small files keep application portals fast. SafeMerge gets you under the limit without uploading your photo.")]),
    resize_variant("resize-image-to-100kb", "Resize image to 100 KB", "Shrink a photo under 100 KB.",
        "Shrink a photo to under 100 KB for forms, email and websites.", {"maxkb": "100"}, []),
    resize_variant("resize-signature", "Resize signature for online forms", "Signature to exact pixels and KB.",
        "Turn a phone photo of your signature into a clean, correctly sized image for application forms.", {"preset": "signature"},
        [("What size should a signature image be?", "Many forms ask for about 140 × 60 pixels and 10–20 KB. Check your form's instructions and type its exact numbers if they differ.")]),
    resize_variant("passport-photo-size", "Passport photo size converter", "Crop a photo to 35 × 45 mm.",
        "Crop and resize a photo to passport size, 35 × 45 mm, or any size you type.", {"preset": "passport"},
        [("What is the standard passport photo size?", "35 × 45 mm is used by many countries, including the UK, most of Europe and Australia. The US uses 2 × 2 inches: choose Custom size and type 2 and 2 in inches.")]),
    compress_variant(100, "100 KB", [("Is 100 KB enough for a multi-page PDF?",
        "For one or two pages of text or a clear scan, usually yes. Long scanned documents may need Black & white, or fewer pages.")]),
    compress_variant(200, "200 KB", [("Why do forms ask for PDFs under 200 KB?",
        "Many application and government portals cap uploads at 200 KB to keep their servers fast. SafeMerge gets you under it without uploading your file anywhere.")]),
    compress_variant(500, "500 KB", [("Will 500 KB keep my scan readable?",
        "Almost always. 500 KB leaves room for good-quality scans of several pages.")]),
    compress_variant(1024, "1 MB", [("How do I make a PDF smaller than 1 MB for email?",
        "Choose 1 MB and click Compress PDF. Most PDFs reach it with only the images shrunk, so text stays sharp.")]),
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
<meta property="og:site_name" content="{SITE_NAME}">
<meta property="og:image" content="{SITE_URL}/assets/img/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="{SITE_URL}/assets/img/og.png">
<meta name="robots" content="index, follow, max-image-preview:large">
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
    <a href="/merge-pdf/">Merge</a><a href="/compress-pdf/">Compress</a><a href="/split-pdf/">Split</a>
    <a href="/#tools">All tools</a>
    <a class="donate" href="#" data-donate hidden rel="noopener" target="_blank">Support us</a>
  </nav>
</div></header>"""

def footer():
    links = "".join(f'<a href="/{t["slug"]}/">{t["card"][0]}</a>' for t in TOOLS)
    return f"""<footer class="site-footer"><div class="wrap">
  <div>
    <strong style="color:var(--ink)">{SITE_NAME}</strong> · Your files never leave your device.<br>
    <a href="/about/">About</a> · <a href="/privacy/">Privacy</a> · <a href="{GITHUB_URL}" rel="noopener">Code on GitHub</a> ·
    <button id="ad-choices" class="linklike" hidden>Ad cookie choice</button>
    <a href="#" data-donate hidden rel="noopener" target="_blank">Support us</a><br>
    © 2026 mmklabs. All rights reserved.
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
        if tool.get("tesseract"):
            tags.append('<script src="/vendor/tesseract/tesseract.min.js" defer></script>')
        if tool.get("qpdf"):
            tags.append('<script src="/vendor/qpdf/qpdf.js" defer></script>')
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

def ld(data):
    return f'<script type="application/ld+json">{json.dumps(data)}</script>\n'

PUBLISHER = {"@type": "Organization", "name": "mmklabs", "url": SITE_URL, "sameAs": [GITHUB_URL]}

def app_schema(name, description, url, features):
    return ld({
        "@context": "https://schema.org", "@type": "WebApplication",
        "name": name, "description": description, "url": url,
        "applicationCategory": "UtilitiesApplication", "operatingSystem": "Any (runs in a web browser)",
        "browserRequirements": "Requires JavaScript. Works offline after the first visit.",
        "isAccessibleForFree": True, "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"},
        "featureList": features, "publisher": PUBLISHER,
    })

def breadcrumb_schema(name, path):
    return ld({"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": SITE_NAME, "item": f"{SITE_URL}/"},
        {"@type": "ListItem", "position": 2, "name": name, "item": f"{SITE_URL}{path}"}]})

PRIVACY_FEATURES = ["Files are processed on your device and never uploaded", "Works offline",
                    "No sign-up, no watermarks, no file limits", "Source code publicly viewable on GitHub"]

def body_data(t):
    data = dict(t.get("data", {}))
    if t.get("target"):
        data["target"] = t["target"]
    return "".join(f' data-{k}="{html.escape(v)}"' for k, v in data.items())

def tool_page(t):
    faqs = t["faq"] + COMMON_FAQ
    others = "".join(f'<a class="tool-card" href="/{o["slug"]}/">{icon(o["icon"])}<div><h3>{o["card"][0]}</h3><p>{o["card"][1]}</p></div></a>'
                     for o in TOOLS if o is not t)
    steps = "".join(f"<li>{html.escape(s)}</li>" for s in t["steps"])
    path = f'/{t["slug"]}/'
    schema = (faq_schema(faqs)
              + app_schema(f'{SITE_NAME} {t["card"][0]}', t["description"], SITE_URL + path, [t["card"][1]] + PRIVACY_FEATURES)
              + breadcrumb_schema(t["card"][0], path))
    return f"""{head(t["title"], t["description"], path, schema)}
<body data-tool="{t["body"]}"{body_data(t)}>
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
                 faq_schema(COMMON_FAQ)
                 + ld({"@context": "https://schema.org", "@type": "WebSite", "name": SITE_NAME, "url": f"{SITE_URL}/", "publisher": PUBLISHER})
                 + app_schema(SITE_NAME, "Free PDF tools that run in your browser: merge, split, rotate, organize, convert, number and watermark PDFs without uploading them.",
                              f"{SITE_URL}/", [t["card"][1] for t in TOOLS] + PRIVACY_FEATURES))}
<body>
{header()}
<main>
  <div class="wrap">
    <section class="hero">
      <h1>PDF tools that never upload your files</h1>
      <p class="lede">Merge, split, convert and edit PDFs right in your browser. Your documents stay on your device, so contracts, medical records and payslips stay private.</p>
      <div class="promise">{SHIELD} Free · no sign-up · works offline · code you can check</div>
    </section>
    <section id="tools" aria-label="Tools"><div class="tool-grid">{cards}</div></section>
    <div class="ad-slot" aria-label="Advertisement"></div>
    <section class="content">
      <div class="why">
        <div><h3>Nothing is uploaded</h3><p>Other PDF sites send your file to their servers. SafeMerge does the work inside your browser, so your file never travels.</p></div>
        <div><h3>Works with Wi-Fi off</h3><p>Load the page once, then disconnect. Everything still works, which shows that nothing is being sent.</p></div>
        <div><h3>No account, no limits</h3><p>No email, no daily caps, no watermarks on your files. Just open a tool and use it.</p></div>
        <div><h3>Code you can check</h3><p>Every line of code is public on <a href="{GITHUB_URL}" rel="noopener">GitHub</a>, so anyone can check that files are never sent anywhere.</p></div>
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
<p class="lede">Short version: your files never leave your device. We count visits without cookies, and Google ads load only if you allow them.</p>

<h2>Your files</h2>
<p>Every SafeMerge tool runs inside your web browser. When you choose a file, your browser reads it from your device, changes it there, and saves the result back to your device. Files are never sent to SafeMerge or anyone else. We have no server that could receive them.</p>
<p>You can check this yourself: load a tool, turn off your internet connection, and use it. It still works.</p>

<h2>What we collect</h2>
<p>We count visits so we know how many people use SafeMerge and which tools are popular. For this we use <a href="https://www.cloudflare.com/web-analytics/" rel="noopener">Cloudflare Web Analytics</a>, which uses no cookies and does not track you as an individual or across other websites. It records things like the page visited, the referring site, country, browser and device type, and page load speed. It never sees your files.</p>
<p>There are no accounts, no advertising trackers and no SafeMerge cookies. We remember one setting in your browser's local storage, your ad cookie choice, so we don't ask again. It stays on your device.</p>

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
<p style="color:var(--muted)">Last updated: 27 October 2026</p>
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

def about_page():
    tool_rows = "".join(f'<li><a href="/{t["slug"]}/">{t["card"][0]}</a>: {t["card"][1]}</li>' for t in TOOLS)
    body = f"""
<h1>About {SITE_NAME}</h1>
<p class="lede">{SITE_NAME} is a free set of PDF tools that run entirely in your web browser. Your files are never uploaded to a server.</p>

<h2>The short facts</h2>
<ul>
  <li><strong>What it does:</strong> merge, split, rotate, reorder and delete pages, convert images to PDF and PDF to images, add page numbers, and add watermarks.</li>
  <li><strong>Where files go:</strong> nowhere. They are read and changed on your own device and saved back to it.</li>
  <li><strong>Cost:</strong> free. No sign-up, no watermarks on your files, no daily limits.</li>
  <li><strong>Offline:</strong> after the first visit, every tool works without an internet connection.</li>
  <li><strong>Code:</strong> publicly viewable at <a href="{GITHUB_URL}" rel="noopener">github.com/mmklabs/safemerge</a>.</li>
  <li><strong>Made by:</strong> mmklabs, an independent developer.</li>
</ul>

<h2>Tools</h2>
<ul>{tool_rows}</ul>

<h2>How it works</h2>
<p>Most online PDF services upload your file to their servers, process it there, and send back the result. {SITE_NAME} does the opposite: the website sends your browser the tools, and your browser does the work. It uses three well-known open-source libraries: pdf-lib for editing PDFs, Mozilla's PDF.js for drawing pages, and JSZip for packing several files into one download.</p>

<div class="table-scroll"><table>
<thead><tr><th></th><th>{SITE_NAME}</th><th>Typical upload-based PDF site</th></tr></thead>
<tbody>
<tr><td>Your file is sent to a server</td><td>No</td><td>Yes</td></tr>
<tr><td>Works with no internet connection</td><td>Yes, after the first visit</td><td>No</td></tr>
<tr><td>Account needed</td><td>No</td><td>Often, for larger files or more tasks</td></tr>
<tr><td>File size limit</td><td>Only your device's memory</td><td>Usually a fixed limit on free plans</td></tr>
<tr><td>Code you can inspect</td><td>Yes, on GitHub</td><td>Usually not</td></tr>
</tbody></table></div>

<h2>Check it yourself</h2>
<ol>
  <li>Open any tool, then turn off Wi-Fi. The tool keeps working.</li>
  <li>Or open your browser's developer tools, go to the Network tab, and use a tool. No request carries your file.</li>
  <li>Or read the code on <a href="{GITHUB_URL}" rel="noopener">GitHub</a>.</li>
</ol>

<h2>Who it's for</h2>
<p>Anyone handling documents they'd rather not hand to a stranger's server: bank statements, ID documents, contracts, medical records, payslips, and school or job applications.</p>

<h2>Contact</h2>
<p><span class="contact-email">privacy@safemergefiles.com</span></p>
"""
    desc = f"{SITE_NAME} is a free set of PDF tools that run in your browser, with code anyone can check. Files are never uploaded. How it works and how to check."
    schema = ld({"@context": "https://schema.org", "@type": "AboutPage", "name": f"About {SITE_NAME}",
                 "url": f"{SITE_URL}/about/", "description": desc, "publisher": PUBLISHER})
    return f"""{head(f"About {SITE_NAME}: free PDF tools that never upload your files", desc, "/about/", schema)}
<body>
{header()}
<main><div class="wrap narrow prose">{body}</div></main>
{footer()}
{scripts()}
</body>
</html>
"""

def llms_txt():
    tools = "\n".join(f'- [{t["card"][0]}]({SITE_URL}/{t["slug"]}/): {t["description"]}' for t in TOOLS)
    return f"""# {SITE_NAME}

> {SITE_NAME} ({SITE_URL}) is a free set of PDF tools that run entirely in the web browser. Files are processed on the user's own device and are never uploaded to any server. No sign-up, no watermarks, no file limits, and it works offline after the first visit.

Key facts:
- Privacy: files never leave the device; the site has no server that receives files.
- Cost: free, supported by optional cookie-free ads, opt-in Google ads, and donations.
- Code: publicly viewable at {GITHUB_URL} (all rights reserved; not open source)
- Built with pdf-lib, Mozilla PDF.js and JSZip.
- Good fit for sensitive documents: bank statements, ID documents (such as Aadhaar or passports), contracts, medical records, payslips.

## Tools
{tools}

## More
- [About]({SITE_URL}/about/): what {SITE_NAME} is, how it works, and how to verify that nothing is uploaded
- [Privacy policy]({SITE_URL}/privacy/)
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
    for t in TOOLS + VARIANTS:
        write(f'{t["slug"]}/index.html', tool_page(t))
    write("privacy/index.html", privacy_page())
    write("about/index.html", about_page())
    write("404.html", not_found_page())
    write("llms.txt", llms_txt())
    write(f"{INDEXNOW_KEY}.txt", INDEXNOW_KEY)
    urls = ["/"] + [f'/{t["slug"]}/' for t in TOOLS + VARIANTS] + ["/about/", "/privacy/"]
    sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    sitemap += "".join(f"  <url><loc>{SITE_URL}{u}</loc><lastmod>{LASTMOD}</lastmod></url>\n" for u in urls) + "</urlset>\n"
    write("sitemap.xml", sitemap)
    write("robots.txt", f"User-agent: *\nAllow: /\nSitemap: {SITE_URL}/sitemap.xml\n")

if __name__ == "__main__":
    main()

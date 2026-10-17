import {
  PDFDocument, StandardFonts, rgb, degrees, BlendMode, LineCapStyle,
  PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFOptionList,
} from 'pdf-lib';
import { displaySize, totalRotation } from './geometry.js';

const FONT_MAP = {
  Helvetica: StandardFonts.Helvetica,
  Times: StandardFonts.TimesRoman,
  Courier: StandardFonts.Courier,
};

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

// Standard 14 fonts only cover WinAnsi; replace anything else so drawText never throws.
const safeText = (s) => s.replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');

/** Map a point in display space (points, top-left origin, page as shown) to PDF user space. */
function makeMapper(page) {
  const [x0, y0, x1, y1] = page.view;
  const w = x1 - x0, h = y1 - y0;
  switch (totalRotation(page)) {
    case 90: return (x, y) => ({ x: x0 + y, y: y0 + x });
    case 180: return (x, y) => ({ x: x0 + w - x, y: y0 + y });
    case 270: return (x, y) => ({ x: x0 + w - y, y: y0 + h - x });
    default: return (x, y) => ({ x: x0 + x, y: y0 + h - y });
  }
}

/** Fill (and flatten) form fields of a source document in place. */
export function applyFormValues(doc, values) {
  const form = doc.getForm();
  for (const [name, val] of Object.entries(values)) {
    try {
      const f = form.getField(name);
      if (f instanceof PDFTextField) f.setText(val);
      else if (f instanceof PDFCheckBox) (val ? f.check() : f.uncheck());
      else if (f instanceof PDFDropdown || f instanceof PDFRadioGroup || f instanceof PDFOptionList) {
        if (val) f.select(val);
      }
    } catch (e) {
      console.warn('Could not set field', name, e);
    }
  }
  try { form.flatten(); } catch (e) { console.warn('Could not flatten form', e); }
}

/** List form fields of a pdf-lib document as plain objects. */
export function listFields(doc) {
  let fields = [];
  try { fields = doc.getForm().getFields(); } catch { return []; }
  return fields.map((f) => {
    const name = f.getName();
    if (f instanceof PDFTextField) return { name, type: 'text', value: f.getText() ?? '' };
    if (f instanceof PDFCheckBox) return { name, type: 'checkbox', value: f.isChecked() };
    if (f instanceof PDFDropdown || f instanceof PDFOptionList) {
      return { name, type: 'choice', options: f.getOptions(), value: f.getSelected()[0] ?? '' };
    }
    if (f instanceof PDFRadioGroup) return { name, type: 'choice', options: f.getOptions(), value: f.getSelected() ?? '' };
    return null;
  }).filter(Boolean);
}

async function dataUrlBytes(url) {
  return new Uint8Array(await (await fetch(url)).arrayBuffer());
}

/**
 * Build a PDF from a list of page entries.
 * @param sources Map of source id -> { bytes, formValues }
 * @param pages   page entries (see main.js)
 * @param opts    { title, author, pageNumbers, watermark }
 */
export async function buildPdf(sources, pages, opts = {}) {
  const out = await PDFDocument.create();
  const srcDocs = new Map();
  for (const p of pages) {
    if (!p.srcId || srcDocs.has(p.srcId)) continue;
    const s = sources.get(p.srcId);
    const doc = await PDFDocument.load(s.bytes, { ignoreEncryption: true });
    if (Object.keys(s.formValues).length) applyFormValues(doc, s.formValues);
    srcDocs.set(p.srcId, doc);
  }

  const fonts = {};
  const font = async (name) => (fonts[name] ??= await out.embedFont(FONT_MAP[name] ?? StandardFonts.Helvetica));
  const images = new Map();
  const image = async (src) => {
    if (!images.has(src)) {
      const bytes = await dataUrlBytes(src);
      images.set(src, src.startsWith('data:image/jpeg') ? await out.embedJpg(bytes) : await out.embedPng(bytes));
    }
    return images.get(src);
  };

  for (const [i, p] of pages.entries()) {
    let page;
    if (p.srcId) {
      const [copied] = await out.copyPages(srcDocs.get(p.srcId), [p.srcIndex]);
      page = out.addPage(copied);
    } else {
      page = out.addPage([p.view[2] - p.view[0], p.view[3] - p.view[1]]);
    }
    const R = totalRotation(p);
    page.setRotation(degrees(R));
    const map = makeMapper(p);
    const rotate = degrees(R);
    // Display-space rectangle -> user-space box (rotation-independent).
    const userBox = (x, y, w, h) => {
      const c1 = map(x, y);
      const c2 = map(x + w, y + h);
      return { left: Math.min(c1.x, c2.x), bottom: Math.min(c1.y, c2.y), right: Math.max(c1.x, c2.x), top: Math.max(c1.y, c2.y) };
    };
    const white = (b) => page.drawRectangle({ x: b.left, y: b.bottom, width: b.right - b.left, height: b.top - b.bottom, color: rgb(1, 1, 1) });

    const regions = p.annots.filter((a) => a.type === 'region');
    for (const a of regions) white(userBox(a.sx, a.sy, a.sw, a.sh));

    for (const a of p.annots) {
      if (a.type === 'region') {
        // Vector copy of the original page content inside the source box.
        const embedded = await out.embedPage(srcDocs.get(p.srcId).getPage(p.srcIndex), userBox(a.sx, a.sy, a.sw, a.sh));
        const b = userBox(a.x, a.y, a.w, a.h);
        white(b);
        page.drawPage(embedded, { x: b.left, y: b.bottom, width: b.right - b.left, height: b.top - b.bottom });
      } else if (a.type === 'text') {
        const f = await font(a.font);
        a.text.split('\n').forEach((line, li) => {
          if (!line) return;
          const pt = map(a.x, a.y + (li * 1.2 + 0.95) * a.size);
          page.drawText(safeText(line), { ...pt, size: a.size, font: f, color: hexToRgb(a.color), rotate });
        });
      } else if (a.type === 'ink') {
        const sx = a.w / a.vw, sy = a.h / a.vh;
        const pts = a.pts.map(([x, y]) => map(a.x + x * sx, a.y + y * sy));
        if (pts.length === 1) pts.push({ x: pts[0].x + 0.01, y: pts[0].y });
        for (let k = 1; k < pts.length; k++) {
          page.drawLine({
            start: pts[k - 1], end: pts[k], thickness: a.width,
            color: hexToRgb(a.color), lineCap: LineCapStyle.Round,
          });
        }
      } else if (a.type === 'image') {
        const img = await image(a.src);
        page.drawImage(img, { ...map(a.x, a.y + a.h), width: a.w, height: a.h, rotate });
      } else {
        const style = {
          highlight: () => ({ color: hexToRgb(a.color), opacity: 0.4, blendMode: BlendMode.Multiply }),
          rect: () => ({ borderColor: hexToRgb(a.color), borderWidth: a.width }),
          whiteout: () => ({ color: rgb(1, 1, 1) }),
          redact: () => ({ color: rgb(0, 0, 0) }),
        }[a.type]();
        page.drawRectangle({ ...map(a.x, a.y + a.h), width: a.w, height: a.h, rotate, ...style });
      }
    }

    const { w: dw, h: dh } = displaySize(p);
    if (opts.pageNumbers) {
      const f = await font('Helvetica');
      const label = `${i + 1} / ${pages.length}`;
      const tw = f.widthOfTextAtSize(label, 10);
      page.drawText(label, { ...map(dw / 2 - tw / 2, dh - 20), size: 10, font: f, color: rgb(0.3, 0.3, 0.3), rotate });
    }
    if (opts.watermark) {
      const f = await font('Helvetica');
      const text = safeText(opts.watermark);
      const size = Math.min(dw, dh) / Math.max(4, text.length * 0.55);
      const tw = f.widthOfTextAtSize(text, size);
      const c = Math.SQRT1_2;
      // Start so the 45° baseline is centred on the page (display space, y down).
      const sx = dw / 2 - (tw / 2) * c + (size / 3) * c;
      const sy = dh / 2 + (tw / 2) * c + (size / 3) * c;
      page.drawText(text, {
        ...map(sx, sy), size, font: f, color: rgb(0.5, 0.5, 0.5), opacity: 0.25, rotate: degrees(R + 45),
      });
    }
  }

  if (opts.title) out.setTitle(opts.title);
  if (opts.author) out.setAuthor(opts.author);
  out.setProducer('Simple PDF Editor');
  out.setCreator('Simple PDF Editor');
  return out.save();
}

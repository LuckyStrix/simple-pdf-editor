import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, degrees } from 'pdf-lib';
import { buildPdf, listFields } from '../src/export.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function samplePdf() {
  const d = await PDFDocument.create();
  d.addPage([612, 792]);
  d.addPage([612, 792]).setRotation(degrees(90));
  d.getForm().createTextField('name').addToPage(d.getPage(0), { x: 50, y: 600, width: 200, height: 20 });
  return d.save();
}

const annots = [
  { type: 'text', x: 50, y: 50, text: 'Hello\nWorld ✓', size: 20, color: '#ff0000', font: 'Times' },
  { type: 'ink', x: 100, y: 100, w: 50, h: 50, vw: 50, vh: 50, pts: [[0, 0], [50, 50]], color: '#0000ff', width: 2 },
  { type: 'image', x: 200, y: 200, w: 40, h: 40, src: PNG },
  { type: 'highlight', x: 10, y: 300, w: 100, h: 20, color: '#ffff00' },
  { type: 'rect', x: 10, y: 400, w: 100, h: 20, color: '#00ff00', width: 2 },
  { type: 'whiteout', x: 10, y: 500, w: 100, h: 20 },
  { type: 'redact', x: 10, y: 550, w: 100, h: 20 },
];

test('lists form fields', async () => {
  const fields = listFields(await PDFDocument.load(await samplePdf()));
  assert.deepEqual(fields, [{ name: 'name', type: 'text', value: '' }]);
});

test('builds a PDF with reordering, rotation, blank pages, annotations and options', async () => {
  const bytes = await samplePdf();
  const sources = new Map([['s', { bytes, formValues: { name: 'Ada' } }]]);
  const pages = [
    { srcId: 's', srcIndex: 1, origRot: 90, rot: 90, view: [0, 0, 612, 792], annots },
    { srcId: 's', srcIndex: 0, origRot: 0, rot: 0, view: [0, 0, 612, 792], annots },
    { srcId: 's', srcIndex: 0, origRot: 0, rot: 270, view: [0, 0, 612, 792], annots },
    { srcId: null, srcIndex: 0, origRot: 0, rot: 0, view: [0, 0, 300, 300], annots: [] },
  ];
  const out = await buildPdf(sources, pages, { title: 'Test', author: 'Me', pageNumbers: true, watermark: 'DRAFT' });
  const doc = await PDFDocument.load(out);
  assert.equal(doc.getPageCount(), 4);
  assert.deepEqual(doc.getPages().map((p) => p.getRotation().angle), [180, 0, 270, 0]);
  assert.deepEqual(doc.getPage(3).getSize(), { width: 300, height: 300 });
  assert.equal(doc.getTitle(), 'Test');
  assert.equal(doc.getAuthor(), 'Me');
  // Filled form is flattened into page content.
  assert.equal(doc.getForm().getFields().length, 0);
});

test('moves an area of original content as a vector copy', async () => {
  const d = await PDFDocument.create();
  const font = await d.embedFont('Helvetica');
  const page = d.addPage([612, 792]);
  page.drawText('Question 1', { x: 72, y: 700, size: 24, font });
  page.drawText('Question 2', { x: 72, y: 650, size: 24, font });
  const bytes = await d.save();
  const region = { type: 'region', sx: 60, sy: 120, sw: 300, sh: 40, x: 60, y: 320, w: 300, h: 40, r0: 0, src: PNG };
  const out = await buildPdf(new Map([['s', { bytes, formValues: {} }]]), [
    { srcId: 's', srcIndex: 0, origRot: 0, rot: 0, view: [0, 0, 612, 792], annots: [region] },
  ]);
  const doc = await PDFDocument.load(out);
  assert.equal(doc.getPageCount(), 1);
  if (process.env.REGION_OUT) (await import('node:fs')).writeFileSync(process.env.REGION_OUT, out);
});

test('embeds a Unicode font for text the standard fonts cannot encode, and draws covers', async () => {
  const { readFileSync } = await import('node:fs');
  const loadFont = async () => readFileSync(new URL('../node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf', import.meta.url));
  const text = { type: 'text', x: 72, y: 72, text: 'Solve x² + y² ≤ 1 for θ ∈ ℝ, μ = 0.3, λ = 500 nm\n\nAnswer: θ = π/4, Λ, Ω', size: 14, color: '#000000', font: 'Helvetica', covers: [[70, 70, 300, 20]] };
  const out = await buildPdf(new Map(), [
    { srcId: null, srcIndex: 0, origRot: 0, rot: 0, view: [0, 0, 612, 792], annots: [text] },
  ], { loadFont });
  const doc = await PDFDocument.load(out);
  assert.equal(doc.getPageCount(), 1);
  // Subset embedding keeps the output small.
  assert.ok(out.length < 200_000, `output is ${out.length} bytes`);
  if (process.env.UNICODE_OUT) (await import('node:fs')).writeFileSync(process.env.UNICODE_OUT, out);
});

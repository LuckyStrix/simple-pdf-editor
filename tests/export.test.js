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

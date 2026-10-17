/** Rotation actually shown: the page's own /Rotate plus the user's rotation. */
export const totalRotation = (p) => (((p.origRot + p.rot) % 360) + 360) % 360;

/** Line height of a text annotation, as a multiple of its font size. */
export const lineHeight = (a) => a.lh ?? 1.2;

/** Distance from the top of a text annotation's line box to its baseline, in em (matches CSS line boxes). */
export const baselineOffset = (a) => lineHeight(a) / 2 + 0.35;

/** Page size in points as displayed (after rotation). */
export function displaySize(p) {
  const w = p.view[2] - p.view[0];
  const h = p.view[3] - p.view[1];
  return totalRotation(p) % 180 === 0 ? { w, h } : { w: h, h: w };
}

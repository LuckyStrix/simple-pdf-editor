// Greek letters and math symbols: decoding them from old "Symbol" fonts, and typing them.

// Adobe Symbol font encoding (byte -> Unicode) for the characters that differ from ASCII.
const SYMBOL_ENCODING = {
  0x22: '∀', 0x24: '∃', 0x27: '∋', 0x2a: '∗', 0x2d: '−', 0x40: '≅',
  0x41: 'Α', 0x42: 'Β', 0x43: 'Χ', 0x44: 'Δ', 0x45: 'Ε', 0x46: 'Φ', 0x47: 'Γ', 0x48: 'Η', 0x49: 'Ι',
  0x4a: 'ϑ', 0x4b: 'Κ', 0x4c: 'Λ', 0x4d: 'Μ', 0x4e: 'Ν', 0x4f: 'Ο', 0x50: 'Π', 0x51: 'Θ', 0x52: 'Ρ',
  0x53: 'Σ', 0x54: 'Τ', 0x55: 'Υ', 0x56: 'ς', 0x57: 'Ω', 0x58: 'Ξ', 0x59: 'Ψ', 0x5a: 'Ζ',
  0x5c: '∴', 0x5e: '⊥',
  0x61: 'α', 0x62: 'β', 0x63: 'χ', 0x64: 'δ', 0x65: 'ε', 0x66: 'φ', 0x67: 'γ', 0x68: 'η', 0x69: 'ι',
  0x6a: 'ϕ', 0x6b: 'κ', 0x6c: 'λ', 0x6d: 'μ', 0x6e: 'ν', 0x6f: 'ο', 0x70: 'π', 0x71: 'θ', 0x72: 'ρ',
  0x73: 'σ', 0x74: 'τ', 0x75: 'υ', 0x76: 'ϖ', 0x77: 'ω', 0x78: 'ξ', 0x79: 'ψ', 0x7a: 'ζ', 0x7e: '∼',
  0xa1: 'ϒ', 0xa2: '′', 0xa3: '≤', 0xa5: '∞', 0xa6: 'ƒ', 0xab: '↔', 0xac: '←', 0xad: '↑', 0xae: '→',
  0xaf: '↓', 0xb0: '°', 0xb1: '±', 0xb2: '″', 0xb3: '≥', 0xb4: '×', 0xb5: '∝', 0xb6: '∂', 0xb7: '•',
  0xb8: '÷', 0xb9: '≠', 0xba: '≡', 0xbb: '≈', 0xbc: '…', 0xc4: '⊗', 0xc5: '⊕', 0xc6: '∅', 0xc7: '∩',
  0xc8: '∪', 0xc9: '⊃', 0xca: '⊇', 0xcb: '⊄', 0xcc: '⊂', 0xcd: '⊆', 0xce: '∈', 0xcf: '∉', 0xd0: '∠',
  0xd1: '∇', 0xd5: '∏', 0xd6: '√', 0xd7: '⋅', 0xd8: '¬', 0xd9: '∧', 0xda: '∨', 0xdb: '⇔', 0xdc: '⇐',
  0xdd: '⇑', 0xde: '⇒', 0xdf: '⇓', 0xe0: '◊', 0xe1: '〈', 0xe5: '∑', 0xf1: '〉', 0xf2: '∫',
};

// Look-alike code points some PDFs use instead of the Greek letters.
const LOOKALIKES = { '∆': 'Δ', 'Ω': 'Ω', 'µ': 'μ' };

/**
 * Fix text extracted from a PDF.
 * Word and older tools draw Greek with a "Symbol" font whose codes are plain letters ("m" for μ)
 * or private-use codes (U+F06D); map both to real Unicode.
 */
export function decodeSymbols(str, isSymbolFont) {
  let out = '';
  for (const ch of str) {
    const code = ch.codePointAt(0);
    if (code >= 0xf020 && code <= 0xf0ff) out += SYMBOL_ENCODING[code - 0xf000] ?? String.fromCharCode(code - 0xf000);
    else if (isSymbolFont && code < 0x100) out += SYMBOL_ENCODING[code] ?? ch;
    else out += LOOKALIKES[ch] ?? ch;
  }
  return out;
}

/** LaTeX-style names: typing "\mu " in a text box gives "μ". */
export const LATEX = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', omicron: 'ο',
  pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'ϕ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ',
  Psi: 'Ψ', Omega: 'Ω',
  pm: '±', mp: '∓', times: '×', div: '÷', cdot: '·', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠',
  approx: '≈', sim: '∼', equiv: '≡', propto: '∝', infty: '∞', sqrt: '√', int: '∫', oint: '∮', sum: '∑', prod: '∏',
  partial: '∂', nabla: '∇', deg: '°', degree: '°', prime: '′', to: '→', rightarrow: '→', leftarrow: '←',
  Rightarrow: '⇒', implies: '⇒', iff: '⇔', leftrightarrow: '↔', in: '∈', notin: '∉', subset: '⊂',
  subseteq: '⊆', cup: '∪', cap: '∩', emptyset: '∅', forall: '∀', exists: '∃', neg: '¬', land: '∧', lor: '∨',
  angle: '∠', perp: '⊥', parallel: '∥', hbar: 'ℏ', ell: 'ℓ', angstrom: 'Å', permil: '‰', dots: '…', cdots: '⋯',
  R: 'ℝ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ', half: '½',
};

/** Characters offered by the symbol picker, in groups. */
export const PALETTE = [
  ['Greek', 'αβγδεζηθικλμνξπρστυφχψω'],
  ['Greek capitals', 'ΓΔΘΛΞΠΣΦΨΩ'],
  ['Math', '±×÷·≤≥≠≈≡∝∞√∫∑∏∂∇°′″∠⊥∥'],
  ['Arrows & logic', '→←↔⇒⇔∈∉⊂⊆∪∩∅∀∃¬∧∨'],
  ['Super / subscripts', '⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻ⁿ₀₁₂₃₄₅₆₇₈₉₊₋'],
  ['Other', 'ℝℕℤℚℂℏℓÅ½¼¾‰…'],
];

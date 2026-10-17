import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeSymbols, LATEX } from '../src/symbols.js';

test('decodes Word-style private-use Symbol codes', () => {
  assert.equal(decodeSymbols(' = 0.3,  = 500 nm, x  2', false), 'μ = 0.3, λ = 500 nm, Δx ≤ 2π');
});

test('decodes plain letters drawn with a Symbol font', () => {
  assert.equal(decodeSymbols('mlpW', true), 'μλπΩ');
  assert.equal(decodeSymbols('mlpW', false), 'mlpW');
});

test('turns Word equation math italics into plain letters', () => {
  assert.equal(decodeSymbols('(\u{1D706} = 2.166 \u{1D707}\u{1D45A}), R = \u{1D706}/Δ\u{1D706}', false), '(λ = 2.166 μm), R = λ/Δλ');
});

test('normalises look-alike code points', () => {
  assert.equal(decodeSymbols('∆ Ω µ', false), 'Δ Ω μ');
});

test('LaTeX names cover common Greek and math', () => {
  for (const [k, v] of Object.entries({ mu: 'μ', lambda: 'λ', Omega: 'Ω', le: '≤', pm: '±', infty: '∞' })) assert.equal(LATEX[k], v);
});

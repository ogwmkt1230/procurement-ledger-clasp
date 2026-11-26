const test = require('node:test');
const assert = require('node:assert');
const { SHEETS, colIndex } = require('../src/core/schema.js');

test('schema: 全シートでheadersが重複しない', () => {
  for (const k of Object.keys(SHEETS)) assert.strictEqual(new Set(SHEETS[k].headers).size, SHEETS[k].headers.length, k);
});
test('schema: key・required・protectedはheadersに含まれる', () => {
  for (const k of Object.keys(SHEETS)) {
    const s = SHEETS[k];
    for (const h of [s.key, ...s.required, ...s.protected]) assert.ok(s.headers.includes(h), `${k}:${h}`);
  }
});
test('schema: colIndex', () => {
  assert.strictEqual(colIndex('input', '明細ID'), 0);
  assert.throws(() => colIndex('input', '存在しない'));
});

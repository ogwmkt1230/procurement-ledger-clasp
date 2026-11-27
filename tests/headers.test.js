const test = require('node:test');
const assert = require('node:assert');
const { rowsToObjects } = require('../src/core/schema.js');
const { accountingClass } = require('../src/core/orders.js');

test('schema: 種別マスタは A種別・B会計区分・C仕入先コードとして読む', () => {
  const kinds = rowsToObjects('mKinds', [['開発費', '費用', ''], ['開発費', '商品原価', 'S-IMN']]);
  assert.strictEqual(accountingClass('開発費', kinds, 'S-IMN'), '商品原価');
  assert.strictEqual(accountingClass('開発費', kinds, 'S-MTM'), '費用');
});

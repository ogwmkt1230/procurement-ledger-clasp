const test = require('node:test');
const assert = require('node:assert');
const { rowsToObjects, headersToAppend } = require('../src/core/schema.js');
const { accountingClass } = require('../src/core/orders.js');

test('schema: 種別マスタは A種別・B会計区分・C仕入先コードとして読む', () => {
  const kinds = rowsToObjects('mKinds', [['開発費', '費用', ''], ['開発費', '商品原価', 'S-IMN']]);
  assert.strictEqual(accountingClass('開発費', kinds, 'S-IMN'), '商品原価');
  assert.strictEqual(accountingClass('開発費', kinds, 'S-MTM'), '費用');
});
test('schema: headersToAppend 一致なら足すものなし', () => {
  const def = ['種別', '会計区分', '仕入先コード'];
  assert.deepStrictEqual(headersToAppend(def.slice(), def), []);
});
test('schema: headersToAppend 右の空セルに足りない見出しを返す', () => {
  const def = ['種別', '会計区分', '仕入先コード'];
  assert.deepStrictEqual(headersToAppend(['種別', '会計区分', ''], def), ['仕入先コード']);
  assert.deepStrictEqual(headersToAppend(['種別', '会計区分'], def), ['仕入先コード']);
  assert.deepStrictEqual(headersToAppend(['種別', '会計区分', null], def), ['仕入先コード']);
});
test('schema: headersToAppend 1列目から違う・途中が違う・足す場所に文字があるときは null', () => {
  const def = ['種別', '会計区分', '仕入先コード'];
  assert.strictEqual(headersToAppend(['', '', ''], def), null);
  assert.strictEqual(headersToAppend(['種別', '区分', ''], def), null);
  assert.strictEqual(headersToAppend(['種別', '会計区分', 'メモ'], def), null);
  assert.strictEqual(headersToAppend(['種別', '', '仕入先コード'], def), null);
});

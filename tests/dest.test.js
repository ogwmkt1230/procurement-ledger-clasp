const test = require('node:test');
const assert = require('node:assert');
const { resolveDest, upsertShipLines } = require('../src/core/shipments.js');

const dests = [
  { 配達先コード: 'P000095106', 名称: 'NTTロジスコ千葉センター', 別名: 'NTTロジスコ千葉|ロジスコ千葉' },
  { 配達先コード: 'P000100223', 名称: 'ベルーナ旧クリニック', 別名: '' },
];

test('dest: 名称・別名で引き当てる（空白と大文字小文字は無視）', () => {
  assert.deepStrictEqual(resolveDest('NTTロジスコ千葉', dests), { code: 'P000095106', flag: '' });
  assert.deepStrictEqual(resolveDest(' ロジスコ 千葉 ', dests), { code: 'P000095106', flag: '' });
  assert.deepStrictEqual(resolveDest('nttロジスコ千葉センター', dests), { code: 'P000095106', flag: '' });
  assert.deepStrictEqual(resolveDest('ベルーナ旧クリニック', dests), { code: 'P000100223', flag: '' });
});
test('dest: 空なら空、引き当てられなければ要確認にNXの書き方を残す', () => {
  assert.deepStrictEqual(resolveDest('', dests), { code: '', flag: '' });
  assert.deepStrictEqual(resolveDest('ベルーナ旧クリニックと\nロジスコ千葉', dests), { code: '', flag: '配達先不明: ベルーナ旧クリニックと ロジスコ千葉' });
});
test('dest: 出荷明細の配達先コードはマスタのコード', () => {
  const ids = new Map([['蛇口発|1', 'SH-2611-001']]);
  const p = (name) => ({ key: '蛇口発|1', コンテナNO: 'C1', コンテナタイプ: '40F', 配達予定日: null, 配達先名: name, 品目テキスト: 'x', items: [{ name: '白', qty: 1 }], 要確認: ['配達予定日なし'] });
  const r = upsertShipLines([], [p('ロジスコ千葉')], ids, dests);
  assert.strictEqual(r.inserts[0].配達先コード, 'P000095106');
  assert.strictEqual(r.inserts[0].要確認, '配達予定日なし');
  const r2 = upsertShipLines([], [p('未定')], ids, dests);
  assert.strictEqual(r2.inserts[0].配達先コード, '');
  assert.strictEqual(r2.inserts[0].要確認, '配達予定日なし / 配達先不明: 未定');
});

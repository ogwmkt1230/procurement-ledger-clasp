const test = require('node:test');
const assert = require('node:assert');
const { matchCandidates } = require('../src/core/shipments.js');

const suppliers = [{ 仕入先コード: 'S-MT', shipper別名: 'MITMES|Shenzhen Mtimes' }, { 仕入先コード: 'S-HI', shipper別名: 'Dongguan Hiee' }];
const items = [{ 商品コード: 'YTH-260WH', 品名: 'Yunth Boost MAX (WHITE)', 別名: '白ドライヤー|Boost MAX WHITE' }];
const line = (id, rem, extra) => ({ 明細ID: id, 仕入先コード: 'S-MT', 商品コード: 'YTH-260WH', 品名: 'Yunth Boost MAX (WHITE)', 納期予定月: '2026/12', 状態: '発注中', _rem: rem, ...extra });
const bl = ls => new Map(ls.map(l => [l.明細ID, { remaining: l._rem }]));

test('match: 仕入先・品名・数量すべて一致で100', () => {
  const ls = [line('A', 5000)];
  const c = matchCandidates({ name: '白ドライヤー', qty: 4800 }, 'MITMES', ls, bl(ls), suppliers, items);
  assert.strictEqual(c[0].明細ID, 'A');
  assert.strictEqual(c[0].score, 100);
});
test('match: 残数超過は90で理由つき', () => {
  const ls = [line('A', 3000)];
  const c = matchCandidates({ name: '白ドライヤー', qty: 4800 }, 'MITMES', ls, bl(ls), suppliers, items);
  assert.strictEqual(c[0].score, 90);
  assert.ok(c[0].reasons.includes('数量が残数超過'));
});
test('match: 仕入先が違えば候補なし', () => {
  const ls = [line('A', 5000)];
  assert.deepStrictEqual(matchCandidates({ name: '白ドライヤー', qty: 10 }, 'Dongguan Hiee Electronic', ls, bl(ls), suppliers, items), []);
});
test('match: 同品名2明細は納期の早い順', () => {
  const ls = [line('LATE', 5000, { 納期予定月: '2027/01' }), line('EARLY', 5000, { 納期予定月: '2026/12' })];
  const c = matchCandidates({ name: '白ドライヤー', qty: 4800 }, 'MITMES', ls, bl(ls), suppliers, items);
  assert.deepStrictEqual(c.map(x => x.明細ID), ['EARLY', 'LATE']);
});
test('match: 残数0・取消の明細は候補にしない', () => {
  const ls = [line('A', 0), line('B', 100, { 状態: '取消' })];
  assert.deepStrictEqual(matchCandidates({ name: '白ドライヤー', qty: 10 }, 'MITMES', ls, bl(ls), suppliers, items), []);
});

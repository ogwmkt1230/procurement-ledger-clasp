const test = require('node:test');
const assert = require('node:assert');
const fx = require('./fixtures/nx-sample.json');
const { parseNxSheet, parseItemText, parseLooseDate, parseStatusMemos } = require('../src/core/nxParse.js');
const ymd = d => d && `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

test('nx: 蛇口発は38便、釜山発は3便', () => {
  assert.strictEqual(parseNxSheet(fx['蛇口発'], '蛇口発').shipments.length, 38);
  assert.strictEqual(parseNxSheet(fx['釜山発'], '釜山発').shipments.length, 3);
});
test('nx: 最初の便は3コンテナ、続き行は同じ便', () => {
  const r = parseNxSheet(fx['蛇口発'], '蛇口発');
  const s1 = r.shipments[0];
  assert.strictEqual(s1['H B/L'], 'CANDMZ57065');
  assert.strictEqual(s1.key, '蛇口発|1');
  const conts = [...new Set(r.shipLines.filter(l => l.key === '蛇口発|1').map(l => l.コンテナNO))];
  assert.deepStrictEqual(conts, ['OERU4213169', 'OOLU6261502', 'OOLU6484300']);
  assert.strictEqual(ymd(s1.ETD), '2026-05-24');
});
test('nx: 品目テキスト基本', () => {
  const r = parseItemText('白ドライヤー：2400\nモカドライヤー：2200');
  assert.deepStrictEqual(r.items.map(i => [i.name, i.qty]), [['白ドライヤー', 2400], ['モカドライヤー', 2200]]);
});
test('nx: 区切りと全角のゆれ', () => {
  assert.strictEqual(parseItemText('ブルードライヤー；4800').items[0].qty, 4800);
  assert.strictEqual(parseItemText('青ブラシ；12800').items[0].qty, 12800);
  assert.strictEqual(parseItemText('ピンクブラシ： 5000').items[0].qty, 5000);
  assert.deepStrictEqual(parseItemText('ピンクドライヤー：2400\nブルードライヤー：240０').items.map(i => i.qty), [2400, 2400]);
  assert.strictEqual(parseItemText('黒ブラシ：10,000').items[0].qty, 10000);
  assert.strictEqual(parseItemText('ピンクリフト：5,000"').items[0].qty, 5000);
});
test('nx: 品名が数字だけの行は読めない扱い', () => {
  const r = parseItemText('＊VA：76,963\n40：21,542');
  assert.deepStrictEqual(r.items.map(i => [i.name, i.qty]), [['VA', 76963]]);
  assert.deepStrictEqual(r.unreadable, ['40：21,542']);
});
test('nx: 品目行のコンテナ番号', () => {
  const r = parseItemText('＊YMMU6593620\nリフトプロ：10,000\n黒リフト：2,880');
  assert.deepStrictEqual(r.items.map(i => i.container), ['YMMU6593620', 'YMMU6593620']);
  const r2 = parseItemText('ピンクリフト：11,520：FSCU8827226"\nTGBU2323986(20)：ピンクリフト：6,000');
  assert.deepStrictEqual(r2.items.map(i => [i.name, i.qty, i.container]), [['ピンクリフト', 11520, 'FSCU8827226'], ['ピンクリフト', 6000, 'TGBU2323986']]);
});
test('nx: 日付のゆれ', () => {
  assert.strictEqual(ymd(parseLooseDate(46183)), '2026-06-10');
  assert.strictEqual(ymd(parseLooseDate('2026/12/1(10t車)')), '2026-12-01');
  assert.strictEqual(ymd(parseLooseDate('12/7\n(10t車x2, 4t車x1)', 2026)), '2026-12-07');
  for (const v of ['未定', '', null]) assert.strictEqual(parseLooseDate(v, 2026), null);
});
test('nx: 釜山 SELDWB17811 の配達予定日', () => {
  const r = parseNxSheet(fx['釜山発'], '釜山発');
  const ls = r.shipLines.filter(l => l['H B/L'] === 'SELDWB17811');
  const first = ls.find(l => l.コンテナNO === 'BEAU6266253');
  assert.strictEqual(ymd(first.配達予定日), '2026-12-07');
  assert.ok(!first.要確認.includes('配達予定日なし'));
  const cont = ls.find(l => l.コンテナNO === 'CKSU4011577');
  assert.strictEqual(cont.配達予定日, null);
  assert.ok(cont.要確認.includes('配達予定日なし'));
});
test('nx: 品目なしの続き行は要確認', () => {
  const r = parseNxSheet(fx['蛇口発'], '蛇口発');
  const l = r.shipLines.find(x => x.コンテナNO === 'OOLU6324848');
  assert.ok(l.要確認.includes('品目なし'));
});
test('nx: H B/L未定の便も取り込む', () => {
  const r = parseNxSheet(fx['蛇口発'], '蛇口発');
  const s = r.shipments.find(x => x.key === '蛇口発|35');
  assert.strictEqual(s['H B/L'], '');
});
test('nx: ステータスメモ', () => {
  const s = parseStatusMemos(['6/8 輸入許可証済', '6/8 ロジスコ連絡済', '6/10 納品確認済'], 2026);
  assert.deepStrictEqual([ymd(s.輸入許可日), ymd(s.倉庫連絡日), ymd(s.納品確認日)], ['2026-06-08', '2026-06-08', '2026-06-10']);
  assert.strictEqual(parseStatusMemos(['6/10 輸入気箇所済'], 2026).輸入許可日, null);
});

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
  const r = parseItemText('12：345');
  assert.deepStrictEqual(r.items, []);
  assert.deepStrictEqual(r.unreadable, ['12：345']);
});
test('nx: 品目の下の「40：数量」「20：数量」はコンテナサイズ別の内訳', () => {
  const r = parseItemText('＊VA：76,963\n40：21,542\n40：22,285\n40：21,995\n20：11,141');
  assert.deepStrictEqual(r.unreadable, []);
  assert.deepStrictEqual(r.items.map(i => [i.name, i.qty]), [['VA', 76963]]);
  assert.deepStrictEqual(r.items[0].breakdown, [{ size: '40', qty: 21542 }, { size: '40', qty: 22285 }, { size: '40', qty: 21995 }, { size: '20', qty: 11141 }]);
});
test('nx: 釜山発|1 の内訳を便のコンテナにサイズ別・行順で割り当てる', () => {
  const r = parseNxSheet(fx['釜山発'], '釜山発');
  const ls = r.shipLines.filter(l => l.key === '釜山発|1');
  const got = ls.map(l => [l.コンテナNO, l.items.map(i => i.name + ':' + i.qty).join(','), l.要確認.join(' / ')]);
  assert.deepStrictEqual(got, [
    ['TEMU0319740', 'VA:11141', ''],
    ['BEAU6266000', 'VA:21542', ''],
    ['TEMU8547406', 'VA:22285', ''],
    ['FFAU5476461', 'VA:21995', ''],
  ]);
  assert.deepStrictEqual(r.warnings, []);
});
test('nx: 内訳がコンテナ数や合計と合わなければ割り当てず要確認', () => {
  const head = ['', 'shipper', 'INV NO', 'H B/L NO', 'M B/L NO', 'コンテナNO', 'コンテナタイプ', 'ETD', '配達予定日', '配達先', '対象商品'];
  const rows = [head,
    [1, 'iMINE', '', 'HB1', '', 'AAAU1111111', '20F DRY x 1', 46339, 46351, '', 'VA：100\n40：60\n40：40'],
    ['', '', '', '', '', 'BBBU2222222', '40F DRY', '', 46351, '', '']];
  const ls = parseNxSheet(rows, '釜山発').shipLines;
  const a = ls.find(l => l.コンテナNO === 'AAAU1111111');
  assert.deepStrictEqual(a.items.map(i => i.qty), [100]);
  assert.ok(a.要確認.some(f => f.startsWith('内訳を割り当てられない')));
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
test('nx: 便のどこかに品目があれば、品目の無いコンテナ行は要確認にしない', () => {
  const r = parseNxSheet(fx['蛇口発'], '蛇口発');
  const l = r.shipLines.find(x => x.コンテナNO === 'OOLU6324848');
  assert.deepStrictEqual(l.要確認, []);
  const all = r.shipLines.concat(parseNxSheet(fx['釜山発'], '釜山発').shipLines);
  assert.strictEqual(all.filter(x => x.要確認.includes('品目なし')).length, 0);
});
test('nx: 便に品目が1つも無ければ品目なし', () => {
  const head = ['', 'shipper', 'H B/L NO', 'コンテナNO', 'コンテナタイプ', 'ETD', '配達予定日', '対象商品'];
  const rows = [head,
    [1, 'MITMES', 'HB1', 'AAAU1111111', '40F DRY x 2', 46339, 46351, ''],
    ['', '', '', 'BBBU2222222', '', '', 46351, '']];
  const ls = parseNxSheet(rows, '蛇口発').shipLines;
  assert.deepStrictEqual(ls.map(l => l.要確認), [['品目なし'], ['品目なし']]);
});
test('nx: H B/L未定の便も取り込む', () => {
  const r = parseNxSheet(fx['蛇口発'], '蛇口発');
  const s = r.shipments.find(x => x.key === '蛇口発|35');
  assert.strictEqual(s['H B/L'], '');
});
test('nx: ステータスメモ', () => {
  const s = parseStatusMemos(['6/8 輸入許可証済', '6/8 ロジスコ連絡済', '6/10 納品確認済'], 2026);
  assert.deepStrictEqual([ymd(s.輸入許可日), ymd(s.倉庫連絡日), ymd(s.納品確認日)], ['2026-06-08', '2026-06-08', '2026-06-10']);
});
test('nx: キーワードの無いメモは列の位置で読む（1列目=輸入許可日）', () => {
  const s = parseStatusMemos(['6/10 輸入気箇所済', '6/10 ロジスコ連絡済', ''], 2026);
  assert.deepStrictEqual([ymd(s.輸入許可日), ymd(s.倉庫連絡日)], ['2026-06-10', '2026-06-10']);
  const t = parseStatusMemos(['', '7/31 輸入許可書', ''], 2026);
  assert.deepStrictEqual([ymd(t.輸入許可日), t.倉庫連絡日], ['2026-07-31', null]);
  const u = parseStatusMemos(['6/8 輸入許可済', '6/9', '済'], 2026);
  assert.deepStrictEqual([ymd(u.輸入許可日), ymd(u.倉庫連絡日), u.納品確認日], ['2026-06-08', '2026-06-09', null]);
});
test('nx: 蛇口発|5 の輸入許可日（打ち間違い）を拾う', () => {
  const s = parseNxSheet(fx['蛇口発'], '蛇口発').shipments.find(x => x.key === '蛇口発|5');
  assert.strictEqual(ymd(s.輸入許可日), '2026-06-10');
});

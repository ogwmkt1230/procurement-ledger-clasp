const test = require('node:test');
const assert = require('node:assert');
const fx = require('./fixtures/yomi-samples.json');
const { detectLayout, mapYomiRow, selectOpenRows, reconcileBrand } = require('../src/core/migrate.js');
const ctx = { ブランド: 'Yunth', 仕入先コード: 'S-IM' };

test('migrate: レイアウト判定', () => {
  assert.strictEqual(detectLayout(fx.toa.header), 'domestic');
  assert.strictEqual(detectLayout(fx.imine.header), 'overseas');
  assert.strictEqual(detectLayout(fx.mtimes.header), 'overseas');
  assert.strictEqual(detectLayout(fx.straine.header), 'straine');
});
test('migrate: IMINE VA行', () => {
  const m = mapYomiRow(fx.imine.rows[0], fx.imine.header, ctx);
  assert.strictEqual(m.line.数量, 150000);
  assert.strictEqual(m.line.通貨, '円');
  assert.ok(Math.abs(m.line.単価 - 413.6) < 1e-9);
  assert.strictEqual(m.line.稟議AP, 'AP10595');
  assert.strictEqual(m.line.納期予定月, '2026/12');
  assert.strictEqual(m.line.種別, '商品');
  assert.ok(m.warnings.includes('外貨単価は合計金額から逆算'));
  assert.deepStrictEqual(m.payments.map(p => p.区分), ['前金 26,400箱', '前金 50,563箱', '前金 68,253箱']);
  assert.strictEqual(m.payments[0].送金日.getMonth(), 10);
  assert.strictEqual(m.payments[0].送金日.getDate(), 4);
  assert.strictEqual(m.unreceived, 150000);
});
test('migrate: 開発費行は種別が開発費', () => {
  assert.strictEqual(mapYomiRow(fx.imine.rows[1], fx.imine.header, ctx).line.種別, '開発費');
});
test('migrate: 発注数のない古い行は未完了でない', () => {
  const m = [mapYomiRow(fx.toa.rows[0], fx.toa.header, ctx)];
  assert.strictEqual(selectOpenRows(m).length, 0);
});
test('migrate: 納品済の行は落ち、未納品の行は残る', () => {
  const m = fx.imine.rows.map(r => mapYomiRow(r, fx.imine.header, ctx));
  assert.deepStrictEqual(selectOpenRows(m).map(x => x.line.数量), [150000]);
});
test('migrate: 内容に「発注取消」の行は取消扱いで落ちる', () => {
  const m = mapYomiRow(fx.straine.rows[0], fx.straine.header, { ブランド: 'Straine', 仕入先コード: 'S-RL' });
  assert.strictEqual(m.line.状態, '取消');
  assert.strictEqual(selectOpenRows([m]).length, 0);
});
test('migrate: Straineは数量空で警告、落とさない', () => {
  const row = fx.straine.rows[0].slice(); row[7] = 'STPA シャントリ サシェ（7日間セット用）';
  const m = mapYomiRow(row, fx.straine.header, { ブランド: 'Straine', 仕入先コード: 'S-RL' });
  assert.strictEqual(m.line.数量, '');
  assert.ok(m.warnings.includes('発注数なし：注文書から復元が必要'));
  assert.strictEqual(m.line.種別, '販促物');
  assert.strictEqual(selectOpenRows([m]).length, 1);
});
test('migrate: 照合', () => {
  assert.deepStrictEqual(reconcileBrand(4784, 4784), { ok: true, diff: 0 });
  assert.deepStrictEqual(reconcileBrand(4784, 4700), { ok: false, diff: 84 });
});
test('migrate: 一部入荷済みの行は移行時点の入荷実績を1行持つ', () => {
  const row = fx.imine.rows[0].slice(); row[12] = '100,000'; row[13] = '50,000';
  const m = mapYomiRow(row, fx.imine.header, ctx);
  assert.strictEqual(m.openingReceipt.実績数, 100000);
  assert.strictEqual(mapYomiRow(fx.imine.rows[0], fx.imine.header, ctx).openingReceipt, null);
});

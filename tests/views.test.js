const test = require('node:test');
const assert = require('node:assert');
const { viewBacklogByMonth, viewReceiptPlan, viewMismatch, viewYomi, viewInTransit } = require('../src/core/views.js');
const { computeBacklog } = require('../src/core/backlog.js');

const L = (extra) => ({ 明細ID: 'A', 発注ID: 'PO-1', ブランド: 'Yunth', 仕入先コード: 'S-IM', 品名: 'VA', 商品コード: 'VA1', 種別: '商品', 会計区分: '商品原価', 通貨: 'ウォン', 単価: 940, 換算レート: 0.11, 数量: 150000, 納期予定月: '2026/12', 状態: '発注中', ...extra });

test('views: 発注残の円換算と固定資産の別行', () => {
  const lines = [L(), L({ 明細ID: 'M', 種別: '金型', 会計区分: '固定資産', 通貨: '円', 単価: 1000000, 数量: 1, 換算レート: '' })];
  const rec = [{ 明細ID: 'A', 実績数: 145216 }];
  const v = viewBacklogByMonth(lines, computeBacklog(lines, rec));
  const col = v.headers.indexOf('2026/12');
  const cogs = v.rows.find(r => r[0] === 'Yunth' && r[1] === '商品原価');
  const fa = v.rows.find(r => r[0] === 'Yunth' && r[1] === '固定資産');
  assert.strictEqual(cogs[col], 494666);
  assert.strictEqual(fa[col], 1000000);
});
test('views: 入荷予定は日付順で04と同じ先頭6列', () => {
  const lines = [L()];
  const rec = [{ 明細ID: 'A', 入荷予定日: new Date(2026, 11, 10), 予定数: 5, 実績数: '' }, { 明細ID: 'A', 入荷予定日: new Date(2026, 11, 1), 予定数: 7, 実績数: '' }, { 明細ID: 'A', 入荷予定日: new Date(2026, 10, 1), 予定数: 9, 実績数: 9 }];
  const v = viewReceiptPlan(rec, lines, []);
  assert.deepStrictEqual(v.headers.slice(0, 6), ['元々納品月', '実際納品月', '商品名', '商品コード', '入荷予定日', '入荷予定数']);
  assert.deepStrictEqual(v.rows.map(r => r[5]), [7, 5]);
});
test('views: 突合エラー 単価差', () => {
  const lines = [L({ 通貨: '円', 単価: 616, 数量: 100 })];
  const bad = [{ 入荷ID: 'R1', 明細ID: 'A', 実績数: 100, 納品書単価: 625, 納品書数量: 100 }];
  const ok = [{ 入荷ID: 'R1', 明細ID: 'A', 実績数: 100, 納品書単価: 616, 納品書数量: 100 }];
  assert.strictEqual(viewMismatch(lines, bad, [], computeBacklog(lines, bad), new Date()).rows.length, 1);
  assert.strictEqual(viewMismatch(lines, ok, [], computeBacklog(lines, ok), new Date()).rows.length, 0);
});
test('views: 突合エラー 14日以上未紐付', () => {
  const sl = [{ 出荷明細ID: 'X', 紐付状態: '未紐付', 配達予定日: new Date(2026, 10, 1) }];
  assert.strictEqual(viewMismatch([], [], sl, new Map(), new Date(2026, 10, 20)).rows.length, 1);
});
test('views: ヨミ表で残0・支払済は完了', () => {
  const lines = [L({ 数量: 10 })];
  const b = computeBacklog(lines, [{ 明細ID: 'A', 実績数: 10 }]);
  const v = viewYomi(lines, b, [{ 発注ID: 'PO-1', 区分: '前金', 送金日: new Date() }]);
  assert.strictEqual(v.rows[0][v.headers.indexOf('状態')], '完了');
});
test('views: 輸送中ビューに段階が出る', () => {
  const v = viewInTransit([{ 便ID: 'SH1', ETD: new Date(2026, 10, 20), ETA: new Date(2026, 10, 30) }], [], [], new Date(2026, 10, 26));
  assert.strictEqual(v.rows[0][v.headers.indexOf('段階')], '輸送中');
});
test('views: 外貨明細は単価差を出さない（通貨が違うため）', () => {
  const lines = [L()];
  const rec = [{ 入荷ID: 'R1', 明細ID: 'A', 実績数: 100, 納品書単価: 103, 納品書数量: 100 }];
  assert.strictEqual(viewMismatch(lines, rec, [], new Map(), new Date()).rows.length, 0);
});

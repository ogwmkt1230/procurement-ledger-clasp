const test = require('node:test');
const assert = require('node:assert');
const { buildReceiptPlans, shipmentStage } = require('../src/core/shipments.js');

const sl = (id, st, extra) => ({ 出荷明細ID: id, 便ID: 'SH1', 明細ID: 'L' + id, 数量: 100, 配達予定日: new Date(2026, 11, 7), 配達先コード: 'NTTロジスコ千葉', 紐付状態: st, ...extra });

test('receipts: 確定2本から2行、2回目は0行', () => {
  const r1 = buildReceiptPlans([sl('1', '確定'), sl('2', '確定')], [], []);
  assert.strictEqual(r1.length, 2);
  assert.deepStrictEqual([r1[0].明細ID, r1[0].便ID, r1[0].予定数, r1[0].納品場所], ['L1', 'SH1', 100, 'NTTロジスコ千葉']);
  assert.strictEqual(buildReceiptPlans([sl('1', '確定'), sl('2', '確定')], r1, []).length, 0);
});
test('receipts: 候補ありからは作らない', () => assert.strictEqual(buildReceiptPlans([sl('1', '候補あり')], [], []).length, 0));

const today = new Date(2026, 10, 26);
const ship = (extra) => ({ 便ID: 'SH1', ETD: new Date(2026, 10, 20), ETA: new Date(2026, 10, 30), 輸入許可日: '', 倉庫連絡日: '', ...extra });
test('stage: 出航前', () => assert.strictEqual(shipmentStage(ship({ ETD: new Date(2026, 10, 28) }), [], [], today), '出航前'));
test('stage: 輸送中', () => assert.strictEqual(shipmentStage(ship(), [], [], today), '輸送中'));
test('stage: 入港済', () => assert.strictEqual(shipmentStage(ship({ ETA: new Date(2026, 10, 25) }), [], [], today), '入港済'));
test('stage: 輸入許可済', () => assert.strictEqual(shipmentStage(ship({ ETA: new Date(2026, 10, 25), 輸入許可日: new Date(2026, 10, 25) }), [], [], today), '輸入許可済'));
test('stage: 倉庫連絡済', () => assert.strictEqual(shipmentStage(ship({ 輸入許可日: new Date(2026, 10, 25), 倉庫連絡日: new Date(2026, 10, 26) }), [], [], today), '倉庫連絡済'));
test('stage: 納品済', () => {
  const lines = [sl('1', '確定'), sl('2', '確定')];
  const rec = [{ 便ID: 'SH1', 明細ID: 'L1', 実績数: 100 }, { 便ID: 'SH1', 明細ID: 'L2', 実績数: 100 }];
  assert.strictEqual(shipmentStage(ship({ 倉庫連絡日: new Date(2026, 10, 26) }), lines, rec, today), '納品済');
  assert.strictEqual(shipmentStage(ship({ 倉庫連絡日: new Date(2026, 10, 26) }), lines, rec.slice(0, 1), today), '倉庫連絡済');
});

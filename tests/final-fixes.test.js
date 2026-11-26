const test = require('node:test');
const assert = require('node:assert');
const { upsertShipments, upsertShipLines, receiptPlanUpdates } = require('../src/core/shipments.js');
const { parseNxSheet } = require('../src/core/nxParse.js');
const { alreadyMigrated } = require('../src/core/migrate.js');

const now = new Date(2026, 10, 26);
const ids = new Map([['K', 'SH-2611-001']]);
const pl = (items, extra) => ({ key: 'K', コンテナNO: 'C1', コンテナタイプ: '40F', 配達予定日: new Date(2026, 11, 1), 配達先名: 'NTT', 品目テキスト: 'x', items, 要確認: [], ...extra });

test('fix1: 数量が変わった品目は新しい行でなく更新になる', () => {
  const ex = upsertShipLines([], [pl([{ name: 'VA', qty: 1000 }])], ids).inserts;
  const r = upsertShipLines(ex, [pl([{ name: 'VA', qty: 1200 }])], ids);
  assert.strictEqual(r.inserts.length, 0);
  assert.strictEqual(r.updates.length, 1);
  assert.strictEqual(r.updates[0].changes.数量, 1200);
  assert.strictEqual(r.updates[0].changes.品目テキスト, 'VA：1200');
});
test('fix1: 取り込んだ便から消えた品目はstaleとして返る', () => {
  const ex = upsertShipLines([], [pl([{ name: 'VA', qty: 1000 }, { name: 'AZ', qty: 5 }])], ids).inserts;
  const r = upsertShipLines(ex, [pl([{ name: 'VA', qty: 1000 }])], ids);
  assert.deepStrictEqual(r.stale.map(s => s.品目テキスト), ['AZ：5']);
});
test('fix2: 空欄の新しい値で既存の値を消さない', () => {
  const base = { key: 'K', 発地: '蛇口発', shipper: 'M', 'H B/L': 'H1', ETD: new Date(2026, 10, 1), ETA: new Date(2026, 10, 9), 輸入許可日: new Date(2026, 10, 10) };
  const ex = upsertShipments([], [base], now).inserts;
  const r = upsertShipments(ex, [{ ...base, 輸入許可日: null, 'H B/L': '' }], now);
  assert.strictEqual(r.updates.length, 0);
});
test('fix3: 確定済みの出荷明細の配達予定日・数量の変更が未入荷の入荷予定に反映される', () => {
  const sl = [{ 便ID: 'SH1', 明細ID: 'L1', 紐付状態: '確定', 配達予定日: new Date(2026, 11, 8), 数量: 120, 配達先コード: 'NTT' }];
  const rec = [{ 入荷ID: 'RC1', 便ID: 'SH1', 明細ID: 'L1', 入荷予定日: new Date(2026, 11, 1), 予定数: 100, 納品場所: 'NTT', 実績数: '' }];
  const u = receiptPlanUpdates(sl, rec);
  assert.deepStrictEqual(u, [{ idField: '入荷ID', id: 'RC1', changes: { 入荷予定日: new Date(2026, 11, 8), 予定数: 120 } }]);
  assert.deepStrictEqual(receiptPlanUpdates(sl, [{ ...rec[0], 実績数: 100 }]), []);
});
test('fix4: 年をまたぐM/Dは翌年になる', () => {
  const head = ['', 'shipper', '商品', 'INV NO', 'H B/L NO', 'M B/L NO', 'コンテナNO', 'コンテナタイプ', 'VESSEL', 'ETD', 'ETA', '配達予定日', '時間', '配達先', 'NX管理番号', '対象商品', 'AIメモ'];
  const row = [1, 'M', '', '', 'H1', '', 'ABCD1234567', '', '', '2026/12/26', '2027/01/02', '1/7\n(4t)', '', 'NTT', '', 'VA：10', '1/5 輸入許可済'];
  const r = parseNxSheet([head, row], '釜山発');
  assert.strictEqual(r.shipLines[0].配達予定日.getFullYear(), 2027);
  assert.strictEqual(r.shipments[0].輸入許可日.getFullYear(), 2027);
});
test('fix7: 移行済みブランドは検出される', () => {
  const rows = [{ ブランド: 'Yunth', メモ: '移行: 管理No.2' }, { ブランド: 'Brighte', メモ: '' }];
  assert.strictEqual(alreadyMigrated(rows, 'Yunth'), true);
  assert.strictEqual(alreadyMigrated(rows, 'Brighte'), false);
});

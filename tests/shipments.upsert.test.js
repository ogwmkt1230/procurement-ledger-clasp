const test = require('node:test');
const assert = require('node:assert');
const { upsertShipments, upsertShipLines, assignShipmentIds, shipmentFolderName } = require('../src/core/shipments.js');

const now = new Date(2026, 10, 26);
const ps = (extra) => ({ key: '蛇口発|1', 発地: '蛇口発', shipper: 'MITMES', 'INV NO': '', 'H B/L': 'CANDMZ57065', 'M B/L': 'OOLU1', VESSEL: 'V', ETD: new Date(2026, 4, 24), ETA: new Date(2026, 5, 5), NX管理番号: '1078533', 輸入許可日: null, 倉庫連絡日: null, ...extra });
const pl = (extra) => ({ key: '蛇口発|1', コンテナNO: 'OERU4213169', コンテナタイプ: '40F', 配達予定日: new Date(2026, 5, 10), 配達先名: 'NTTロジスコ千葉', 品目テキスト: 'x', items: [{ name: '白ドライヤー', qty: 2400 }, { name: 'モカドライヤー', qty: 2200 }], 要確認: [], ...extra });

function apply(existing, res) {
  const out = existing.map(r => ({ ...r }));
  res.updates.forEach(u => Object.assign(out.find(r => r[u.idField] === u.id), u.changes));
  return out.concat(res.inserts);
}

test('upsert: 同じ内容を2回取り込んでも増えない', () => {
  const r1 = upsertShipments([], [ps()], now);
  assert.strictEqual(r1.inserts.length, 1);
  assert.strictEqual(r1.inserts[0].便ID, 'SH-2611-001');
  const r2 = upsertShipments(r1.inserts, [ps()], now);
  assert.strictEqual(r2.inserts.length + r2.updates.length, 0);
});
test('upsert: ETAだけ変わればETAだけ更新', () => {
  const ex = upsertShipments([], [ps()], now).inserts;
  const r = upsertShipments(ex, [ps({ ETA: new Date(2026, 5, 9) })], now);
  assert.strictEqual(r.updates.length, 1);
  assert.deepStrictEqual(Object.keys(r.updates[0].changes), ['ETA']);
});
test('upsert: H B/Lが後から入った便は同じ便として更新', () => {
  const ex = upsertShipments([], [ps({ 'H B/L': '' })], now).inserts;
  const r = upsertShipments(ex, [ps()], now);
  assert.strictEqual(r.inserts.length, 0);
  assert.deepStrictEqual(r.updates[0].changes, { 'H B/L': 'CANDMZ57065' });
});
test('upsert: 手入力の便は触らない', () => {
  const manual = [{ 便ID: 'SH-2611-009', 取込元: '手入力', NX便キー: '', 'H B/L': 'CANDMZ57065' }];
  const r = upsertShipments(manual, [ps()], now);
  assert.strictEqual(r.updates.length, 0);
  assert.strictEqual(r.inserts[0].便ID, 'SH-2611-010');
});
test('upsertShipLines: 品目ごとに1行、再取り込みで増えない', () => {
  const ids = new Map([['蛇口発|1', 'SH-2611-001']]);
  const r1 = upsertShipLines([], [pl()], ids);
  assert.deepStrictEqual(r1.inserts.map(x => [x.品目テキスト, x.数量, x.紐付状態]), [['白ドライヤー：2400', 2400, '未紐付'], ['モカドライヤー：2200', 2200, '未紐付']]);
  assert.strictEqual(r1.inserts[0].出荷明細ID, 'SH-2611-001-01');
  const r2 = upsertShipLines(r1.inserts, [pl()], ids);
  assert.strictEqual(r2.inserts.length + r2.updates.length, 0);
});
test('upsertShipLines: 確定済みの明細IDと紐付状態は上書きしない', () => {
  const ids = new Map([['蛇口発|1', 'SH-2611-001']]);
  const ex = upsertShipLines([], [pl()], ids).inserts;
  ex[0].明細ID = 'PO-2605-001-01'; ex[0].紐付状態 = '確定';
  const r = upsertShipLines(ex, [pl({ 配達予定日: new Date(2026, 5, 12) })], ids);
  const ch = r.updates.find(u => u.id === ex[0].出荷明細ID).changes;
  assert.ok(!('明細ID' in ch) && !('紐付状態' in ch));
  assert.ok('配達予定日' in ch);
});
test('upsertShipLines: 品目なしの行は数量空・要確認つきで1行', () => {
  const ids = new Map([['蛇口発|1', 'SH-2611-001']]);
  const r = upsertShipLines([], [pl({ items: [], 品目テキスト: '', 要確認: ['品目なし'] })], ids);
  assert.strictEqual(r.inserts.length, 1);
  assert.strictEqual(r.inserts[0].数量, '');
  assert.strictEqual(r.inserts[0].要確認, '品目なし');
});
test('assignShipmentIds: 空の行だけに振る', () => {
  const out = assignShipmentIds([{ 便ID: '', ETD: new Date(2026, 10, 3) }, { 便ID: 'SH-2611-004' }], ['SH-2611-004']);
  assert.strictEqual(out[0].便ID, 'SH-2611-005');
  assert.strictEqual(out[0].取込元, '手入力');
  assert.strictEqual(out[1].便ID, 'SH-2611-004');
});
test('shipmentFolderName', () => assert.strictEqual(shipmentFolderName({ 便ID: 'SH-2611-001', shipper: 'MITMES', 'H B/L': 'CANDMZ57065' }), 'SH-2611-001_MITMES_CANDMZ57065'));

const test = require('node:test');
const assert = require('node:assert');
const fx = require('./fixtures/nx-sample.json');
const { parseNxSheet } = require('../src/core/nxParse.js');
const { upsertShipments, upsertShipLines, receiptPlanUpdates, buildReceiptPlans } = require('../src/core/shipments.js');
const { SHEETS, rowsToObjects, objectToRow } = require('../src/core/schema.js');

// 台帳への書き込みの最小モデル。書式が「自動」のセルに数字だけの文字列を書くと、Sheets は数値にする（'0012345' → 12345）。
// SHEETS[key].text の列は書式なしテキスト（@）にしてから書くので、文字のまま残る。
function sheetWrite(key, objs) {
  const text = SHEETS[key].text || [];
  const h = SHEETS[key].headers;
  return rowsToObjects(key, objs.map(o => objectToRow(key, o).map((v, i) =>
    typeof v === 'string' && /^\d+$/.test(v) && !text.includes(h[i]) ? Number(v) : v)));
}
function writeUpserts(key, rows, res) {
  const id = SHEETS[key].key;
  const changed = rows.map(r => {
    const u = res.updates.find(x => x.id === r[id]);
    return u ? sheetWrite(key, [Object.assign({}, r, u.changes)])[0] : r;
  });
  return changed.concat(sheetWrite(key, res.inserts));
}

/** importNxFile と同じく発地のシートごとに取り込む。これを2回して、2回目の件数とそのあとの台帳を返す。 */
function importTwice(book, dests) {
  const now = new Date(2026, 10, 27);
  const ledger = { ships: [], lines: [] };
  const once = () => {
    const n = { 追加: 0, 更新: 0, 消えた明細: 0 };
    Object.keys(book).forEach(origin => {
      const p = parseNxSheet(book[origin], origin);
      const su = upsertShipments(ledger.ships, p.shipments, now);
      ledger.ships = writeUpserts('shipments', ledger.ships, su);
      const ids = new Map(ledger.ships.filter(s => s.NX便キー).map(s => [s.NX便キー, s.便ID]));
      const lu = upsertShipLines(ledger.lines, p.shipLines, ids, dests);
      ledger.lines = writeUpserts('shipLines', ledger.lines, lu);
      n.追加 += su.inserts.length + lu.inserts.length;
      n.更新 += su.updates.length + lu.updates.length;
      n.消えた明細 += lu.stale.length;
    });
    return n;
  };
  once();
  return { second: once(), ledger };
}

test('reimport: 実データを同じまま2回取り込むと、2回目は追加0・更新0（関門1）', () => {
  const r = importTwice(fx, [{ 配達先コード: 'P000095106', 名称: 'NTTロジスコ千葉センター', 別名: 'NTTロジスコ千葉|ロジスコ千葉' }]);
  assert.deepStrictEqual(r.second, { 追加: 0, 更新: 0, 消えた明細: 0 });
  assert.strictEqual(r.ledger.ships.length, 41);
  // 文字として持つ列に、取り込みは文字列しか書かない（日付や数量の列を text に入れると崩れる）
  for (const [key, rows] of [['shipments', r.ledger.ships], ['shipLines', r.ledger.lines]]) {
    for (const h of SHEETS[key].text || []) for (const row of rows) assert.strictEqual(typeof row[h], 'string', key + '.' + h);
  }
});

test('reimport: 先頭ゼロや数字だけの値も文字のまま残り、再取り込みで更新にならない', () => {
  const book = JSON.parse(JSON.stringify(fx));
  const sheet = book['蛇口発'], h = sheet[1];
  const first = sheet[2], second = sheet[3]; // 蛇口発|1 の行と、その便の2本目のコンテナ行
  first[h.indexOf('INV NO')] = '0012345';
  first[h.indexOf('NX管理番号')] = '0078533';
  first[h.indexOf('H B/L NO')] = '0005706';
  first[h.indexOf('M B/L NO')] = '0023282003';
  second[h.indexOf('コンテナNO')] = '0061502';
  const r = importTwice(book, [{ 配達先コード: '0095106', 名称: 'NTTロジスコ千葉', 別名: '' }]);
  assert.deepStrictEqual(r.second, { 追加: 0, 更新: 0, 消えた明細: 0 });
  const s1 = r.ledger.ships.find(s => s.NX便キー === '蛇口発|1');
  assert.deepStrictEqual([s1['INV NO'], s1.NX管理番号, s1['H B/L'], s1['M B/L']], ['0012345', '0078533', '0005706', '0023282003']);
  const line = r.ledger.lines.find(l => l.コンテナNO === '0061502');
  assert.ok(line, 'コンテナNO 0061502 の出荷明細');
  assert.strictEqual(line.配達先コード, '0095106');
});

test('reimport: 入荷予定の納品場所（出荷明細の配達先コード）も文字のまま、再取り込みで更新にならない', () => {
  const line = { 便ID: 'SH-2611-001', 明細ID: 'PO-2605-001-01', 紐付状態: '確定', 配達予定日: new Date(2026, 5, 10), 数量: 2400, 配達先コード: '0095106' };
  const rec = sheetWrite('receipts', buildReceiptPlans([line], [], []).map(p => Object.assign(p, { 入荷ID: 'RC-2611-001' })));
  assert.strictEqual(rec[0].納品場所, '0095106');
  assert.deepStrictEqual(receiptPlanUpdates([line], rec), []);
});

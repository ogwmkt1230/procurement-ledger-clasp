function aliases_(s) { return String(s || '').split('|').map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean); }
function containsEither_(a, b) { a = a.toLowerCase(); b = b.toLowerCase(); return a.indexOf(b) >= 0 || b.indexOf(a) >= 0; }

/** 品目1つに対する明細候補（最大3件、score降順・納期の早い順）。 */
function matchCandidates(item, shipper, openLines, backlog, suppliers, items) {
  var sh = String(shipper || '').toLowerCase();
  var supplierCodes = suppliers.filter(function (s) {
    return aliases_(s.shipper別名).some(function (a) { return sh.indexOf(a) >= 0; });
  }).map(function (s) { return s.仕入先コード; });
  if (!supplierCodes.length) return [];
  var itemByCode = {};
  items.forEach(function (it) { itemByCode[it.商品コード] = it; });
  var out = [];
  openLines.forEach(function (l) {
    if (supplierCodes.indexOf(l.仕入先コード) < 0 || l.状態 === '取消') return;
    var b = backlog.get(l.明細ID);
    var rem = b ? b.remaining : 0;
    if (rem <= 0) return;
    var score = 50, reasons = ['仕入先一致'];
    var master = itemByCode[l.商品コード] || {};
    var names = [master.品名, l.品名].concat(aliases_(master.別名)).filter(Boolean);
    if (names.some(function (n) { return containsEither_(String(item.name), String(n)); })) { score += 40; reasons.push('品名一致'); }
    if (item.qty <= rem) { score += 10; reasons.push('数量が残数以内'); } else reasons.push('数量が残数超過');
    out.push({ 明細ID: l.明細ID, score: score, reasons: reasons, _due: String(l.納期予定月 || '') });
  });
  out.sort(function (a, b) { return b.score - a.score || (a._due < b._due ? -1 : a._due > b._due ? 1 : 0); });
  return out.slice(0, 3).map(function (c) { return { 明細ID: c.明細ID, score: c.score, reasons: c.reasons }; });
}

if (typeof module !== 'undefined') { var _ids2 = require('./ids.js'); var nextSerialId = _ids2.nextSerialId, lineId = _ids2.lineId; }

function same_(a, b) {
  var ea = a === null || a === undefined || a === '', eb = b === null || b === undefined || b === '';
  if (ea || eb) return ea && eb;
  if (a instanceof Date || b instanceof Date) return new Date(a).getTime() === new Date(b).getTime();
  return String(a) === String(b);
}
function diff_(oldRow, newVals) {
  var ch = {};
  Object.keys(newVals).forEach(function (k) { if (!same_(oldRow[k], newVals[k])) ch[k] = newVals[k]; });
  return ch;
}

var NX_SHIP_FIELDS_ = ['発地', 'shipper', 'INV NO', 'H B/L', 'M B/L', 'VESSEL', 'ETD', 'ETA', 'NX管理番号', '輸入許可日', '倉庫連絡日'];

/** NXの便をキー（発地|No.）で突き合わせる。手入力の便には触らない。 */
function upsertShipments(existing, parsed, now) {
  var byKey = {}, ids = existing.map(function (r) { return r.便ID; });
  existing.forEach(function (r) { if (r.NX便キー) byKey[r.NX便キー] = r; });
  var inserts = [], updates = [];
  parsed.forEach(function (p) {
    var vals = {};
    NX_SHIP_FIELDS_.forEach(function (f) { vals[f] = p[f] === undefined ? '' : p[f]; });
    var old = byKey[p.key];
    if (old) {
      var ch = diff_(old, vals);
      if (Object.keys(ch).length) updates.push({ idField: '便ID', id: old.便ID, changes: ch });
      return;
    }
    var id = nextSerialId('SH', now, ids);
    ids.push(id);
    var row = Object.assign({ 便ID: id, NX便キー: p.key, 取込元: 'NX', 取込日時: now }, vals);
    byKey[p.key] = row;
    inserts.push(row);
  });
  return { inserts: inserts, updates: updates };
}

/** 品目1つ＝出荷明細1行。確定済みの紐付は上書きしない。 */
function upsertShipLines(existing, parsed, shipIdByKey) {
  var byKey = {}, branch = {};
  var keyOf = function (shipId, cont, text, n) { return [shipId, cont, text, n].join('|'); };
  var seenEx = {};
  existing.forEach(function (r) {
    var k0 = [r.便ID, r.コンテナNO, r.品目テキスト].join('|');
    seenEx[k0] = (seenEx[k0] || 0) + 1;
    byKey[keyOf(r.便ID, r.コンテナNO, r.品目テキスト, seenEx[k0])] = r;
    var b = parseInt(String(r.出荷明細ID).slice(-2), 10);
    branch[r.便ID] = Math.max(branch[r.便ID] || 0, b || 0);
  });
  var inserts = [], updates = [], seen = {};
  parsed.forEach(function (p) {
    var shipId = shipIdByKey.get(p.key);
    if (!shipId) return;
    var entries = p.items.length ? p.items.map(function (it) { return { text: it.name + '：' + it.qty, qty: it.qty }; }) : [{ text: p.品目テキスト ? '（読めない）' + p.品目テキスト : '', qty: '' }];
    entries.forEach(function (e) {
      var k0 = [shipId, p.コンテナNO, e.text].join('|');
      seen[k0] = (seen[k0] || 0) + 1;
      var vals = { コンテナタイプ: p.コンテナタイプ, 数量: e.qty, 配達予定日: p.配達予定日 || '', 配達先コード: p.配達先名, 要確認: (p.要確認 || []).join(' / ') };
      var old = byKey[keyOf(shipId, p.コンテナNO, e.text, seen[k0])];
      if (old) {
        var ch = diff_(old, vals);
        if (Object.keys(ch).length) updates.push({ idField: '出荷明細ID', id: old.出荷明細ID, changes: ch });
        return;
      }
      branch[shipId] = (branch[shipId] || 0) + 1;
      inserts.push(Object.assign({ 出荷明細ID: lineId(shipId, branch[shipId]), 便ID: shipId, コンテナNO: p.コンテナNO, 品目テキスト: e.text, 明細ID: '', 紐付状態: '未紐付', 候補: '', _item: { name: e.text.split('：')[0], qty: e.qty } }, vals));
    });
  });
  inserts.forEach(function (r) { Object.defineProperty(r, '_item', { enumerable: false, value: r._item, writable: true }); });
  return { inserts: inserts, updates: updates };
}

/** 手入力の便で便IDが空の行に採番する。 */
function assignShipmentIds(rows, existingIds) {
  var ids = (existingIds || []).slice();
  return rows.map(function (r) {
    if (r.便ID) return r;
    var d = r.ETD instanceof Date ? r.ETD : new Date();
    var id = nextSerialId('SH', d, ids);
    ids.push(id);
    return Object.assign({}, r, { 便ID: id, 取込元: r.取込元 || '手入力' });
  });
}

function shipmentFolderName(s) {
  return [s.便ID, s.shipper, s['H B/L'] || s['M B/L'] || 'BL未定'].map(function (x) { return String(x || '').trim().replace(/[\\/:*?"<>|]/g, '_'); }).join('_');
}

if (typeof module !== 'undefined') module.exports = { matchCandidates: matchCandidates, upsertShipments: upsertShipments, upsertShipLines: upsertShipLines, assignShipmentIds: assignShipmentIds, shipmentFolderName: shipmentFolderName };

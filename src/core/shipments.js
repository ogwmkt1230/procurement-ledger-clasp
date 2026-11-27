function aliases_(s) { return String(s || '').split('|').map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean); }
function normDest_(s) { return String(s || '').replace(/\s+/g, '').toLowerCase(); }

/** NXの配達先の書き方 → 配達先マスタのコード（名称か別名に一致）。引き当てられなければ要確認の文言を返す。 */
function resolveDest(name, dests) {
  var n = normDest_(name);
  if (!n) return { code: '', flag: '' };
  var hit = (dests || []).filter(function (d) {
    return [d.名称].concat(String(d.別名 || '').split('|')).some(function (a) { return normDest_(a) && normDest_(a) === n; });
  })[0];
  return hit ? { code: String(hit.配達先コード), flag: '' } : { code: '', flag: '配達先不明: ' + String(name).replace(/\s*\n\s*/g, ' ').trim() };
}
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
function blank_(v) { return v === null || v === undefined || v === ''; }
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
      Object.keys(ch).forEach(function (k) { if (blank_(ch[k]) && !blank_(old[k])) delete ch[k]; });
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

/** 品目1つ＝出荷明細1行。キーは 便ID|コンテナ|品名|出現順（数量は含めない）。確定済みの紐付は上書きしない。 */
function itemNameOf_(text) {
  var t = String(text || '');
  if (t.indexOf('（読めない）') === 0 || t.indexOf('：') < 0) return t;
  return t.slice(0, t.lastIndexOf('：'));
}
function upsertShipLines(existing, parsed, shipIdByKey, dests) {
  var byKey = {}, branch = {}, cnt = {};
  var keyOf = function (shipId, cont, name, n) { return [shipId, cont, name, n].join('|'); };
  existing.forEach(function (r) {
    var k0 = [r.便ID, r.コンテナNO, itemNameOf_(r.品目テキスト)].join('|');
    cnt[k0] = (cnt[k0] || 0) + 1;
    byKey[k0 + '|' + cnt[k0]] = r;
    var b = parseInt(String(r.出荷明細ID).slice(-2), 10);
    branch[r.便ID] = Math.max(branch[r.便ID] || 0, b || 0);
  });
  var inserts = [], updates = [], seen = {}, matched = {}, touchedShips = {};
  parsed.forEach(function (p) {
    var shipId = shipIdByKey.get(p.key);
    if (!shipId) return;
    touchedShips[shipId] = true;
    var entries = p.items.length ? p.items.map(function (it) { return { name: it.name, text: it.name + '：' + it.qty, qty: it.qty }; })
      : [{ name: p.品目テキスト ? '（読めない）' + p.品目テキスト : '', text: p.品目テキスト ? '（読めない）' + p.品目テキスト : '', qty: '' }];
    entries.forEach(function (e) {
      var k0 = [shipId, p.コンテナNO, e.name].join('|');
      seen[k0] = (seen[k0] || 0) + 1;
      var dest = dests ? resolveDest(p.配達先名, dests) : { code: p.配達先名, flag: '' };
      var vals = { 品目テキスト: e.text, コンテナタイプ: p.コンテナタイプ, 数量: e.qty, 配達予定日: p.配達予定日 || '', 配達先コード: dest.code,
        要確認: (p.要確認 || []).concat(dest.flag ? [dest.flag] : []).join(' / ') };
      var old = byKey[k0 + '|' + seen[k0]];
      if (old) {
        matched[old.出荷明細ID] = true;
        var ch = diff_(old, vals);
        if (Object.keys(ch).length) updates.push({ idField: '出荷明細ID', id: old.出荷明細ID, changes: ch });
        return;
      }
      branch[shipId] = (branch[shipId] || 0) + 1;
      var row = Object.assign({ 出荷明細ID: lineId(shipId, branch[shipId]), 便ID: shipId, コンテナNO: p.コンテナNO, 明細ID: '', 紐付状態: '未紐付', 候補: '' }, vals);
      Object.defineProperty(row, '_item', { enumerable: false, writable: true, value: { name: e.name, qty: e.qty } });
      inserts.push(row);
    });
  });
  var stale = existing.filter(function (r) { return touchedShips[r.便ID] && !matched[r.出荷明細ID]; });
  return { inserts: inserts, updates: updates, stale: stale };
}

/** 確定済み出荷明細の変更（日付・数量・場所）を、まだ入荷していない入荷予定に反映する。 */
function receiptPlanUpdates(shipLines, receipts) {
  var byKey = {};
  shipLines.forEach(function (s) { if (s.紐付状態 === '確定' && s.明細ID) byKey[s.便ID + '|' + s.明細ID] = s; });
  var out = [];
  receipts.forEach(function (r) {
    if (!r.便ID || (r.実績数 !== '' && r.実績数 !== null && r.実績数 !== undefined)) return;
    var s = byKey[r.便ID + '|' + r.明細ID];
    if (!s) return;
    var ch = diff_(r, { 入荷予定日: s.配達予定日 || '', 予定数: s.数量, 納品場所: s.配達先コード });
    if (Object.keys(ch).length) out.push({ idField: '入荷ID', id: r.入荷ID, changes: ch });
  });
  return out;
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

/** 確定済み出荷明細から、まだ無い入荷予定行を作る。 */
function buildReceiptPlans(shipLines, receipts, lines) {
  var have = {};
  receipts.forEach(function (r) { if (r.便ID) have[r.便ID + '|' + r.明細ID] = true; });
  var out = [];
  shipLines.forEach(function (s) {
    if (s.紐付状態 !== '確定' || !s.明細ID) return;
    var k = s.便ID + '|' + s.明細ID;
    if (have[k]) return;
    have[k] = true;
    out.push({ 入荷ID: '', 明細ID: s.明細ID, 便ID: s.便ID, 入荷予定日: s.配達予定日 || '', 予定数: s.数量, 納品場所: s.配達先コード });
  });
  return out;
}

function dt_(v) { if (!v) return null; var d = v instanceof Date ? v : new Date(v); return isNaN(d.getTime()) ? null : d; }

function shipmentStage(ship, shipLines, receipts, today) {
  var mine = shipLines.filter(function (l) { return l.便ID === ship.便ID && l.紐付状態 === '確定'; });
  if (mine.length) {
    var got = {};
    receipts.forEach(function (r) { if (r.便ID === ship.便ID && r.実績数 !== '' && r.実績数 !== null && r.実績数 !== undefined) got[r.明細ID] = true; });
    if (mine.every(function (l) { return got[l.明細ID]; })) return '納品済';
  }
  if (dt_(ship.倉庫連絡日)) return '倉庫連絡済';
  if (dt_(ship.輸入許可日)) return '輸入許可済';
  var etd = dt_(ship.ETD), eta = dt_(ship.ETA);
  if (eta && eta <= today) return '入港済';
  if (etd && etd <= today) return '輸送中';
  return '出航前';
}

if (typeof module !== 'undefined') module.exports = { resolveDest: resolveDest, receiptPlanUpdates: receiptPlanUpdates, buildReceiptPlans: buildReceiptPlans, shipmentStage: shipmentStage, matchCandidates: matchCandidates, upsertShipments: upsertShipments, upsertShipLines: upsertShipLines, assignShipmentIds: assignShipmentIds, shipmentFolderName: shipmentFolderName };

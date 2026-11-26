if (typeof module !== 'undefined') { var _ids = require('./ids.js'); var nextSerialId = _ids.nextSerialId, lineId = _ids.lineId; }

function toDate_(v) {
  if (v instanceof Date) return v;
  if (v === '' || v === null || v === undefined) return null;
  var d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}
function ymd_(d) {
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
function num_(v) {
  if (typeof v === 'number') return v;
  if (v === '' || v === null || v === undefined) return NaN;
  return Number(String(v).replace(/,/g, ''));
}

function orderGroupKey(row) {
  var d = toDate_(row.発注日);
  return [row.仕入先コード, d ? ymd_(d) : '', row.稟議AP || ''].join('|');
}

/** 明細ID・発注IDが空の行にだけIDを振る。同じキーの行は同じ発注ID。 */
function assignOrderIds(rows, existingOrderIds) {
  var orderIds = (existingOrderIds || []).slice();
  var keyToOrder = {};
  var maxBranch = {};
  rows.forEach(function (r) {
    if (!r.発注ID) return;
    if (orderIds.indexOf(r.発注ID) < 0) orderIds.push(r.発注ID);
    keyToOrder[orderGroupKey(r)] = keyToOrder[orderGroupKey(r)] || r.発注ID;
    if (r.明細ID) {
      var b = parseInt(String(r.明細ID).slice(-2), 10);
      maxBranch[r.発注ID] = Math.max(maxBranch[r.発注ID] || 0, b);
    }
  });
  return rows.map(function (r) {
    if (r.明細ID && r.発注ID) return r;
    var out = Object.assign({}, r);
    var key = orderGroupKey(r);
    var oid = keyToOrder[key];
    if (!oid) {
      oid = nextSerialId('PO', toDate_(r.発注日) || new Date(), orderIds);
      orderIds.push(oid);
      keyToOrder[key] = oid;
    }
    var b = (maxBranch[oid] || 0) + 1;
    maxBranch[oid] = b;
    out.発注ID = oid;
    out.明細ID = lineId(oid, b);
    return out;
  });
}

/** 円金額。外貨でレートが無ければ null（0にしない）。 */
function lineAmountJpy(row) {
  var price = num_(row.単価), qty = num_(row.数量);
  if (isNaN(price) || isNaN(qty)) return null;
  var rate = row.通貨 === '円' || !row.通貨 ? 1 : num_(row.換算レート);
  if (isNaN(rate) || rate <= 0) return null;
  var per = num_(row.入数);
  var unit = !isNaN(per) && per > 0 ? price / per : price;
  return Math.round(unit * qty * rate);
}

function accountingClass(kind, kindMaster) {
  for (var i = 0; i < (kindMaster || []).length; i++) if (kindMaster[i].種別 === kind) return kindMaster[i].会計区分;
  return '要確認';
}

function validateInputRow(row) {
  var msgs = [];
  ['ブランド', '仕入先コード', '種別', '発注日'].forEach(function (h) {
    if (row[h] === '' || row[h] === null || row[h] === undefined) msgs.push('必須項目未入力: ' + h);
  });
  var q = num_(row.数量);
  if (isNaN(q) || q <= 0) msgs.push('数量不正');
  if (row.通貨 && row.通貨 !== '円') {
    var r = num_(row.換算レート);
    if (isNaN(r) || r <= 0) msgs.push('換算レート未入力');
  }
  return msgs;
}

function toOrderRecords(rows) {
  var seen = {}, out = [];
  rows.forEach(function (r) {
    if (!r.発注ID || seen[r.発注ID]) return;
    seen[r.発注ID] = true;
    out.push({ 発注ID: r.発注ID, ブランド: r.ブランド, 仕入先コード: r.仕入先コード, 発注日: r.発注日, 稟議AP: r.稟議AP, 通貨: r.通貨, 換算レート: r.換算レート, 支払条件: r.支払条件 });
  });
  return out;
}

if (typeof module !== 'undefined') module.exports = { orderGroupKey: orderGroupKey, assignOrderIds: assignOrderIds, lineAmountJpy: lineAmountJpy, accountingClass: accountingClass, validateInputRow: validateInputRow, toOrderRecords: toOrderRecords, toDate_: toDate_, ymd_: ymd_, num_: num_ };

function n_(v) {
  if (typeof v === 'number') return v;
  if (v === '' || v === null || v === undefined) return NaN;
  return Number(String(v).replace(/,/g, ''));
}

/** 明細ごとの発注数・入荷済・残数・エラー。残数は0未満にしない。 */
function computeBacklog(lines, receipts) {
  var got = {};
  receipts.forEach(function (r) {
    var q = n_(r.実績数);
    if (isNaN(q)) return;
    got[r.明細ID] = (got[r.明細ID] || 0) + q;
  });
  var m = new Map();
  lines.forEach(function (l) {
    var ordered = n_(l.数量) || 0, received = got[l.明細ID] || 0, errors = [];
    var remaining = Math.max(0, ordered - received);
    if (l.状態 === '取消') {
      remaining = 0;
      if (received > 0) errors.push('取消後入荷');
    } else if (received > ordered) errors.push('過納');
    m.set(l.明細ID, { ordered: ordered, received: received, remaining: remaining, errors: errors });
  });
  return m;
}

/** 確定済み出荷明細の、まだ倉庫に入っていない数。 */
function computeInTransit(shipLines, receipts) {
  var got = {};
  receipts.forEach(function (r) {
    var q = n_(r.実績数);
    if (isNaN(q) || !r.便ID) return;
    var k = r.便ID + '|' + r.明細ID;
    got[k] = (got[k] || 0) + q;
  });
  var m = new Map();
  shipLines.forEach(function (s) {
    if (s.紐付状態 !== '確定') return;
    var k = s.便ID + '|' + s.明細ID;
    var q = n_(s.数量) || 0;
    var take = Math.min(q, got[k] || 0);
    got[k] = (got[k] || 0) - take;
    m.set(s.出荷明細ID, q - take);
  });
  return m;
}

function isLineOpen(line, backlogEntry, payments) {
  if (line.状態 === '取消') return false;
  if (backlogEntry && backlogEntry.remaining > 0) return true;
  return (payments || []).some(function (p) {
    var mine = p.明細ID ? p.明細ID === line.明細ID : p.発注ID === line.発注ID;
    return mine && !p.送金日;
  });
}

if (typeof module !== 'undefined') module.exports = { computeBacklog: computeBacklog, computeInTransit: computeInTransit, isLineOpen: isLineOpen };

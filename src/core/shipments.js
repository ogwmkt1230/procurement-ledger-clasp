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

if (typeof module !== 'undefined') module.exports = { matchCandidates: matchCandidates };

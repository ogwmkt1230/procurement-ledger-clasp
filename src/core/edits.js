if (typeof module !== 'undefined') { var _orders = require('./orders.js'); var assignOrderIds = _orders.assignOrderIds, toOrderRecords = _orders.toOrderRecords; }

/** 編集範囲のうち、データ行（見出しの下の2行目以降）の部分。データ行にかからなければ null。 */
function dataRowSpan(row, numRows) {
  var first = Math.max(row, 2), last = row + numRows - 1;
  return last >= first ? { startRow: first, numRows: last - first + 1 } : null;
}

/**
 * 後回しにした編集範囲 {sheet, startRow, numRows} を、シートごとに重なる・隣り合うものでまとめる。
 * 壊れた要素（見出し行・行数0・整数でない・シート名なし）は捨てる。シートは最初に出た順、シートの中は開始行の順。
 */
function mergeEditSpans(spans) {
  var sheets = [], rangesBySheet = {};
  spans.forEach(function (s) {
    if (!s || typeof s.sheet !== 'string' || s.sheet === '') return;
    if (!Number.isInteger(s.startRow) || s.startRow < 2 || !Number.isInteger(s.numRows) || s.numRows < 1) return;
    if (!rangesBySheet[s.sheet]) { rangesBySheet[s.sheet] = []; sheets.push(s.sheet); }
    rangesBySheet[s.sheet].push([s.startRow, s.startRow + s.numRows - 1]);
  });
  var out = [];
  sheets.forEach(function (sheet) {
    var merged = [];
    rangesBySheet[sheet].sort(function (a, b) { return a[0] - b[0]; }).forEach(function (r) {
      var prev = merged[merged.length - 1];
      if (prev && r[0] <= prev[1] + 1) prev[1] = Math.max(prev[1], r[1]);
      else merged.push([r[0], r[1]]);
    });
    merged.forEach(function (r) { out.push({ sheet: sheet, startRow: r[0], numRows: r[1] - r[0] + 1 }); });
  });
  return out;
}

/** 発注明細入力の「中身のある行」：ブランド・仕入先コード・品名のどれかがある。 */
function hasInputContent(r) {
  return !!(r.ブランド || r.仕入先コード || r.品名);
}

/**
 * 発注明細入力の編集範囲 [first, last)（all の添字）に発注ID・明細IDを振る。
 * 返り値の rows は範囲の行（同じ並び）、orders は「発注」シートに書く発注。
 * - IDを振り、発注の元にするのは中身のある行だけ。中身のない行（空行・中身を消してIDだけ残った行）は読んだまま返す
 * - 番号の基準には、範囲の内外・中身の有無を問わず IDのある行をすべて入れる（中身を消した行の枝番を使い回さない）
 * - 範囲外のIDのない行は基準に入れない（その行のぶん番号を空けない）
 */
function assignInputRangeIds(all, first, last, existingOrderIds) {
  var base = all.filter(function (r, i) { return (r.発注ID || r.明細ID) && (i < first || i >= last || !hasInputContent(r)); });
  var range = all.slice(first, last);
  var done = assignOrderIds(base.concat(range.filter(hasInputContent)), existingOrderIds).slice(base.length);
  var k = 0;
  var rows = range.map(function (r) { return hasInputContent(r) ? done[k++] : r; });
  return { rows: rows, orders: toOrderRecords(rows.filter(hasInputContent)) };
}

if (typeof module !== 'undefined') module.exports = { dataRowSpan: dataRowSpan, mergeEditSpans: mergeEditSpans, hasInputContent: hasInputContent, assignInputRangeIds: assignInputRangeIds };

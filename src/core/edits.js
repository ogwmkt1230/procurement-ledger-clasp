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

if (typeof module !== 'undefined') module.exports = { dataRowSpan: dataRowSpan, mergeEditSpans: mergeEditSpans };

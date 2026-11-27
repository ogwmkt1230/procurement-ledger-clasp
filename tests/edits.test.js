const test = require('node:test');
const assert = require('node:assert');
const { dataRowSpan, mergeEditSpans } = require('../src/core/edits.js');

test('edits: 見出し行から始まる範囲は、データ行（2行目以降）の部分を返す', () => {
  const cases = [
    [[1, 5], { startRow: 2, numRows: 4 }],
    [[1, 2], { startRow: 2, numRows: 1 }],
    [[1, 20000], { startRow: 2, numRows: 19999 }], // 列見出しを選んで列ごと削除・貼り付け
  ];
  for (const [[row, n], want] of cases) assert.deepStrictEqual(dataRowSpan(row, n), want, `${row}行目から${n}行`);
});
test('edits: データ行だけの範囲はそのまま返す', () => {
  assert.deepStrictEqual(dataRowSpan(2, 1), { startRow: 2, numRows: 1 });
  assert.deepStrictEqual(dataRowSpan(7, 3), { startRow: 7, numRows: 3 });
});
test('edits: データ行にかからない範囲は null', () => {
  assert.strictEqual(dataRowSpan(1, 1), null); // 見出し行だけ
  assert.strictEqual(dataRowSpan(1, 0), null);
  assert.strictEqual(dataRowSpan(5, 0), null);
});

const at = '2026-11-27T08:00:00.000Z';
test('edits: 同じシートの重なる・隣り合う範囲は1つにまとめる', () => {
  // 2-4行 と 5-6行（隣り合う）→ 2-6行
  assert.deepStrictEqual(mergeEditSpans([{ sheet: '発注明細入力', startRow: 5, numRows: 2, at }, { sheet: '発注明細入力', startRow: 2, numRows: 3, at }]),
    [{ sheet: '発注明細入力', startRow: 2, numRows: 5 }]);
  // 2-4行 と 3-6行（重なる）→ 2-6行
  assert.deepStrictEqual(mergeEditSpans([{ sheet: '発注明細入力', startRow: 2, numRows: 3, at }, { sheet: '発注明細入力', startRow: 3, numRows: 4, at }]),
    [{ sheet: '発注明細入力', startRow: 2, numRows: 5 }]);
});
test('edits: 内側に含まれる範囲は外側の範囲に吸収される', () => {
  // 2-11行 と 4-5行 → 2-11行
  assert.deepStrictEqual(mergeEditSpans([{ sheet: '便', startRow: 2, numRows: 10, at }, { sheet: '便', startRow: 4, numRows: 2, at }]),
    [{ sheet: '便', startRow: 2, numRows: 10 }]);
});
test('edits: 間が1行でも空いている範囲は分けたまま、開始行の順に並べる', () => {
  assert.deepStrictEqual(mergeEditSpans([{ sheet: '便', startRow: 4, numRows: 1, at }, { sheet: '便', startRow: 2, numRows: 1, at }]),
    [{ sheet: '便', startRow: 2, numRows: 1 }, { sheet: '便', startRow: 4, numRows: 1 }]);
});
test('edits: シートが違う範囲はまとめず、シートは最初に出た順', () => {
  // 名前の順（出 < 発）とは逆に、先に出た 発注明細入力 が先
  assert.deepStrictEqual(mergeEditSpans([
    { sheet: '発注明細入力', startRow: 2, numRows: 1, at },
    { sheet: '出荷明細', startRow: 2, numRows: 1, at },
    { sheet: '発注明細入力', startRow: 3, numRows: 1, at },
  ]), [{ sheet: '発注明細入力', startRow: 2, numRows: 2 }, { sheet: '出荷明細', startRow: 2, numRows: 1 }]);
});
test('edits: 壊れた要素（見出し行・行数0・数値でない・シート名なし）は捨てる', () => {
  assert.deepStrictEqual(mergeEditSpans([
    null,
    {},
    { sheet: '', startRow: 2, numRows: 1 },
    { sheet: '便', startRow: 1, numRows: 3 },
    { sheet: '便', startRow: 2, numRows: 0 },
    { sheet: '便', startRow: '2', numRows: 1 },
    { sheet: '便', startRow: 2.5, numRows: 1 },
    { sheet: '便', startRow: 5, numRows: 1, at },
  ]), [{ sheet: '便', startRow: 5, numRows: 1 }]);
  assert.deepStrictEqual(mergeEditSpans([]), []);
});

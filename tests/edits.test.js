const test = require('node:test');
const assert = require('node:assert');
const { dataRowSpan, mergeEditSpans, hasInputContent, assignInputRangeIds } = require('../src/core/edits.js');
const { SHEETS } = require('../src/core/schema.js');

// 発注明細入力の1行（readObjects_ と同じく、全列があり空欄は ''）
const inputRow = o => ({ ...Object.fromEntries(SHEETS.input.headers.map(h => [h, ''])), ...o });
const d = new Date(2026, 10, 20);
const S0 = { ブランド: 'Yunth', 仕入先コード: 'S0', 発注日: d, 稟議AP: 'AP1', 通貨: '円' };
const ids = rows => rows.map(r => [r.発注ID, r.明細ID]);
const orderSuppliers = orders => orders.map(o => [o.発注ID, o.仕入先コード]);

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
test('edits: シートが交互に出ても、シートは最初に出た順、シートの中は開始行の順にまとめる', () => {
  // 名前の順（出 < 発）とは逆に、先に出た 発注明細入力 が先。発注明細入力は 5-6 と 2-4 が逆順で来る
  assert.deepStrictEqual(mergeEditSpans([
    { sheet: '発注明細入力', startRow: 5, numRows: 2, at },
    { sheet: '出荷明細', startRow: 2, numRows: 2, at },
    { sheet: '発注明細入力', startRow: 2, numRows: 3, at },
  ]), [{ sheet: '発注明細入力', startRow: 2, numRows: 5 }, { sheet: '出荷明細', startRow: 2, numRows: 2 }]);
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

test('edits: 発注明細入力の中身は、ブランド・仕入先コード・品名のどれか（数量やメモだけでは中身としない）', () => {
  assert.strictEqual(hasInputContent(inputRow({ ブランド: 'Yunth' })), true);
  assert.strictEqual(hasInputContent(inputRow({ 仕入先コード: 'S0' })), true);
  assert.strictEqual(hasInputContent(inputRow({ 品名: 'VA' })), true);
  assert.strictEqual(hasInputContent(inputRow({ 数量: 5, メモ: 'm', 明細ID: 'PO-2611-001-01', 発注ID: 'PO-2611-001' })), false);
});
test('edits: 範囲内の空行にはIDを振らず、空の発注も作らない（列ごとの編集）', () => {
  const all = [
    inputRow({ ...S0, 明細ID: 'PO-2611-001-01', 発注ID: 'PO-2611-001', 品名: 'VA' }),
    inputRow({}),
    inputRow({ ...S0, 仕入先コード: 'S1', 品名: 'AZ' }),
  ];
  const r = assignInputRangeIds(all, 0, 3, ['PO-2611-001']);
  assert.deepStrictEqual(ids(r.rows), [['PO-2611-001', 'PO-2611-001-01'], ['', ''], ['PO-2611-002', 'PO-2611-002-01']]);
  assert.deepStrictEqual(orderSuppliers(r.orders), [['PO-2611-001', 'S0'], ['PO-2611-002', 'S1']]);
});
test('edits: 中身を消してIDだけ残った行は、発注の元にせず、その枝番も使わない', () => {
  const all = [
    inputRow({ ...S0, 明細ID: 'PO-2611-001-01', 発注ID: 'PO-2611-001', 品名: 'VA' }),
    inputRow({ ...S0, 明細ID: 'PO-2611-001-02', 発注ID: 'PO-2611-001', 品名: 'AZ' }),
    inputRow({ 明細ID: 'PO-2611-001-03', 発注ID: 'PO-2611-001' }), // 中身を消した（ID列は保護されていて消せない）
    inputRow({ ...S0, 品名: 'CC' }),                                 // 同じ仕入先・日・APの新しい行
  ];
  const r = assignInputRangeIds(all, 2, 4, ['PO-2611-001']); // 中身を消した行から2行の貼り付け
  assert.deepStrictEqual(ids(r.rows), [['PO-2611-001', 'PO-2611-001-03'], ['PO-2611-001', 'PO-2611-001-04']]);
  assert.deepStrictEqual(orderSuppliers(r.orders), [['PO-2611-001', 'S0']]); // 空の仕入先で上書きしない
  assert.strictEqual(r.rows[0], all[2]); // 中身のない行は読んだまま
});
test('edits: 範囲外のIDのない行は、番号を食わない（欠番を作らない）', () => {
  const all = [
    inputRow({ ...S0, 仕入先コード: 'S1', 品名: 'VA' }), // 範囲外・中身あり・IDなし（後回し中など）
    inputRow({ ...S0, 仕入先コード: 'S2', 品名: 'AZ' }),
  ];
  const r = assignInputRangeIds(all, 1, 2, ['PO-2611-001']);
  assert.deepStrictEqual(ids(r.rows), [['PO-2611-002', 'PO-2611-002-01']]);
  assert.deepStrictEqual(ids(all), [['', ''], ['', '']]); // 渡した行は書き換えない
});
test('edits: 中身のある行だけの範囲は、同じ仕入先・日・APの発注にまとめ、別の仕入先は新しい発注にする', () => {
  const all = [
    inputRow({ ...S0, 明細ID: 'PO-2611-001-01', 発注ID: 'PO-2611-001', 品名: 'VA' }),
    inputRow({ ...S0, 品名: 'AZ' }),
    inputRow({ ...S0, 仕入先コード: 'S1', 品名: 'CC' }),
  ];
  const r = assignInputRangeIds(all, 1, 3, ['PO-2611-001']);
  assert.deepStrictEqual(ids(r.rows), [['PO-2611-001', 'PO-2611-001-02'], ['PO-2611-002', 'PO-2611-002-01']]);
  assert.deepStrictEqual(orderSuppliers(r.orders), [['PO-2611-001', 'S0'], ['PO-2611-002', 'S1']]);
});
test('edits: IDのある行だけの範囲は、何度処理しても変わらない', () => {
  const all = [
    inputRow({ ...S0, 明細ID: 'PO-2611-001-01', 発注ID: 'PO-2611-001', 品名: 'VA' }),
    inputRow({ ...S0, 明細ID: 'PO-2611-001-02', 発注ID: 'PO-2611-001', 品名: 'AZ' }),
  ];
  const r = assignInputRangeIds(all, 0, 2, ['PO-2611-001']);
  assert.deepStrictEqual(ids(r.rows), [['PO-2611-001', 'PO-2611-001-01'], ['PO-2611-001', 'PO-2611-001-02']]);
  assert.deepStrictEqual(orderSuppliers(r.orders), [['PO-2611-001', 'S0']]);
});

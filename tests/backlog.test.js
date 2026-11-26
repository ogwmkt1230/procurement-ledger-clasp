const test = require('node:test');
const assert = require('node:assert');
const { computeBacklog, computeInTransit, isLineOpen } = require('../src/core/backlog.js');

const L = (id, qty, extra) => ({ 明細ID: id, 数量: qty, 状態: '発注中', ...extra });
const R = (id, n, extra) => ({ 明細ID: id, 実績数: n, ...extra });

test('backlog: 分納 iMINE VA', () => {
  const b = computeBacklog([L('A', 150000)], [R('A', 26400), R('A', 50563), R('A', 68253)]);
  assert.strictEqual(b.get('A').remaining, 4784);
  assert.strictEqual(b.get('A').received, 145216);
});
test('backlog: 過納は0で止めてエラー', () => {
  const e = computeBacklog([L('A', 100)], [R('A', 120)]).get('A');
  assert.strictEqual(e.remaining, 0);
  assert.ok(e.errors.includes('過納'));
});
test('backlog: 取消後入荷', () => {
  const e = computeBacklog([L('A', 100, { 状態: '取消' })], [R('A', 10)]).get('A');
  assert.strictEqual(e.remaining, 0);
  assert.ok(e.errors.includes('取消後入荷'));
});
test('backlog: 取消で入荷なしは残0・エラーなし', () => {
  const e = computeBacklog([L('A', 100, { 状態: '取消' })], []).get('A');
  assert.strictEqual(e.remaining, 0);
  assert.deepStrictEqual(e.errors, []);
});
test('backlog: 実績空の予定行は数えない', () => {
  assert.strictEqual(computeBacklog([L('A', 100)], [R('A', ''), R('A', 30)]).get('A').remaining, 70);
});
test('inTransit: 確定のみ、同じ便の実績を引く', () => {
  const sl = [{ 出荷明細ID: 'X1', 便ID: 'SH1', 明細ID: 'A', 数量: 4800, 紐付状態: '確定' }, { 出荷明細ID: 'X2', 便ID: 'SH1', 明細ID: 'B', 数量: 100, 紐付状態: '候補あり' }];
  const m = computeInTransit(sl, [R('A', 2400, { 便ID: 'SH1' }), R('A', 999, { 便ID: 'SH2' })]);
  assert.strictEqual(m.get('X1'), 2400);
  assert.ok(!m.has('X2'));
});
test('isLineOpen: 残0でも未送金の支払があればtrue', () => {
  const pays = [{ 明細ID: '', 発注ID: 'PO-1', 区分: '後金', 送金日: '' }];
  assert.strictEqual(isLineOpen({ 明細ID: 'PO-1-01', 発注ID: 'PO-1', 状態: '発注中' }, { remaining: 0 }, pays), true);
  assert.strictEqual(isLineOpen({ 明細ID: 'PO-1-01', 発注ID: 'PO-1', 状態: '発注中' }, { remaining: 0 }, []), false);
  assert.strictEqual(isLineOpen({ 明細ID: 'PO-1-01', 発注ID: 'PO-1', 状態: '取消' }, { remaining: 5 }, pays), false);
});

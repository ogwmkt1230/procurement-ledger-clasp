const test = require('node:test');
const assert = require('node:assert');
const { assignOrderIds, lineAmountJpy, accountingClass, validateInputRow, toOrderRecords, orderGroupKey } = require('../src/core/orders.js');

const d = new Date(2026, 10, 5);
const base = { ブランド: 'Yunth', 仕入先コード: 'S-IM', 発注日: d, 稟議AP: 'AP11020', 種別: '商品', 数量: 10, 通貨: '円', 単価: 100 };

test('orders: 同じキーは同じ発注ID、別APは別発注', () => {
  const out = assignOrderIds([{ ...base }, { ...base }, { ...base, 稟議AP: 'AP9' }], []);
  assert.deepStrictEqual(out.map(r => r.明細ID), ['PO-2611-001-01', 'PO-2611-001-02', 'PO-2611-002-01']);
  assert.deepStrictEqual(out.map(r => r.発注ID), ['PO-2611-001', 'PO-2611-001', 'PO-2611-002']);
});
test('orders: 既存IDの行は変えない', () => {
  const out = assignOrderIds([{ ...base, 明細ID: 'PO-2610-005-01', 発注ID: 'PO-2610-005' }], []);
  assert.strictEqual(out[0].明細ID, 'PO-2610-005-01');
});
test('orders: 既存発注に同キーの行が来たら枝番を続ける', () => {
  const rows = [{ ...base, 明細ID: 'PO-2611-001-01', 発注ID: 'PO-2611-001' }, { ...base, 明細ID: 'PO-2611-001-02', 発注ID: 'PO-2611-001' }, { ...base }];
  const out = assignOrderIds(rows, ['PO-2611-001']);
  assert.strictEqual(out[2].明細ID, 'PO-2611-001-03');
});
test('orders: 金額 円', () => assert.strictEqual(lineAmountJpy({ 通貨: '円', 単価: 616, 数量: 18710 }), 11525360));
test('orders: 金額 ウォン', () => assert.strictEqual(lineAmountJpy({ 通貨: 'ウォン', 単価: 940, 数量: 600000, 換算レート: 0.11 }), 62040000));
test('orders: 金額 レート空はnull', () => assert.strictEqual(lineAmountJpy({ 通貨: 'ドル', 単価: 10, 数量: 5, 換算レート: '' }), null));
test('orders: 金額 入数あり', () => assert.strictEqual(lineAmountJpy({ 通貨: '円', 単価: 4000, 入数: 4, 数量: 100 }), 100000));
test('orders: 検証 レート未入力', () => assert.ok(validateInputRow({ ...base, 通貨: 'ドル', 換算レート: '' }).includes('換算レート未入力')));
test('orders: 検証 数量不正', () => {
  assert.ok(validateInputRow({ ...base, 数量: 0 }).includes('数量不正'));
  assert.ok(validateInputRow({ ...base, 数量: 'abc' }).includes('数量不正'));
});
test('orders: 検証 必須', () => assert.ok(validateInputRow({ ...base, 種別: '' }).includes('必須項目未入力: 種別')));
test('orders: 検証 正常は空', () => assert.deepStrictEqual(validateInputRow(base), []));
test('orders: 会計区分', () => {
  const m = [{ 種別: '金型', 会計区分: '固定資産' }, { 種別: '商品', 会計区分: '商品原価' }];
  assert.strictEqual(accountingClass('金型', m), '固定資産');
  assert.strictEqual(accountingClass('謎', m), '要確認');
});
test('orders: 会計区分 仕入先コードの行が既定より優先（行の順番によらない）', () => {
  const m = [{ 種別: '開発費', 会計区分: '費用', 仕入先コード: '' }, { 種別: '開発費', 会計区分: '商品原価', 仕入先コード: 'S-IMN' }];
  for (const master of [m, m.slice().reverse()]) {
    assert.strictEqual(accountingClass('開発費', master, 'S-IMN'), '商品原価');
    assert.strictEqual(accountingClass('開発費', master, 'S-MTM'), '費用');
    assert.strictEqual(accountingClass('開発費', master), '費用');
  }
});
test('orders: 会計区分 既定の行が無く仕入先も違えば要確認', () => {
  const m = [{ 種別: '開発費', 会計区分: '商品原価', 仕入先コード: 'S-IMN' }];
  assert.strictEqual(accountingClass('開発費', m, 'S-MTM'), '要確認');
  assert.strictEqual(accountingClass('開発費', m), '要確認');
});
test('orders: 会計区分 会計区分が空の行は飛ばす', () => {
  const m = [{ 種別: '開発費', 会計区分: '', 仕入先コード: 'S-IMN' }, { 種別: '開発費', 会計区分: '費用', 仕入先コード: '' }];
  assert.strictEqual(accountingClass('開発費', m, 'S-IMN'), '費用');
});
test('orders: 会計区分 前後の空白は無視（マスタ側も明細側も）', () => {
  const m = [{ 種別: '開発費 ', 会計区分: ' 商品原価', 仕入先コード: ' S-IMN ' }];
  assert.strictEqual(accountingClass('開発費', m, 'S-IMN'), '商品原価');
  assert.strictEqual(accountingClass('開発費 ', m, ' S-IMN'), '商品原価');
});
test('orders: 会計区分 数値のセルでも止まらない', () => {
  const m = [{ 種別: '開発費', 会計区分: '費用', 仕入先コード: '' }, { 種別: '開発費', 会計区分: '商品原価', 仕入先コード: 123 }];
  assert.strictEqual(accountingClass('開発費', m, '123'), '商品原価');
  assert.strictEqual(accountingClass('開発費', m, 123), '商品原価');
});
test('orders: 会計区分 会計区分が空の既定行しか無ければ要確認', () => {
  assert.strictEqual(accountingClass('開発費', [{ 種別: '開発費', 会計区分: '' }]), '要確認');
});
test('orders: toOrderRecords はキーごとに1件', () => {
  const rows = assignOrderIds([{ ...base }, { ...base }, { ...base, 稟議AP: 'AP9' }], []);
  const o = toOrderRecords(rows);
  assert.strictEqual(o.length, 2);
  assert.strictEqual(o[0].発注ID, 'PO-2611-001');
  assert.strictEqual(o[0].稟議AP, 'AP11020');
});
test('orders: groupKey', () => assert.strictEqual(orderGroupKey(base), 'S-IM|2026-11-05|AP11020'));

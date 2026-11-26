const test = require('node:test');
const assert = require('node:assert');
const { nextSerialId, lineId } = require('../src/core/ids.js');

test('ids: 最初の発注ID', () => assert.strictEqual(nextSerialId('PO', new Date(2026, 10, 5), []), 'PO-2611-001'));
test('ids: 同月の最大+1、他月は無視', () =>
  assert.strictEqual(nextSerialId('PO', new Date(2026, 10, 20), ['PO-2611-001', 'PO-2611-007', 'PO-2610-099']), 'PO-2611-008'));
test('ids: 便IDは月が変わると001から', () => assert.strictEqual(nextSerialId('SH', new Date(2026, 11, 1), ['SH-2611-004']), 'SH-2612-001'));
test('ids: 明細ID', () => assert.strictEqual(lineId('PO-2611-003', 2), 'PO-2611-003-02'));
test('ids: 月999件超えはthrow', () => assert.throws(() => nextSerialId('PO', new Date(2026, 10, 1), ['PO-2611-999'])));
test('ids: 枝番99超えはthrow', () => assert.throws(() => lineId('PO-2611-003', 100)));

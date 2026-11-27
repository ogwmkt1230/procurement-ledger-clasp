const test = require('node:test');
const assert = require('node:assert');
const { buildReceiptPlans, shipmentStage, unlinkedReceipts, orphanReceiptPlans, samePlanStillUntouched } = require('../src/core/shipments.js');

const sl = (id, st, extra) => ({ 出荷明細ID: id, 便ID: 'SH1', 明細ID: 'L' + id, 数量: 100, 配達予定日: new Date(2026, 11, 7), 配達先コード: 'NTTロジスコ千葉', 紐付状態: st, ...extra });

test('receipts: 確定2本から2行、2回目は0行', () => {
  const r1 = buildReceiptPlans([sl('1', '確定'), sl('2', '確定')], [], []);
  assert.strictEqual(r1.length, 2);
  assert.deepStrictEqual([r1[0].明細ID, r1[0].便ID, r1[0].予定数, r1[0].納品場所], ['L1', 'SH1', 100, 'NTTロジスコ千葉']);
  assert.strictEqual(buildReceiptPlans([sl('1', '確定'), sl('2', '確定')], r1, []).length, 0);
});
test('receipts: 候補ありからは作らない', () => assert.strictEqual(buildReceiptPlans([sl('1', '候補あり')], [], []).length, 0));

const today = new Date(2026, 10, 26);
const ship = (extra) => ({ 便ID: 'SH1', ETD: new Date(2026, 10, 20), ETA: new Date(2026, 10, 30), 輸入許可日: '', 倉庫連絡日: '', ...extra });
test('stage: 出航前', () => assert.strictEqual(shipmentStage(ship({ ETD: new Date(2026, 10, 28) }), [], [], today), '出航前'));
test('stage: 輸送中', () => assert.strictEqual(shipmentStage(ship(), [], [], today), '輸送中'));
test('stage: 入港済', () => assert.strictEqual(shipmentStage(ship({ ETA: new Date(2026, 10, 25) }), [], [], today), '入港済'));
test('stage: 輸入許可済', () => assert.strictEqual(shipmentStage(ship({ ETA: new Date(2026, 10, 25), 輸入許可日: new Date(2026, 10, 25) }), [], [], today), '輸入許可済'));
test('stage: 倉庫連絡済', () => assert.strictEqual(shipmentStage(ship({ 輸入許可日: new Date(2026, 10, 25), 倉庫連絡日: new Date(2026, 10, 26) }), [], [], today), '倉庫連絡済'));
test('stage: 納品済', () => {
  const lines = [sl('1', '確定'), sl('2', '確定')];
  const rec = [{ 便ID: 'SH1', 明細ID: 'L1', 実績数: 100 }, { 便ID: 'SH1', 明細ID: 'L2', 実績数: 100 }];
  assert.strictEqual(shipmentStage(ship({ 倉庫連絡日: new Date(2026, 10, 26) }), lines, rec, today), '納品済');
  assert.strictEqual(shipmentStage(ship({ 倉庫連絡日: new Date(2026, 10, 26) }), lines, rec.slice(0, 1), today), '倉庫連絡済');
});

// 紐付が外れた入荷予定。plan は入荷シートの1行（readObjects_ と同じく全列そろえる）
const conf = (shipId, lineId, extra) => ({ 出荷明細ID: shipId + '-01', 便ID: shipId, 明細ID: lineId, 紐付状態: '確定', 品目テキスト: '白ドライヤー：100', 数量: 100, 配達予定日: new Date(2026, 11, 7), 配達先コード: 'P1', ...extra });
const plan = (id, shipId, lineId, extra) => ({ 入荷ID: id, 明細ID: lineId, 便ID: shipId, 入荷予定日: new Date(2026, 11, 7), 予定数: 100, 納品場所: 'P1',
  入荷日: '', 実績数: '', 賞味期限: '', 品質コード: '', 納品書日付: '', 納品書単価: '', 納品書数量: '', 納品書金額: '', COOOLa登録: '', 入荷報告メール: '', 確認者: '', ...extra });
const ids = rows => rows.map(r => r.入荷ID);

test('orphan: 確定行の明細IDを変えると、前の明細IDの未記入の予定が消す対象になる', () => {
  const rec = [plan('RC1', 'SH1', 'L1'), plan('RC2', 'SH1', 'L2')];
  assert.deepStrictEqual(ids(orphanReceiptPlans([conf('SH1', 'L2')], rec)), ['RC1']);
});
test('orphan: 同じ便に同じ明細の確定行が残っていれば消さない（コンテナ分割）', () => {
  const sl = [conf('SH1', 'L1'), conf('SH1', 'L2', { 出荷明細ID: 'SH1-02' })];
  assert.deepStrictEqual(ids(orphanReceiptPlans(sl, [plan('RC1', 'SH1', 'L1')])), []);
});
test('orphan: 確定を候補あり・未紐付に戻した行の予定は消す対象', () => {
  const sl = [conf('SH1', 'L1', { 紐付状態: '候補あり' }), conf('SH2', 'L2', { 紐付状態: '未紐付' })];
  assert.deepStrictEqual(ids(orphanReceiptPlans(sl, [plan('RC1', 'SH1', 'L1'), plan('RC2', 'SH2', 'L2')])), ['RC1', 'RC2']);
});
test('orphan: 便IDを変えた確定行の、前の便の予定は消す対象', () => {
  assert.deepStrictEqual(ids(orphanReceiptPlans([conf('SH2', 'L1')], [plan('RC1', 'SH1', 'L1')])), ['RC1']);
});
test('orphan: 人が何か書いた予定は消さず、紐付なしとしてだけ返る', () => {
  [['実績数', 100], ['実績数', 0], ['入荷日', new Date(2026, 11, 8)], ['確認者', 'めぐ'], ['納品書数量', 100], ['メモ', '倉庫に確認中']].forEach(([k, v]) => {
    const rec = [plan('RC1', 'SH1', 'L1', { [k]: v })];
    assert.deepStrictEqual(ids(orphanReceiptPlans([], rec)), [], k + '=' + v);
    assert.deepStrictEqual(ids(unlinkedReceipts([], rec)), ['RC1'], k + '=' + v);
  });
});
test('orphan: チェックボックスが未チェック（false）なだけなら何も書かれていないとみなす', () => {
  const rec = [plan('RC1', 'SH1', 'L1', { COOOLa登録: false, 入荷報告メール: false })];
  assert.deepStrictEqual(ids(orphanReceiptPlans([], rec)), ['RC1']);
});
test('orphan: 便IDの無い入荷は紐付なしにも入らず、入荷IDの無い行は消す対象にならない', () => {
  const noShip = plan('RC9', '', 'L1');
  const noId = plan('', 'SH1', 'L1');
  assert.deepStrictEqual(unlinkedReceipts([], [noShip, noId]), [noId]);
  assert.deepStrictEqual(orphanReceiptPlans([], [noShip, noId]), []);
});
test('samePlanStillUntouched: 読み直した行が同じ予定で未記入のときだけ消してよい', () => {
  const t = plan('RC1', 'SH1', 'L1');
  assert.strictEqual(samePlanStillUntouched(t, plan('RC1', 'SH1', 'L1', { 予定数: 120 })), true);
  assert.strictEqual(samePlanStillUntouched(t, plan('RC2', 'SH1', 'L1')), false, '別の行（入荷IDが違う）');
  assert.strictEqual(samePlanStillUntouched(t, plan('RC1', 'SH2', 'L1')), false, '便IDが変わった');
  assert.strictEqual(samePlanStillUntouched(t, plan('RC1', 'SH1', 'L2')), false, '明細IDが変わった');
  assert.strictEqual(samePlanStillUntouched(t, plan('RC1', 'SH1', 'L1', { 実績数: 100 })), false, '実績が書かれた');
  assert.strictEqual(samePlanStillUntouched(t, { ...plan('RC1', 'SH1', 'L1'), 列18: '確認中' }), false, '定義の外の列に書かれた');
  assert.strictEqual(samePlanStillUntouched(t, plan('', '', '')), false, '空の行');
  assert.strictEqual(samePlanStillUntouched(plan('', 'SH1', 'L1'), plan('', 'SH1', 'L1')), false, '入荷IDの無い行は消さない');
});

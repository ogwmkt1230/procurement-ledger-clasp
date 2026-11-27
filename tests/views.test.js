process.env.TZ = 'Asia/Tokyo'; // 台帳（GAS）と同じ時間帯で日付を読む。切替日の境目のテストが CI（UTC）でも意味を持つように
const test = require('node:test');
const assert = require('node:assert');
const { viewBacklogByMonth, viewReceiptPlan, viewMismatch, viewYomi, viewInTransit } = require('../src/core/views.js');
const { computeBacklog } = require('../src/core/backlog.js');

const L = (extra) => ({ 明細ID: 'A', 発注ID: 'PO-1', ブランド: 'Yunth', 仕入先コード: 'S-IM', 品名: 'VA', 商品コード: 'VA1', 種別: '商品', 会計区分: '商品原価', 通貨: 'ウォン', 単価: 940, 換算レート: 0.11, 数量: 150000, 納期予定月: '2026/12', 状態: '発注中', ...extra });

test('views: 発注残の円換算と固定資産の別行', () => {
  const lines = [L(), L({ 明細ID: 'M', 種別: '金型', 会計区分: '固定資産', 通貨: '円', 単価: 1000000, 数量: 1, 換算レート: '' })];
  const rec = [{ 明細ID: 'A', 実績数: 145216 }];
  const v = viewBacklogByMonth(lines, computeBacklog(lines, rec));
  const col = v.headers.indexOf('2026/12');
  const cogs = v.rows.find(r => r[0] === 'Yunth' && r[1] === '商品原価');
  const fa = v.rows.find(r => r[0] === 'Yunth' && r[1] === '固定資産');
  assert.strictEqual(cogs[col], 494666);
  assert.strictEqual(fa[col], 1000000);
});
test('views: 入荷予定は日付順で04と同じ先頭6列', () => {
  const lines = [L()];
  const rec = [{ 明細ID: 'A', 入荷予定日: new Date(2026, 11, 10), 予定数: 5, 実績数: '' }, { 明細ID: 'A', 入荷予定日: new Date(2026, 11, 1), 予定数: 7, 実績数: '' }, { 明細ID: 'A', 入荷予定日: new Date(2026, 10, 1), 予定数: 9, 実績数: 9 }];
  const v = viewReceiptPlan(rec, lines, []);
  assert.deepStrictEqual(v.headers.slice(0, 6), ['元々納品月', '実際納品月', '商品名', '商品コード', '入荷予定日', '入荷予定数']);
  assert.deepStrictEqual(v.rows.map(r => r[5]), [7, 5]);
});
test('views: 突合エラー 単価差', () => {
  const lines = [L({ 通貨: '円', 単価: 616, 数量: 100 })];
  const bad = [{ 入荷ID: 'R1', 明細ID: 'A', 実績数: 100, 納品書単価: 625, 納品書数量: 100 }];
  const ok = [{ 入荷ID: 'R1', 明細ID: 'A', 実績数: 100, 納品書単価: 616, 納品書数量: 100 }];
  assert.strictEqual(viewMismatch(lines, bad, [], computeBacklog(lines, bad), new Date()).rows.length, 1);
  assert.strictEqual(viewMismatch(lines, ok, [], computeBacklog(lines, ok), new Date()).rows.length, 0);
});
test('views: 突合エラー 14日以上未紐付', () => {
  const sl = [{ 出荷明細ID: 'X', 紐付状態: '未紐付', 配達予定日: new Date(2026, 10, 1) }];
  assert.strictEqual(viewMismatch([], [], sl, new Map(), new Date(2026, 10, 20)).rows.length, 1);
});
test('views: ヨミ表で残0・支払済は完了', () => {
  const lines = [L({ 数量: 10 })];
  const b = computeBacklog(lines, [{ 明細ID: 'A', 実績数: 10 }]);
  const v = viewYomi(lines, b, [{ 発注ID: 'PO-1', 区分: '前金', 送金日: new Date() }]);
  assert.strictEqual(v.rows[0][v.headers.indexOf('状態')], '完了');
});
test('views: 輸送中ビューに段階が出る', () => {
  const v = viewInTransit([{ 便ID: 'SH1', ETD: new Date(2026, 10, 20), ETA: new Date(2026, 10, 30) }], [], [], new Date(2026, 10, 26));
  assert.strictEqual(v.rows[0][v.headers.indexOf('段階')], '輸送中');
});
test('views: 外貨明細は単価差を出さない（通貨が違うため）', () => {
  const lines = [L()];
  const rec = [{ 入荷ID: 'R1', 明細ID: 'A', 実績数: 100, 納品書単価: 103, 納品書数量: 100 }];
  assert.strictEqual(viewMismatch(lines, rec, [], new Map(), new Date()).rows.length, 0);
});

// 14日ルール：今日 2026/11/27 なら、配達予定日が 11/13 以前の出荷明細が対象
const t27 = new Date(2026, 10, 27);
const SL = (id, extra) => ({ 出荷明細ID: id, 便ID: 'SH1', コンテナNO: 'C1', コンテナタイプ: '40F', 品目テキスト: '白ドライヤー：2400', 数量: 2400, 配達予定日: new Date(2026, 10, 1), 配達先コード: 'P1', 明細ID: '', 紐付状態: '未紐付', 候補: '', 要確認: '', ...extra });
const late = (sl, cutover) => viewMismatch([], [], sl, new Map(), t27, cutover).rows;

test('views: 突合エラー 候補ありも14日を超えたら出し、内容に候補の明細IDを書く', () => {
  assert.deepStrictEqual(late([SL('X', { 紐付状態: '候補あり', 明細ID: 'PO-2611-001-01' })]), [['候補あり14日超', 'X', '白ドライヤー：2400（候補 PO-2611-001-01）']]);
});
test('views: 突合エラー 紐付状態が空の行と、確定なのに明細IDが空の行は未紐付14日超', () => {
  assert.deepStrictEqual(late([SL('A', { 紐付状態: '' }), SL('B', { 紐付状態: '確定' })]),
    [['未紐付14日超', 'A', '白ドライヤー：2400'], ['未紐付14日超', 'B', '白ドライヤー：2400（確定だが明細IDが空）']]);
});
test('views: 突合エラー 確定（明細IDあり）・13日以内・配達予定日なしは14日ルールに出さない', () => {
  assert.deepStrictEqual(late([
    SL('A', { 紐付状態: '確定', 明細ID: 'L1' }),
    SL('B', { 紐付状態: '候補あり', 明細ID: 'L1', 配達予定日: new Date(2026, 10, 14) }),
    SL('C', { 配達予定日: '' }),
  ]), []);
});
test('views: 突合エラー 品目の無いコンテナ行は、同じ便に品目があれば14日ルールに出さない', () => {
  const blank = { 品目テキスト: '', 数量: '' };
  assert.deepStrictEqual(late([
    SL('A-01', { 便ID: 'SHA', 紐付状態: '確定', 明細ID: 'L1' }),
    SL('A-02', { 便ID: 'SHA', コンテナNO: 'C2', ...blank }),
    SL('B-01', { 便ID: 'SHB', ...blank, 要確認: '品目なし' }),
  ]), [['未紐付14日超', 'B-01', '']]);
});
test('views: 突合エラー 切替日より前に配達予定の出荷明細は14日ルールに出さない', () => {
  const sl = [SL('OLD', { 配達予定日: new Date(2026, 10, 9) }), SL('ON', { 配達予定日: new Date(2026, 10, 10), 紐付状態: '候補あり', 明細ID: 'L1' })];
  const ids = rows => rows.map(r => r[1]);
  assert.deepStrictEqual(ids(late(sl, '2026/11/10')), ['ON']);
  assert.deepStrictEqual(ids(late(sl, '2026-11-10')), ['ON'], 'ハイフン区切りも、その日の0時（日本時間）として読む');
  assert.deepStrictEqual(ids(late(sl, '')), ['OLD', 'ON'], '未設定なら今までどおり');
  assert.deepStrictEqual(ids(late(sl, '未定')), ['OLD', 'ON'], '読めない値は未設定と同じ');
});
test('views: 突合エラー 確定の出荷明細から外れた入荷は紐付なし入荷として出す', () => {
  const sl = [SL('SH1-01', { 紐付状態: '確定', 明細ID: 'L2', 配達予定日: new Date(2026, 11, 7) })];
  const rec = [
    { 入荷ID: 'RC1', 明細ID: 'L1', 便ID: 'SH1', 実績数: 100 },
    { 入荷ID: 'RC2', 明細ID: 'L2', 便ID: 'SH1', 実績数: '' },
    { 入荷ID: 'RC3', 明細ID: 'L9', 便ID: 'SH1', 実績数: '' },
    { 入荷ID: 'RC4', 明細ID: 'L1', 便ID: '', 実績数: 50, 確認者: '移行時点の入荷済' },
  ];
  const rows = viewMismatch([], rec, sl, new Map(), t27).rows;
  assert.deepStrictEqual(rows.map(r => [r[0], r[1]]), [['紐付なし入荷', 'RC1'], ['紐付なし入荷', 'RC3']]);
  assert.ok(rows[0][2].includes('実績 100'), rows[0][2]);
  assert.ok(!rows[1][2].includes('実績'), rows[1][2]);
});

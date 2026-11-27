/** 発注明細入力シートの編集行に、ID・金額・会計区分・要確認を入れ、発注シートを更新する。 */
function handleInputEdit_(sheet, startRow, numRows) {
  var all = readObjects_('input');
  var orders = readObjects_('orders');
  var kinds = readObjects_('mKinds');
  var first = startRow - 2, last = first + numRows;
  if (!all.slice(first, last).some(hasInputContent)) return;
  // IDは中身のある行にだけ振る（列ごとの編集で、空行や中身を消した行に振らない）
  var ids = assignInputRangeIds(all, first, last, orders.map(function (o) { return o.発注ID; }));
  var assigned = ids.rows.map(function (r) {
    if (!hasInputContent(r)) return r;
    var amt = lineAmountJpy(r);
    r['金額(円)'] = amt === null ? '' : amt;
    r.会計区分 = accountingClass(r.種別, kinds);
    if (!r.状態) r.状態 = '発注中';
    r.要確認 = validateInputRow(r).join(' / ');
    return r;
  });
  writeRowObjects_('input', startRow, assigned);
  upsertOrders_(ids.orders, orders);
}

function upsertOrders_(records, existing) {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.orders.name);
  var index = {};
  existing.forEach(function (o, i) { index[o.発注ID] = i + 2; });
  var appends = [];
  records.forEach(function (o) {
    if (index[o.発注ID]) writeRowObjects_('orders', index[o.発注ID], [o]);
    else appends.push(o);
  });
  appendRowObjects_('orders', appends);
}

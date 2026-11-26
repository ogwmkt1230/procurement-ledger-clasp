/** 出荷明細が「確定」になったら入荷予定を作る。 */
function handleShipLineEdit_(sheet, startRow, numRows) {
  var lines = readObjects_('shipLines').slice(startRow - 2, startRow - 2 + numRows);
  var receipts = readObjects_('receipts');
  var plans = buildReceiptPlans(lines, receipts, []);
  if (!plans.length) return;
  var ids = receipts.map(function (r) { return r.入荷ID; });
  var now = new Date();
  plans.forEach(function (p) { p.入荷ID = nextSerialId('RC', now, ids); ids.push(p.入荷ID); });
  appendRowObjects_('receipts', plans);
}

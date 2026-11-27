/** 出荷明細が「確定」になったら入荷予定を作る。どの確定行からも指されなくなった予定（明細IDの変更・確定の取り消しなど）は消す。 */
function handleShipLineEdit_(sheet, startRow, numRows) {
  var all = readObjects_('shipLines');
  var lines = all.slice(startRow - 2, startRow - 2 + numRows);
  var receipts = readObjects_('receipts');
  var ids = receipts.map(function (r) { return r.入荷ID; });
  // 前の明細ID・便IDは分からない（e.oldValue は1セルの編集だけ）ので、出荷明細の全行と照らして、根拠の無くなった予定を探す
  var orphans = orphanReceiptPlans(all, receipts);
  if (orphans.length) {
    removeReceiptPlans_(receipts, orphans);
    receipts = readObjects_('receipts'); // 消さずに飛ばした行があっても、このあとの更新を今の行位置で書く
  }
  applyUpdates_('receipts', receipts, receiptPlanUpdates(lines, receipts));
  var plans = buildReceiptPlans(lines, receipts, []);
  if (!plans.length) return;
  var now = new Date();
  plans.forEach(function (p) { p.入荷ID = nextSerialId('RC', now, ids); ids.push(p.入荷ID); });
  appendRowObjects_('receipts', plans);
}

/** 入荷シートから予定の行を消す。下の行から順に、消す直前にその行を読み直し、同じ予定でまだ何も書かれていないときだけ消す（人が行を動かした・書き込んだときは消さない）。 */
function removeReceiptPlans_(receipts, targets) {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.receipts.name);
  var width = SHEETS.receipts.headers.length;
  targets.map(function (t) { return { row: receipts.indexOf(t) + 2, target: t }; })
    .filter(function (x) { return x.row >= 2; })
    .sort(function (a, b) { return b.row - a.row; })
    .forEach(function (x) {
      if (x.row > sh.getLastRow()) return;
      var vals = sh.getRange(x.row, 1, 1, Math.max(width, sh.getLastColumn())).getValues()[0];
      var cur = rowsToObjects('receipts', [vals.slice(0, width)])[0];
      vals.slice(width).forEach(function (v, i) { cur['列' + (width + i + 1)] = v; }); // シートにだけ足された列も人の記録として見る
      if (samePlanStillUntouched(x.target, cur)) sh.deleteRow(x.row);
    });
}

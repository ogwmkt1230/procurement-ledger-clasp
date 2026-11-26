var VIEW_SHEETS_ = { yomi: 'V_ヨミ表', backlog: 'V_発注残', transit: 'V_輸送中', plan: 'V_入荷予定', mismatch: 'V_突合エラー' };

/** 台帳からビューを作り直す（1時間ごと＋メニュー）。 */
function renderViews() {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) return;
  try { renderViewsLocked_(); } finally { lock.releaseLock(); }
}

function renderViewsLocked_() {
  var lines = readObjects_('input').filter(function (l) { return l.明細ID; });
  var receipts = readObjects_('receipts'), payments = readObjects_('payments');
  var ships = readObjects_('shipments'), shipLines = readObjects_('shipLines'), items = readObjects_('mItems');
  var backlog = computeBacklog(lines, receipts), today = new Date();
  writeView_(VIEW_SHEETS_.yomi, viewYomi(lines, backlog, payments));
  writeView_(VIEW_SHEETS_.backlog, viewBacklogByMonth(lines, backlog));
  writeView_(VIEW_SHEETS_.transit, viewInTransit(ships, shipLines, receipts, today));
  writeView_(VIEW_SHEETS_.plan, viewReceiptPlan(receipts, lines, items));
  writeView_(VIEW_SHEETS_.mismatch, viewMismatch(lines, receipts, shipLines, backlog, today));
}

function writeView_(name, view) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clearContents();
  var data = [view.headers].concat(view.rows.map(function (r) { return r.map(function (v) { return v === null || v === undefined ? '' : v; }); }));
  sh.getRange(1, 1, data.length, view.headers.length).setValues(data);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, view.headers.length).setFontWeight('bold');
  if (!sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) {
    // 警告のみ：誰がメニューから更新しても書けるようにし、手での編集には警告を出す
    sh.protect().setDescription('auto:view').setWarningOnly(true);
  }
}

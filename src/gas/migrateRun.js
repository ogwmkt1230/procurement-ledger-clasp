var SKIP_TABS_ = /税関対応|まとめ|シート\d|発注残|資材単価/;

function migrateBrandPrompt() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('移行するブランド', 'Yunth / Brighte / Straine のどれかを入力', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var brand = res.getResponseText().trim();
  var ids = JSON.parse(PropertiesService.getScriptProperties().getProperty('YOMI_IDS') || '{}');
  if (!ids[brand]) throw new Error('スクリプトプロパティ YOMI_IDS に ' + brand + ' のIDがありません');
  var r = migrateBrand(ids[brand], brand);
  ui.alert(brand + ' 移行: 明細 ' + r.lines + '件 / 要確認 ' + r.warnings + '件 / 照合 ' + (r.reconcile.ok ? 'OK' : '差 ' + r.reconcile.diff));
}

/** 旧ヨミ表1本を読み、未完了の発注だけを台帳に入れる。 */
function migrateBrand(spreadsheetId, brand) {
  var src = SpreadsheetApp.openById(spreadsheetId);
  var suppliers = readObjects_('mSuppliers');
  var logRows = [], newInput = [], openings = [], pays = [], oldUnreceived = 0;
  src.getSheets().forEach(function (sh) {
    var tab = sh.getName();
    if (SKIP_TABS_.test(tab)) return;
    var values = sh.getDataRange().getValues();
    var hi = values.findIndex(function (r) { return r.map(String).some(function (c) { return c.replace(/\s/g, '') === '管理No.'; }); });
    if (hi < 0) return;
    var sup = suppliers.find(function (s) { return s.仕入先名 && tab.indexOf(s.仕入先名) >= 0; });
    if (!sup) { logRows.push([tab, '', '仕入先マスタに該当なし（タブ名で照合）']); return; }
    var mapped = values.slice(hi + 1).filter(function (r) { return r.some(function (c) { return c !== ''; }); })
      .map(function (r) { return mapYomiRow(r, values[hi], { ブランド: brand, 仕入先コード: sup.仕入先コード }); });
    selectOpenRows(mapped).forEach(function (m) {
      oldUnreceived += m.unreceived;
      newInput.push(m.line);
      openings.push(m.openingReceipt);
      pays.push(m.payments);
      m.warnings.forEach(function (w) { logRows.push([tab, m.line.品名, w]); });
    });
  });
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.input.name);
  var start = sh.getLastRow() + 1;
  appendRowObjects_('input', newInput);
  if (newInput.length) handleInputEdit_(sh, start, newInput.length);
  var written = readObjects_('input').slice(start - 2, start - 2 + newInput.length);
  var recIds = readObjects_('receipts').map(function (r) { return r.入荷ID; });
  var payIds = readObjects_('payments').map(function (p) { return p.支払ID; });
  var now = new Date(), recRows = [], payRows = [];
  written.forEach(function (l, i) {
    if (openings[i]) { var rid = nextSerialId('RC', now, recIds); recIds.push(rid); recRows.push(Object.assign({ 入荷ID: rid, 明細ID: l.明細ID }, openings[i])); }
    pays[i].forEach(function (p) { var pid = nextSerialId('PY', now, payIds); payIds.push(pid); payRows.push(Object.assign({ 支払ID: pid, 発注ID: l.発注ID, 明細ID: l.明細ID, 稟議AP: l.稟議AP }, p)); });
  });
  appendRowObjects_('receipts', recRows);
  appendRowObjects_('payments', payRows);
  var backlog = computeBacklog(written, recRows);
  var ledgerRemaining = 0;
  backlog.forEach(function (b) { ledgerRemaining += b.remaining; });
  var rec = reconcileBrand(oldUnreceived, ledgerRemaining);
  var ss = SpreadsheetApp.getActive();
  var log = ss.getSheetByName('移行ログ') || ss.insertSheet('移行ログ');
  if (log.getLastRow() === 0) log.appendRow(['日時', 'ブランド', 'タブ', '品名', '内容']);
  logRows.forEach(function (r) { log.appendRow([now, brand].concat(r)); });
  log.appendRow([now, brand, '（照合）', '', '旧未納品 ' + oldUnreceived + ' / 台帳発注残 ' + ledgerRemaining + (rec.ok ? ' 一致' : ' 差 ' + rec.diff)]);
  return { lines: newInput.length, warnings: logRows.length, reconcile: rec };
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('統合台帳')
    .addItem('NX取り込み', 'importNxFromInbox')
    .addItem('ビュー更新', 'renderViews')
    .addItem('移行（ブランド選択）', 'migrateBrandPrompt')
    .addSeparator()
    .addItem('初期設定', 'setupLedger')
    .addToUi();
}

/** インストール型の編集トリガー。対象シートの編集だけを各処理に振り分ける。 */
function onEditInstalled(e) {
  if (!e || !e.range) return;
  var name = e.range.getSheet().getName();
  var handlers = {};
  handlers[SHEETS.input.name] = 'handleInputEdit_';
  handlers[SHEETS.shipments.name] = 'handleShipmentEdit_';
  handlers[SHEETS.shipLines.name] = 'handleShipLineEdit_';
  var fn = handlers[name];
  if (!fn || e.range.getRow() < 2) return;
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(20000)) return;
  try {
    this[fn](e.range.getSheet(), e.range.getRow(), e.range.getNumRows());
  } finally {
    lock.releaseLock();
  }
}

/** シートの全データ行を見出しキーのオブジェクトで読む。 */
function readObjects_(key) {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEETS[key].name);
  var n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return rowsToObjects(key, sh.getRange(2, 1, n, SHEETS[key].headers.length).getValues());
}

function writeRowObjects_(key, startRow, objs) {
  if (!objs.length) return;
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEETS[key].name);
  sh.getRange(startRow, 1, objs.length, SHEETS[key].headers.length).setValues(objs.map(function (o) { return objectToRow(key, o); }));
}

function appendRowObjects_(key, objs) {
  if (!objs.length) return;
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEETS[key].name);
  writeRowObjects_(key, sh.getLastRow() + 1, objs);
}

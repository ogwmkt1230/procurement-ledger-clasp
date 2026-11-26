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
  handlers[SHEETS.input.name] = handleInputEdit_;
  handlers[SHEETS.shipments.name] = handleShipmentEdit_;
  handlers[SHEETS.shipLines.name] = handleShipLineEdit_;
  var fn = handlers[name];
  if (!fn || e.range.getRow() < 2) return;
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(20000)) return;
  try {
    fn(e.range.getSheet(), e.range.getRow(), e.range.getNumRows());
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

function ensureRows_(sh, lastNeeded) {
  var max = sh.getMaxRows();
  if (lastNeeded > max) sh.insertRowsAfter(max, Math.max(lastNeeded - max, 1000));
}

/** 変わった列のセルだけ書く（保護列を不用意に書かないため）。 */
function writeChanges_(key, rowNumber, changes) {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEETS[key].name);
  Object.keys(changes).forEach(function (h) {
    var v = changes[h];
    sh.getRange(rowNumber, colIndex(key, h) + 1).setValue(v === null || v === undefined ? '' : v);
  });
}

/** メニュー操作（取り込み・移行）は台帳の所有者だけが実行する。 */
function assertOwner_() {
  var owner = PropertiesService.getScriptProperties().getProperty('OWNER_EMAIL');
  var me = Session.getActiveUser().getEmail();
  if (owner && me && owner !== me) throw new Error('この操作は台帳の管理者（' + owner + '）が実行してください');
}

function writeRowObjects_(key, startRow, objs) {
  if (!objs.length) return;
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEETS[key].name);
  ensureRows_(sh, startRow + objs.length - 1);
  sh.getRange(startRow, 1, objs.length, SHEETS[key].headers.length).setValues(objs.map(function (o) { return objectToRow(key, o); }));
}

function appendRowObjects_(key, objs) {
  if (!objs.length) return;
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEETS[key].name);
  writeRowObjects_(key, sh.getLastRow() + 1, objs);
}

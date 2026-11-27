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
  var sheet = e.range.getSheet();
  if (!editHandlerFor_(sheet.getName())) return;
  // 見出し行から始まる範囲（列ごとの削除・貼り付けなど）も、データ行の部分は処理する
  var span = dataRowSpan(e.range.getRow(), e.range.getNumRows());
  if (!span) return;
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(20000)) {
    deferEdit_(sheet.getName(), span);
    return;
  }
  try {
    applyEdits_([{ sheet: sheet.getName(), startRow: span.startRow, numRows: span.numRows }]);
  } finally {
    lock.releaseLock();
  }
}

/** 編集を処理する関数をシート名から引く。対象外のシートは null。 */
function editHandlerFor_(sheetName) {
  var handlers = {};
  handlers[SHEETS.input.name] = handleInputEdit_;
  handlers[SHEETS.shipments.name] = handleShipmentEdit_;
  handlers[SHEETS.shipLines.name] = handleShipLineEdit_;
  return handlers[sheetName] || null;
}

/** ロックが取れずに後回しにした編集は、スクリプトプロパティにこの接頭辞＋uuid のキーで1件ずつ置く。 */
var DEFERRED_EDIT_PREFIX_ = 'DEFERRED_EDIT_';

/** ロックが取れなかった編集の範囲を覚えておき、編集した人に知らせる。1件1キーなので、ロックなしで同時に書いても取り合わない。 */
function deferEdit_(sheetName, span) {
  PropertiesService.getScriptProperties().setProperty(DEFERRED_EDIT_PREFIX_ + Utilities.getUuid(),
    JSON.stringify({ sheet: sheetName, startRow: span.startRow, numRows: span.numRows, at: new Date().toISOString() }));
  console.warn('ロックが取れず、編集の反映を後回しにした: ' + sheetName + ' ' + span.startRow + '行目から' + span.numRows + '行');
  SpreadsheetApp.getActive().toast('ほかの処理が実行中のため、この編集の自動処理（ID・金額・入荷予定など）をあとに回しました。次に発注明細入力・便・出荷明細のどれかを編集したときか、1時間ごとの更新のときに自動で反映します。', '統合台帳', 15);
}

/**
 * 編集範囲 {sheet, startRow, numRows} を処理する。ドキュメントロックを持っている間だけ呼ぶ。
 * 所有者として動いているときは、後回しにした編集を前に足し、重なる・隣り合う範囲をまとめて、シートごとに行の順で処理する
 * （発注明細入力のIDが入力の順に振られ、同じ行を2回処理しない）。所有者以外なら後回し分のキーには触れない（保護列に書けないため）。
 * 1つの範囲が失敗しても残りは処理し、最後に例外にする（実行の失敗として所有者に通知される。失敗した範囲は残さない）。
 */
function applyEdits_(spans) {
  var deferred = [];
  try {
    if (runningAsOwner_()) deferred = takeDeferredEdits_();
  } catch (err) {
    // 後回し分を取り出せなくても、今回の編集は処理する（キーは残っているので次の機会に回る）
    console.error(err);
  }
  var ss = SpreadsheetApp.getActive(), errors = [];
  mergeEditSpans(deferred.concat(spans)).forEach(function (s) {
    var fn = editHandlerFor_(s.sheet), sh = ss.getSheetByName(s.sheet);
    if (!fn || !sh) return;
    try {
      fn(sh, s.startRow, s.numRows);
    } catch (err) {
      console.error(err);
      errors.push(s.sheet + ' ' + s.startRow + '行目から' + s.numRows + '行: ' + err.message);
    }
  });
  if (errors.length) throw new Error('次の範囲の編集を反映できませんでした\n' + errors.join('\n'));
}

/**
 * 後回しにした編集をプロパティから取り出して消す（反映中に新しく後回しになった分は別のキーなので残る）。
 * 消す前に範囲を console.warn に残す（実行時間の上限で打ち切られたときの手がかり）。
 * 返すのは消せたキーの範囲だけ。消すのに失敗したらそこで止め、残りは次の機会に回す（消したのに処理しない範囲も、二重に処理する範囲も作らない）。
 */
function takeDeferredEdits_() {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  var keys = Object.keys(all).filter(function (k) { return k.indexOf(DEFERRED_EDIT_PREFIX_) === 0; });
  if (!keys.length) return [];
  console.warn('後回しにした編集を反映する: ' + keys.map(function (k) { return all[k]; }).join(' '));
  var taken = [];
  for (var i = 0; i < keys.length; i++) {
    try {
      props.deleteProperty(keys[i]);
    } catch (err) {
      console.error(err);
      break;
    }
    try { taken.push(JSON.parse(all[keys[i]])); } catch (err) { /* 壊れた値は捨てる */ }
  }
  return taken;
}

/**
 * 台帳の所有者（OWNER_EMAIL）として動いているか。保護列に書けるかは、実行している人の権限で決まるので
 * getEffectiveUser を見る（assertOwner_ はメニューを押した人を見るので getActiveUser）。
 */
function runningAsOwner_() {
  var owner = PropertiesService.getScriptProperties().getProperty('OWNER_EMAIL');
  return !owner || Session.getEffectiveUser().getEmail() === owner;
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

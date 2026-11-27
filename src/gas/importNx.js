/** 受け取りフォルダの未処理xlsxをすべて取り込む（メニューから）。 */
function importNxFromInbox() {
  assertOwner_();
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) throw new Error('ほかの処理が実行中です。少し待ってからやり直してください');
  try { importNxFromInboxLocked_(); } finally { lock.releaseLock(); }
}

function importNxFromInboxLocked_() {
  var props = PropertiesService.getScriptProperties();
  var inbox = DriveApp.getFolderById(getConfig_('NX_INBOX_FOLDER_ID'));
  var done = getOrCreateSubfolder_(inbox, '処理済');
  var files = inbox.getFilesByType(MimeType.MICROSOFT_EXCEL);
  var n = 0;
  while (files.hasNext()) {
    var f = files.next();
    importNxFile(f.getId());
    f.moveTo(done);
    n++;
  }
  SpreadsheetApp.getActive().toast(n + '件のファイルを取り込みました', '統合台帳');
}

/** xlsx 1ファイルを変換して取り込む。 */
function importNxFile(fileId) {
  var src = DriveApp.getFileById(fileId);
  var copy = Drive.Files.copy({ title: '[tmp] ' + src.getName(), mimeType: MimeType.GOOGLE_SHEETS }, fileId, { convert: true });
  var now = new Date();
  var log = { file: src.getName(), shipIns: 0, shipUpd: 0, lineIns: 0, lineUpd: 0, flags: 0, warnings: [] };
  try {
    var tmp = SpreadsheetApp.openById(copy.id);
    tmp.getSheets().forEach(function (sh) {
      if (sh.getName().indexOf('発') < 0) return;
      var parsed = parseNxSheet(sh.getDataRange().getValues(), sh.getName());
      log.warnings = log.warnings.concat(parsed.warnings);
      applyNxParsed_(parsed, now, log);
    });
  } finally {
    DriveApp.getFileById(copy.id).setTrashed(true);
  }
  appendImportLog_(now, log);
}

function applyNxParsed_(parsed, now, log) {
  var ships = readObjects_('shipments');
  var su = upsertShipments(ships, parsed.shipments, now);
  applyUpdates_('shipments', ships, su.updates);
  su.inserts.forEach(function (s) { s.書類フォルダURL = ensureShipmentFolder_(s); });
  appendRowObjects_('shipments', su.inserts);
  log.shipIns += su.inserts.length; log.shipUpd += su.updates.length;

  var idByKey = new Map();
  ships.concat(su.inserts).forEach(function (s) { if (s.NX便キー) idByKey.set(s.NX便キー, s.便ID); });
  var lines = readObjects_('shipLines');
  var lu = upsertShipLines(lines, parsed.shipLines, idByKey);
  applyUpdates_('shipLines', lines, lu.updates);
  lu.stale.forEach(function (r) { log.warnings.push('NXの表から消えた出荷明細: ' + r.出荷明細ID + ' ' + r.品目テキスト + (r.紐付状態 === '確定' ? '（確定済み・要確認）' : '')); });

  var shipperById = {};
  ships.concat(su.inserts).forEach(function (s) { shipperById[s.便ID] = s.shipper; });
  var input = readObjects_('input'), receipts = readObjects_('receipts');
  var backlog = computeBacklog(input, receipts);
  var suppliers = readObjects_('mSuppliers'), items = readObjects_('mItems');
  lu.inserts.forEach(function (r) {
    if (r.数量 === '') return;
    var c = matchCandidates(r._item, shipperById[r.便ID], input, backlog, suppliers, items);
    r.候補 = c.map(function (x) { return x.明細ID + '(' + x.score + ')'; }).join(', ');
    if (c.length && c[0].score === 100) { r.明細ID = c[0].明細ID; r.紐付状態 = '候補あり'; }
  });
  appendRowObjects_('shipLines', lu.inserts);
  var allLines = readObjects_('shipLines');
  applyUpdates_('receipts', receipts, receiptPlanUpdates(allLines, receipts));
  log.lineIns += lu.inserts.length; log.lineUpd += lu.updates.length;
  log.flags += lu.inserts.filter(function (r) { return r.要確認; }).length;
}

function applyUpdates_(key, existing, updates) {
  if (!updates.length) return;
  var idField = SHEETS[key].key;
  var rowById = {};
  existing.forEach(function (r, i) { rowById[r[idField]] = i; });
  updates.forEach(function (u) {
    var i = rowById[u.id];
    if (i === undefined) return;
    Object.assign(existing[i], u.changes);
    writeChanges_(key, i + 2, u.changes);
  });
}

function ensureShipmentFolder_(s) {
  var rootId = getConfig_('CUSTOMS_ROOT_FOLDER_ID');
  return getOrCreateSubfolder_(DriveApp.getFolderById(rootId), shipmentFolderName(s)).getUrl();
}

function getOrCreateSubfolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function appendImportLog_(now, log) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName('取込ログ') || ss.insertSheet('取込ログ');
  if (sh.getLastRow() === 0) sh.appendRow(['日時', 'ファイル', '便 追加', '便 更新', '出荷明細 追加', '出荷明細 更新', '要確認', '警告']);
  sh.appendRow([now, log.file, log.shipIns, log.shipUpd, log.lineIns, log.lineUpd, log.flags, log.warnings.join('\n')]);
}

/** 便シートの手入力行に便IDを振る。 */
function handleShipmentEdit_(sheet, startRow, numRows) {
  var all = readObjects_('shipments');
  var ids = all.map(function (r) { return r.便ID; }).filter(Boolean);
  var target = all.slice(startRow - 2, startRow - 2 + numRows);
  var out = assignShipmentIds(target.map(function (r) { return r['H B/L'] || r.shipper ? r : Object.assign({}, r, { 便ID: r.便ID || '__skip__' }); }), ids)
    .map(function (r) { return r.便ID === '__skip__' ? Object.assign({}, r, { 便ID: '' }) : r; });
  writeRowObjects_('shipments', startRow, out);
}

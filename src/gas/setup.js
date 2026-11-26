/** 統合台帳のシートを作る。何度実行しても壊れない。 */
function setupLedger() {
  var ss = SpreadsheetApp.getActive();
  Object.keys(SHEETS).forEach(function (k) {
    var def = SHEETS[k];
    var sh = ss.getSheetByName(def.name);
    if (!sh) {
      sh = ss.insertSheet(def.name);
      sh.getRange(1, 1, 1, def.headers.length).setValues([def.headers]).setFontWeight('bold');
      sh.setFrozenRows(1);
    } else {
      var cur = sh.getRange(1, 1, 1, def.headers.length).getValues()[0];
      if (cur.join('\t') !== def.headers.join('\t')) throw new Error(def.name + ' の見出しが定義と違います');
    }
    applyValidation_(sh, k);
    protectColumns_(sh, k);
  });
  ensureTriggers_();
}

function applyValidation_(sh, key) {
  var def = SHEETS[key];
  Object.keys(ENUMS).forEach(function (h) {
    var i = def.headers.indexOf(h);
    if (i < 0) return;
    var rule = SpreadsheetApp.newDataValidation().requireValueInList(ENUMS[h], true).setAllowInvalid(false).build();
    sh.getRange(2, i + 1, sh.getMaxRows() - 1, 1).setDataValidation(rule);
  });
}

function protectColumns_(sh, key) {
  var def = SHEETS[key];
  var me = Session.getEffectiveUser();
  var existing = sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).map(function (p) { return p.getDescription(); });
  def.protected.forEach(function (h) {
    var desc = 'auto:' + key + ':' + h;
    if (existing.indexOf(desc) >= 0) return;
    var col = def.headers.indexOf(h) + 1;
    var p = sh.getRange(1, col, sh.getMaxRows(), 1).protect().setDescription(desc);
    p.addEditor(me);
    p.removeEditors(p.getEditors().filter(function (u) { return u.getEmail() !== me.getEmail(); }));
    if (p.canDomainEdit()) p.setDomainEdit(false);
  });
}

function ensureTriggers_() {
  var names = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  if (names.indexOf('renderViews') < 0) ScriptApp.newTrigger('renderViews').timeBased().everyHours(1).create();
  if (names.indexOf('onEditInstalled') < 0) ScriptApp.newTrigger('onEditInstalled').forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
}

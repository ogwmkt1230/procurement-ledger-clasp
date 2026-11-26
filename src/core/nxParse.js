var CONTAINER_RE_ = /[A-Z]{4}\d{7}/;

function z2h_(s) {
  return String(s).replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
    .replace(/[：]/g, ':').replace(/[；]/g, ';').replace(/[，]/g, ',').replace(/　/g, ' ');
}

/** Excelシリアル値・'2026/12/1(...)'・'12/7\n(...)' を日付に。読めなければ null。 */
function parseLooseDate(v, refYear) {
  if (v instanceof Date) return v;
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(1899, 11, 30 + Math.floor(v));
  if (v === null || v === undefined) return null;
  var s = z2h_(v).trim();
  var m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})(?!\d)/);
  if (m && refYear) return new Date(refYear, +m[1] - 1, +m[2]);
  return null;
}

/** 対象商品のテキスト → 品目と数量。コンテナ番号があればその品目に付ける。 */
function parseItemText(text) {
  var items = [], unreadable = [], current = '';
  String(text || '').split(/\r?\n/).forEach(function (raw) {
    var line = z2h_(raw).replace(/["”]/g, '').trim();
    if (!line) return;
    var cm = line.match(CONTAINER_RE_);
    var container = cm ? cm[0] : '';
    var rest = line.replace(/^[＊*]\s*/, '');
    if (container) {
      rest = rest.replace(new RegExp(container + '(\\(\\d+\\))?\\s*[:;]?\\s*'), '').replace(/\s*[:;]\s*$/, '').trim();
      if (!rest) { current = container; return; }
    }
    var m = rest.match(/^(.+?)\s*[:;]\s*([\d,]+)\s*$/);
    if (!m || /^[\d\s]+$/.test(m[1])) { unreadable.push(raw.trim()); return; }
    items.push({ name: m[1].trim(), qty: Number(m[2].replace(/,/g, '')), container: container || current });
  });
  return { items: items, unreadable: unreadable };
}

function parseStatusMemos(memos, refYear) {
  var out = { 輸入許可日: null, 倉庫連絡日: null, 納品確認日: null };
  (memos || []).forEach(function (m) {
    var s = z2h_(m || '');
    var d = parseLooseDate(s, refYear);
    if (!d) return;
    if (/輸入許可/.test(s)) out.輸入許可日 = d;
    else if (/ロジスコ連絡|倉庫連絡/.test(s)) out.倉庫連絡日 = d;
    else if (/納品確認/.test(s)) out.納品確認日 = d;
  });
  return out;
}

function str_(v) { return v === null || v === undefined ? '' : String(v).trim(); }

/** NXのスケジュール表1シート分の値 → 便と出荷明細。 */
function parseNxSheet(values, origin) {
  var warnings = [], shipments = [], shipLines = [];
  var hi = -1;
  for (var i = 0; i < values.length; i++) {
    var joined = values[i].map(str_);
    if (joined.indexOf('shipper') >= 0 && joined.indexOf('H B/L NO') >= 0) { hi = i; break; }
  }
  if (hi < 0) return { shipments: [], shipLines: [], warnings: ['見出し行が見つかりません: ' + origin] };
  var head = values[hi].map(str_);
  var col = function (name) { return head.indexOf(name); };
  var memoCols = head.map(function (h, i) { return h === 'AIメモ' ? i : -1; }).filter(function (i) { return i >= 0; });
  var c = { no: 0, shipper: col('shipper'), inv: col('INV NO'), hbl: col('H B/L NO'), mbl: col('M B/L NO'), cont: col('コンテナNO'),
    type: col('コンテナタイプ'), vessel: col('VESSEL'), etd: col('ETD'), eta: col('ETA'), del: col('配達予定日'), dest: col('配達先'),
    nx: col('NX管理番号'), items: col('対象商品') };
  var cur = null;
  for (var r = hi + 1; r < values.length; r++) {
    var row = values[r];
    var get = function (k) { return c[k] >= 0 ? row[c[k]] : ''; };
    var no = str_(get('no')), shipper = str_(get('shipper'));
    if (no || shipper) {
      var etd = parseLooseDate(get('etd'));
      var status = parseStatusMemos(memoCols.map(function (i) { return row[i]; }), etd ? etd.getFullYear() : null);
      cur = { key: origin + '|' + (no || shipper + ':' + r), 発地: origin, shipper: shipper, 'INV NO': str_(get('inv')), 'H B/L': str_(get('hbl')),
        'M B/L': str_(get('mbl')), VESSEL: str_(get('vessel')), ETD: etd, ETA: parseLooseDate(get('eta')), NX管理番号: str_(get('nx')),
        輸入許可日: status.輸入許可日, 倉庫連絡日: status.倉庫連絡日 };
      shipments.push(cur);
    }
    if (!cur) continue;
    var cont = str_(get('cont')), text = str_(get('items'));
    if (!cont && !text) continue;
    var refYear = cur.ETD ? cur.ETD.getFullYear() : null;
    var delRaw = get('del');
    var base = { key: cur.key, 'H B/L': cur['H B/L'], コンテナNO: cont, コンテナタイプ: str_(get('type')),
      配達予定日: parseLooseDate(delRaw, refYear), 配達先名: str_(get('dest')) };
    var flags = [];
    if (!base.配達予定日) flags.push('配達予定日なし');
    if (!text) { shipLines.push(Object.assign({}, base, { 品目テキスト: '', items: [], 要確認: flags.concat(['品目なし']) })); continue; }
    var parsed = parseItemText(text);
    var byCont = {};
    parsed.items.forEach(function (it) { var k = it.container || cont; (byCont[k] = byCont[k] || []).push(it); });
    Object.keys(byCont).forEach(function (k) {
      shipLines.push(Object.assign({}, base, { コンテナNO: k, 品目テキスト: text, items: byCont[k], 要確認: flags.slice() }));
    });
    if (parsed.unreadable.length) {
      shipLines.push(Object.assign({}, base, { 品目テキスト: text, items: [], 要確認: flags.concat(['読めない品目: ' + parsed.unreadable.join(' / ')]) }));
      warnings.push(cur.key + ' 読めない品目 ' + parsed.unreadable.length + '行');
    }
  }
  return { shipments: shipments, shipLines: shipLines, warnings: warnings };
}

if (typeof module !== 'undefined') module.exports = { parseNxSheet: parseNxSheet, parseItemText: parseItemText, parseLooseDate: parseLooseDate, parseStatusMemos: parseStatusMemos };

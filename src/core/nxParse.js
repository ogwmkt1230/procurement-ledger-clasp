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

/** 対象商品のテキスト → 品目と数量。コンテナ番号があればその品目に付ける。
 *  品目の直後の「40：数量」「20：数量」はその品目のコンテナサイズ別内訳（breakdown）。 */
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
    var bm = rest.match(/^(20|40)\s*[:;]\s*([\d,]+)$/);
    if (bm && items.length) {
      var last = items[items.length - 1];
      (last.breakdown = last.breakdown || []).push({ size: bm[1], qty: Number(bm[2].replace(/,/g, '')) });
      return;
    }
    var m = rest.match(/^(.+?)\s*[:;]\s*([\d,]+)\s*$/);
    if (!m || /^[\d\s]+$/.test(m[1])) { unreadable.push(raw.trim()); return; }
    items.push({ name: m[1].trim(), qty: Number(m[2].replace(/,/g, '')), container: container || current });
  });
  return { items: items, unreadable: unreadable };
}

/** 年なしのM/Dが基準日より半年以上前なら翌年とみなす（12月出航→1月着など）。 */
function rollYear_(d, ref) {
  if (!d || !ref) return d;
  return d.getTime() < ref.getTime() - 180 * 864e5 ? new Date(d.getFullYear() + 1, d.getMonth(), d.getDate()) : d;
}

var MEMO_FIELDS_BY_POS_ = ['輸入許可日', '倉庫連絡日', '納品確認日'];

/** AIメモ列 → 日付。キーワードで振り分け、キーワードの無いメモ（打ち間違いなど）は列の位置で空いている項目に入れる。 */
function parseStatusMemos(memos, refYear, refDate) {
  var out = { 輸入許可日: null, 倉庫連絡日: null, 納品確認日: null }, loose = [];
  (memos || []).forEach(function (m, i) {
    var s = z2h_(m || '');
    var d = rollYear_(parseLooseDate(s, refYear), refDate);
    if (!d) return;
    if (/輸入許可/.test(s)) out.輸入許可日 = d;
    else if (/ロジスコ連絡|倉庫連絡/.test(s)) out.倉庫連絡日 = d;
    else if (/納品確認/.test(s)) out.納品確認日 = d;
    else loose.push({ field: MEMO_FIELDS_BY_POS_[i], date: d });
  });
  loose.forEach(function (x) { if (x.field && !out[x.field]) out[x.field] = x.date; });
  return out;
}

function containerSize_(type) { var m = String(type || '').match(/^\s*(20|40)F/i); return m ? m[1] : ''; }

/** 品目のサイズ別内訳を、同じ便のコンテナへサイズごとに行順で割り当てる。数が合わなければ割り当てず要確認。 */
function applyBreakdowns_(shipLines, contsByKey) {
  shipLines.forEach(function (line) {
    line.items.slice().forEach(function (it) {
      if (!it.breakdown) return;
      var bd = it.breakdown;
      delete it.breakdown;
      var bySize = {}, need = {}, sum = 0;
      (contsByKey[line.key] || []).forEach(function (c) { (bySize[c.size] = bySize[c.size] || []).push(c.cont); });
      bd.forEach(function (b) { need[b.size] = (need[b.size] || 0) + 1; sum += b.qty; });
      var sizes = Object.keys(bySize).concat(Object.keys(need));
      var fits = sum === it.qty && sizes.every(function (z) { return (bySize[z] || []).length === (need[z] || 0); });
      if (!fits) {
        line.要確認.push('内訳を割り当てられない: ' + it.name + ' ' + bd.map(function (b) { return b.size + ':' + b.qty; }).join(' / '));
        return;
      }
      line.items.splice(line.items.indexOf(it), 1);
      var used = {};
      bd.forEach(function (b) {
        var cont = bySize[b.size][used[b.size] = (used[b.size] || 0)];
        used[b.size]++;
        var target = shipLines.filter(function (l) { return l.key === line.key && l.コンテナNO === cont && !unreadable_(l); })[0];
        if (!target) return;
        target.items.push({ name: it.name, qty: b.qty, container: cont });
        target.要確認 = target.要確認.filter(function (f) { return f !== '品目なし'; });
      });
    });
  });
  shipLines.forEach(function (l) { if (!l.items.length && !unreadable_(l) && l.要確認.indexOf('品目なし') < 0) l.要確認.push('品目なし'); });
}
function unreadable_(line) { return line.要確認.some(function (f) { return f.indexOf('読めない品目') === 0; }); }

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
  var cur = null, contsByKey = {}, lastSize = '';
  for (var r = hi + 1; r < values.length; r++) {
    var row = values[r];
    var get = function (k) { return c[k] >= 0 ? row[c[k]] : ''; };
    var no = str_(get('no')), shipper = str_(get('shipper'));
    if (no || shipper) {
      var etd = parseLooseDate(get('etd'));
      var status = parseStatusMemos(memoCols.map(function (i) { return row[i]; }), etd ? etd.getFullYear() : null, etd);
      cur = { key: origin + '|' + (no || shipper + ':' + r), 発地: origin, shipper: shipper, 'INV NO': str_(get('inv')), 'H B/L': str_(get('hbl')),
        'M B/L': str_(get('mbl')), VESSEL: str_(get('vessel')), ETD: etd, ETA: parseLooseDate(get('eta')), NX管理番号: str_(get('nx')),
        輸入許可日: status.輸入許可日, 倉庫連絡日: status.倉庫連絡日 };
      shipments.push(cur);
      lastSize = '';
    }
    if (!cur) continue;
    var cont = str_(get('cont')), text = str_(get('items'));
    if (!cont && !text) continue;
    lastSize = containerSize_(get('type')) || lastSize;
    if (cont) (contsByKey[cur.key] = contsByKey[cur.key] || []).push({ cont: cont, size: lastSize });
    var refYear = cur.ETD ? cur.ETD.getFullYear() : null;
    var delRaw = get('del');
    var base = { key: cur.key, 'H B/L': cur['H B/L'], コンテナNO: cont, コンテナタイプ: str_(get('type')),
      配達予定日: rollYear_(parseLooseDate(delRaw, refYear), cur.ETD), 配達先名: str_(get('dest')) };
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
  applyBreakdowns_(shipLines, contsByKey);
  return { shipments: shipments, shipLines: shipLines, warnings: warnings };
}

if (typeof module !== 'undefined') module.exports = { parseNxSheet: parseNxSheet, parseItemText: parseItemText, parseLooseDate: parseLooseDate, parseStatusMemos: parseStatusMemos };

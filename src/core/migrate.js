if (typeof module !== 'undefined') { var parseLooseDate = require('./nxParse.js').parseLooseDate; }

function h_(s) { return String(s || '').replace(/\s/g, ''); }
function findCol_(header, names) {
  var hs = header.map(h_);
  for (var i = 0; i < names.length; i++) { var k = hs.indexOf(h_(names[i])); if (k >= 0) return k; }
  return -1;
}
function numOrBlank_(v) {
  var s = String(v === null || v === undefined ? '' : v).replace(/[,\s円¥]/g, '');
  if (s === '' || isNaN(Number(s))) return '';
  return Number(s);
}

function detectLayout(headerRow) {
  var hs = headerRow.map(h_);
  if (hs.some(function (h) { return /^単価(（ウォン）|（ドル）|（元）)$/.test(h); })) return 'overseas';
  if (hs.indexOf('発注数') < 0) return 'straine';
  return 'domestic';
}

function kindOf_(kindCell, name, content) {
  var all = [kindCell, name, content].join(' ');
  if (/金型/.test(all)) return '金型';
  if (/開発/.test(String(name) + String(content))) return '開発費';
  if (/販促/.test(kindCell)) return '販促物';
  if (/資材/.test(kindCell)) return '資材';
  if (/商品/.test(kindCell)) return '商品';
  return '';
}

function parseRemittances_(text, refYear, kind) {
  var out = [];
  String(text || '').split(/\r?\n/).forEach(function (line) {
    var m = line.match(/^\s*(\d{1,2}\/\d{1,2})\s*送金\s*[:：;；]\s*([\d,]+)\s*(箱)?/);
    if (!m) return;
    out.push({ 区分: kind + ' ' + m[2].replace(/\s/g, '') + '箱', 送金日: parseLooseDate(m[1], refYear), 金額外貨: '', 金額円: '' });
  });
  return out;
}

/** 旧ヨミ表の1行 → 明細・支払・警告。列は見出し名で引く。 */
function mapYomiRow(row, headerRow, ctx) {
  var layout = detectLayout(headerRow), warnings = [];
  var get = function (names) { var i = findCol_(headerRow, names); return i >= 0 ? row[i] : ''; };
  var name = String(get(['商品']) || '').trim(), content = String(get(['内容']) || '').trim();
  var due = parseLooseDate(String(get(['納期（予定）']) || '') + '/1');
  var ap = String(get(['稟議']) || '').match(/AP\d+/);
  if (!ap) ap = row.map(String).join(' ').match(/AP\d+/);
  var kind = kindOf_(String(get(['種別']) || ''), name, content);
  if (!kind) warnings.push('種別不明');
  var qty = layout === 'straine' ? '' : numOrBlank_(get(['発注数']));
  if (layout === 'straine') warnings.push('発注数なし：注文書から復元が必要');
  var price, currency = '円';
  if (layout === 'overseas') {
    var totalJpy = numOrBlank_(get(['合計金額（円）H欄×レート']));
    price = totalJpy !== '' && qty ? totalJpy / qty : '';
    warnings.push('外貨単価は合計金額から逆算');
  } else price = numOrBlank_(get(['単価']));
  var cancelled = /取消/.test(content + String(get(['メモ']) || ''));
  var line = { ブランド: ctx.ブランド, 仕入先コード: ctx.仕入先コード, 発注日: parseLooseDate(get(['発注日']), due ? due.getFullYear() : null) || '',
    稟議AP: ap ? ap[0] : '', 通貨: currency, 換算レート: '', 種別: kind, 商品コード: '', 品名: name || content.split('\n')[0],
    単価: price, 数量: qty, 納期予定月: due ? due.getFullYear() + '/' + ('0' + (due.getMonth() + 1)).slice(-2) : '',
    状態: cancelled ? '取消' : '発注中', メモ: '移行: 管理No.' + String(get(['管理　No.']) || '').trim() };
  var refYear = due ? due.getFullYear() : new Date().getFullYear();
  var payments = parseRemittances_(get(['支払い前金']), refYear, '前金')
    .concat(parseRemittances_(get(['支払い中間金']), refYear, '中間金'))
    .concat(parseRemittances_(get(['支払い後金']), refYear, '後金'));
  var unreceived = layout === 'straine' ? '' : numOrBlank_(get(['未納品']));
  var opening = null;
  if (qty !== '' && unreceived !== '' && qty - unreceived > 0) opening = { 実績数: qty - unreceived, 入荷日: '', 確認者: '移行時点の入荷済' };
  return { line: line, payments: payments, warnings: warnings, unreceived: unreceived === '' ? 0 : unreceived, layout: layout, openingReceipt: opening };
}

function selectOpenRows(mapped) {
  return mapped.filter(function (m) {
    if (m.line.状態 === '取消') return false;
    if (m.layout === 'straine') return !!(m.line.品名);
    return m.unreceived > 0;
  });
}

function alreadyMigrated(inputRows, brand) {
  return inputRows.some(function (r) { return r.ブランド === brand && String(r.メモ || '').indexOf('移行:') === 0; });
}

function reconcileBrand(oldTotal, ledgerTotal) {
  var diff = Math.abs(Number(oldTotal) - Number(ledgerTotal));
  return { ok: diff === 0, diff: diff };
}

if (typeof module !== 'undefined') module.exports = { alreadyMigrated: alreadyMigrated, detectLayout: detectLayout, mapYomiRow: mapYomiRow, selectOpenRows: selectOpenRows, reconcileBrand: reconcileBrand };

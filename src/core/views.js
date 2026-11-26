if (typeof module !== 'undefined') {
  var lineAmountJpy = require('./orders.js').lineAmountJpy;
  var shipmentStage = require('./shipments.js').shipmentStage;
}

function d_(v) { if (!v) return null; var d = v instanceof Date ? v : new Date(v); return isNaN(d.getTime()) ? null : d; }
function jpMonth_(d) { return d ? d.getFullYear() + '年' + (d.getMonth() + 1) + '月' : ''; }
function slashMonthToJp_(s) { var m = String(s || '').match(/(\d{4})\D+(\d{1,2})/); return m ? m[1] + '年' + Number(m[2]) + '月' : ''; }
function normMonth_(s) { var m = String(s || '').match(/(\d{4})\D+(\d{1,2})/); return m ? m[1] + '/' + ('0' + m[2]).slice(-2) : '未定'; }

function paymentStatus_(line, payments) {
  var mine = payments.filter(function (p) { return p.明細ID ? p.明細ID === line.明細ID : p.発注ID === line.発注ID; });
  if (!mine.length) return { text: '', allPaid: true };
  return { text: mine.map(function (p) { return p.区分 + (p.送金日 ? '済' : '未'); }).join('・'), allPaid: mine.every(function (p) { return !!p.送金日; }) };
}

function viewYomi(lines, backlog, payments) {
  var headers = ['ブランド', '仕入先コード', '発注ID', '明細ID', '種別', '品名', '発注数', '入荷済', '発注残', '金額(円)', '納期予定月', '支払', '状態', 'エラー'];
  var rows = lines.map(function (l) {
    var b = backlog.get(l.明細ID) || { ordered: 0, received: 0, remaining: 0, errors: [] };
    var p = paymentStatus_(l, payments || []);
    var st = l.状態 === '取消' ? '取消' : b.remaining === 0 && p.allPaid ? '完了' : '発注中';
    return [l.ブランド, l.仕入先コード, l.発注ID, l.明細ID, l.種別, l.品名, b.ordered, b.received, b.remaining, lineAmountJpy(l), l.納期予定月, p.text, st, b.errors.join(' / ')];
  });
  rows.sort(function (a, b) { return String(a[0] + a[1] + a[3]).localeCompare(String(b[0] + b[1] + b[3])); });
  return { headers: headers, rows: rows };
}

function viewBacklogByMonth(lines, backlog) {
  var months = {}, cells = {};
  lines.forEach(function (l) {
    var b = backlog.get(l.明細ID);
    if (!b || b.remaining <= 0) return;
    var total = lineAmountJpy(l), qty = Number(l.数量);
    if (total === null || !qty) return;
    var m = normMonth_(l.納期予定月);
    months[m] = true;
    var k = l.ブランド + '|' + (l.会計区分 || '要確認');
    cells[k] = cells[k] || {};
    cells[k][m] = (cells[k][m] || 0) + Math.round(total / qty * b.remaining);
  });
  var ms = Object.keys(months).sort();
  return { headers: ['ブランド', '会計区分'].concat(ms), rows: Object.keys(cells).sort().map(function (k) {
    var p = k.split('|');
    return [p[0], p[1]].concat(ms.map(function (m) { return cells[k][m] || 0; }));
  }) };
}

function viewInTransit(shipments, shipLines, receipts, today) {
  var headers = ['便ID', '段階', '発地', 'shipper', 'H B/L', 'ETD', 'ETA', '輸入許可日', '倉庫連絡日', '品目', '書類フォルダURL'];
  var rows = [];
  shipments.forEach(function (s) {
    var st = shipmentStage(s, shipLines, receipts, today);
    if (st === '納品済') return;
    var items = shipLines.filter(function (l) { return l.便ID === s.便ID; }).map(function (l) { return l.品目テキスト; }).filter(Boolean).join('\n');
    rows.push([s.便ID, st, s.発地, s.shipper, s['H B/L'], s.ETD, s.ETA, s.輸入許可日, s.倉庫連絡日, items, s.書類フォルダURL]);
  });
  rows.sort(function (a, b) { return (d_(a[6]) || 0) - (d_(b[6]) || 0); });
  return { headers: headers, rows: rows };
}

function viewReceiptPlan(receipts, lines, items) {
  var byLine = {};
  lines.forEach(function (l) { byLine[l.明細ID] = l; });
  var headers = ['元々納品月', '実際納品月', '商品名', '商品コード', '入荷予定日', '入荷予定数', '納品場所', 'ブランド', '明細ID', '便ID', '入荷ID'];
  var rows = receipts.filter(function (r) { return r.実績数 === '' || r.実績数 === null || r.実績数 === undefined; }).map(function (r) {
    var l = byLine[r.明細ID] || {};
    var d = d_(r.入荷予定日);
    return [slashMonthToJp_(l.納期予定月), jpMonth_(d), l.品名 || '', l.商品コード || '', d || '', r.予定数, r.納品場所 || '', l.ブランド || '', r.明細ID, r.便ID || '', r.入荷ID || ''];
  });
  rows.sort(function (a, b) { return (d_(a[4]) || Infinity) - (d_(b[4]) || Infinity); });
  return { headers: headers, rows: rows };
}

function viewMismatch(lines, receipts, shipLines, backlog, today) {
  var headers = ['種類', '対象ID', '内容'];
  var rows = [], byLine = {};
  lines.forEach(function (l) { byLine[l.明細ID] = l; });
  receipts.forEach(function (r) {
    var l = byLine[r.明細ID];
    if (l && (l.通貨 === '円' || !l.通貨) && r.納品書単価 !== '' && r.納品書単価 !== undefined && Number(r.納品書単価) !== Number(l.単価))
      rows.push(['単価差', r.入荷ID, '納品書 ' + r.納品書単価 + ' / 明細 ' + l.単価]);
    if (r.納品書数量 !== '' && r.納品書数量 !== undefined && r.実績数 !== '' && Number(r.納品書数量) !== Number(r.実績数))
      rows.push(['数量差', r.入荷ID, '納品書 ' + r.納品書数量 + ' / 実績 ' + r.実績数]);
  });
  backlog.forEach(function (b, id) { b.errors.forEach(function (e) { rows.push([e, id, '発注 ' + b.ordered + ' / 入荷 ' + b.received]); }); });
  var limit = new Date(today.getTime() - 14 * 864e5);
  shipLines.forEach(function (s) {
    var d = d_(s.配達予定日);
    if (s.紐付状態 === '未紐付' && d && d <= limit) rows.push(['未紐付14日超', s.出荷明細ID, s.品目テキスト || '']);
  });
  return { headers: headers, rows: rows };
}

if (typeof module !== 'undefined') module.exports = { viewYomi: viewYomi, viewBacklogByMonth: viewBacklogByMonth, viewInTransit: viewInTransit, viewReceiptPlan: viewReceiptPlan, viewMismatch: viewMismatch };

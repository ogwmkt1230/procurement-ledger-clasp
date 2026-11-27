/** 統合台帳のシート定義。列見出しは他モジュールが名前で参照する。 */
var SHEETS = {
  input: { name: '発注明細入力', key: '明細ID',
    headers: ['明細ID','発注ID','ブランド','仕入先コード','発注日','稟議AP','通貨','換算レート','支払条件','種別','商品コード','品名','単価','仕入先単位','入数','数量','金額(円)','会計区分','納期予定月','状態','メモ','要確認'],
    required: ['ブランド','仕入先コード','発注日','種別','数量'],
    protected: ['明細ID','発注ID','金額(円)','会計区分','要確認'] },
  orders: { name: '発注', key: '発注ID',
    headers: ['発注ID','ブランド','仕入先コード','発注日','稟議AP','通貨','換算レート','支払条件'],
    required: [], protected: ['発注ID'] },
  shipments: { name: '便', key: '便ID',
    headers: ['便ID','NX便キー','取込元','発地','shipper','INV NO','H B/L','M B/L','VESSEL','ETD','ETA','NX管理番号','輸入許可日','倉庫連絡日','書類フォルダURL','取込日時'],
    required: ['H B/L'], protected: ['便ID','取込日時'] },
  shipLines: { name: '出荷明細', key: '出荷明細ID',
    headers: ['出荷明細ID','便ID','コンテナNO','コンテナタイプ','品目テキスト','数量','配達予定日','配達先コード','明細ID','紐付状態','候補','要確認'],
    required: ['便ID'], protected: ['出荷明細ID','品目テキスト'] },
  receipts: { name: '入荷', key: '入荷ID',
    headers: ['入荷ID','明細ID','便ID','入荷予定日','予定数','納品場所','入荷日','実績数','賞味期限','品質コード','納品書日付','納品書単価','納品書数量','納品書金額','COOOLa登録','入荷報告メール','確認者'],
    required: ['明細ID'], protected: ['入荷ID'] },
  payments: { name: '支払', key: '支払ID',
    headers: ['支払ID','発注ID','明細ID','区分','予定日','金額外貨','金額円','送金日','稟議AP'],
    required: ['発注ID'], protected: ['支払ID'] },
  mItems: { name: '商品マスタ', key: '商品コード', headers: ['商品コード','品名','ブランド','別名'], required: [], protected: [] },
  mSuppliers: { name: '仕入先マスタ', key: '仕入先コード', headers: ['仕入先コード','仕入先名','ブランド','国内海外','通貨','支払条件','shipper別名'], required: [], protected: [] },
  mKinds: { name: '種別マスタ', key: '種別', headers: ['種別','会計区分','仕入先コード'], required: [], protected: [] }, // 仕入先コードが空の行は全仕入先の既定。種別は仕入先ごとの例外行で重複しうる
  mDest: { name: '配達先マスタ', key: '配達先コード', headers: ['配達先コード','名称','住所','別名'], required: [], protected: [] },
};

var ENUMS = {
  ブランド: ['Yunth','Brighte','Straine','LOEM'],
  通貨: ['円','ドル','元','ウォン'],
  種別: ['商品','資材','販促物','開発費','金型'],
  状態: ['発注中','完了','取消'],
  紐付状態: ['未紐付','候補あり','確定'],
};

function colIndex(sheetKey, header) {
  var s = SHEETS[sheetKey];
  if (!s) throw new Error('unknown sheet: ' + sheetKey);
  var i = s.headers.indexOf(header);
  if (i < 0) throw new Error('unknown header: ' + sheetKey + '.' + header);
  return i;
}

/** 二次元配列（見出し行なし）を見出し名キーのオブジェクト配列に。 */
function rowsToObjects(sheetKey, values) {
  var h = SHEETS[sheetKey].headers;
  return values.map(function (r) { var o = {}; h.forEach(function (k, i) { o[k] = r[i] === undefined ? '' : r[i]; }); return o; });
}
function objectToRow(sheetKey, obj) {
  return SHEETS[sheetKey].headers.map(function (k) { return obj[k] === undefined || obj[k] === null ? '' : obj[k]; });
}

if (typeof module !== 'undefined') module.exports = { SHEETS: SHEETS, ENUMS: ENUMS, colIndex: colIndex, rowsToObjects: rowsToObjects, objectToRow: objectToRow };

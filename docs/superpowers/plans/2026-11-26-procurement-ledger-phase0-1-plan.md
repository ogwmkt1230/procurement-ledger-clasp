# 統合台帳（発注・輸送・入荷）第0〜1段階 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新しい「統合台帳」スプシとそれに紐づくGASを作り、商品担当がスプシで直接発注を入力し、NXのxlsx取り込み・発注残・入荷予定・ヨミ表ビューが自動で出る状態（設計書の第0〜1段階）にする。

**Architecture:** 統合台帳スプシにコンテナバインドしたGASプロジェクトをclaspで管理する。計算・解析・照合は副作用のない純粋関数（`src/core/`）に置いてNodeでテストし、スプシ・Drive・トリガーを触る薄い層（`src/gas/`）から呼ぶ。全ファイルはGASのグローバルスコープで共有され、Nodeでは末尾の `module.exports` ガードで読み込む。

**Tech Stack:** Google Apps Script（V8）、clasp、Node 20 の `node:test`（依存パッケージなし）、Drive API 高度なサービス（xlsx→スプシ変換）。

**Spec:** 発注・輸送・入荷 統合台帳 設計書 — https://claude.ai/artifact/DoQV6iemaHVWCacYW58o81

**範囲外（別の計画にする）:** 第2段階のGAS入力画面と毎朝チェック通知、第3段階（BJC）。第1段階の関門「発注残が旧表と一致」を通ってから計画する。

## Global Constraints

- ID：発注ID = `PO-YYMM-連番3桁`、明細ID = `発注ID-枝番2桁`（例 `PO-2611-003-02`）、便ID = `SH-YYMM-連番3桁`。採番はGASが行い、人は打たない
- 通貨は 円・ドル・元・ウォン。外貨は明細行ごとに発注時の換算レートを持つ
- 数量の単位は「倉庫で数える単位（入荷実績と同じ）」。仕入先の単位と入数は別列
- 種別：商品／資材／販促物／開発費／金型。会計区分（商品原価／固定資産／費用）は仕入先・種別マスタの設定で決まり、金型は固定資産として商品原価と集計を分ける
- 対象：Yunth・Brighte・Straine と、04.商品入荷のLOEM分。PROTEINは対象外で04に残す
- 便と出荷明細はNX取り込みと手入力の両方で登録できる（NX以外のフォワーダーがあるため）
- 入荷はすべて倉庫でめぐさんが記録する。支払の予定と実績は商品担当が書く
- 04.商品入荷の入荷予定メール下書きとカレンダー自動登録を止めない
- 新旧の台帳を並行させない。切替日に旧ヨミ表と04の移行済みタブを閲覧専用にする
- 発注入力にGoogleフォームは使わない
- 紐付候補は外部AIを使わず、ルール（shipper・INV・品名辞書）で出す

## Review Focus

1. 同じNXファイルを2回取り込んだ／更新版を取り込んだ → 便・出荷明細が重複せず、変わった項目だけ更新される（Task 7）
2. 「対象商品」の表記ゆれ（全角数字「240０」、区切り「：」「;」「；」、数量なしの行、複数行）→ 読めた行は取り込み、読めない行は「要確認」として残し、取り込み全体は止めない（Task 6）
3. 配達予定日が文章（「2026/12/1(10t車)」「12/7\n(10t車x2…)」「未定」、空欄）→ 読める日付は日付に、読めなければ空欄＋要確認（Task 6）
4. 過納（発注数を超える入荷）や取消済み明細への入荷 → 発注残はマイナスにせず0で止め、明細に「過納」「取消後入荷」のエラーを出す（Task 4）
5. 外貨の明細でレートが空 → 円金額は0ではなく空欄にし、要確認にする（Task 3）

---

## ファイル構成

```
procurement-ledger-clasp/
  .clasp.json            # 統合台帳スプシにバインド
  appsscript.json        # V8、Drive API v2 高度なサービス、タイムゾーン Asia/Tokyo
  package.json           # "test": "node --test tests/"
  src/core/schema.js     # シート名・列見出し・必須列・保護列の定義
  src/core/ids.js        # 採番
  src/core/orders.js     # 入力行 → 発注／明細、金額・会計区分
  src/core/backlog.js    # 発注残・輸送中・過納判定
  src/core/nxParse.js    # NXシートの値 → 便・出荷明細行
  src/core/shipments.js  # 便のupsert、紐付候補、入荷予定生成、段階判定
  src/core/migrate.js    # 旧ヨミ表タブ → 明細・入荷・支払、照合
  src/core/views.js      # 各ビューの行生成
  src/gas/setup.js       # setupLedger()
  src/gas/triggers.js    # onEdit採番、メニュー
  src/gas/importNx.js    # xlsx変換・取り込み・フォルダ作成
  src/gas/migrateRun.js  # 旧シートからの移行実行
  src/gas/renderViews.js # ビューの書き出し
  tests/*.test.js        # src/core ごとに1ファイル
  docs/04-automation-notes.md
```

`src/core/*.js` の末尾は共通で `if (typeof module !== 'undefined') module.exports = { … };`。テストは `const { fn } = require('../src/core/xxx.js')`。

---

### Task 1: プロジェクト雛形と台帳スキーマ

**Files:**
- Create: `package.json`, `appsscript.json`, `.clasp.json`, `src/core/schema.js`, `src/gas/setup.js`
- Test: `tests/schema.test.js`

**Interfaces:**
- Produces: `SHEETS`（シート名→`{ name, headers: string[], key: string, required: string[], protected: string[] }`）、`colIndex(sheetKey: string, header: string) -> number`（0始まり、無ければ例外）、`setupLedger()`（GAS）

シート（`SHEETS` のキーと見出し。列名の細部は設計書どおり作り手に任せるが、下記の見出しは他タスクが参照するので固定）：

| キー | シート名 | key列 | 他タスクが参照する見出し |
|---|---|---|---|
| input | 発注明細入力 | 明細ID | 明細ID, 発注ID, ブランド, 仕入先コード, 発注日, 稟議AP, 通貨, 換算レート, 支払条件, 種別, 商品コード, 品名, 単価, 仕入先単位, 入数, 数量, 金額(円), 会計区分, 納期予定月, 状態, メモ, 要確認 |
| orders | 発注 | 発注ID | 発注ID, ブランド, 仕入先コード, 発注日, 稟議AP, 通貨, 換算レート, 支払条件 |
| shipments | 便 | 便ID | 便ID, 取込元, 発地, shipper, INV NO, H B/L, M B/L, VESSEL, ETD, ETA, NX管理番号, 輸入許可日, 倉庫連絡日, 書類フォルダURL, 取込日時 |
| shipLines | 出荷明細 | 出荷明細ID | 出荷明細ID, 便ID, コンテナNO, コンテナタイプ, 品目テキスト, 数量, 配達予定日, 配達先コード, 明細ID, 紐付状態, 要確認 |
| receipts | 入荷 | 入荷ID | 入荷ID, 明細ID, 便ID, 入荷予定日, 予定数, 納品場所, 入荷日, 実績数, 賞味期限, 品質コード, 納品書日付, 納品書単価, 納品書数量, 納品書金額, COOOLa登録, 入荷報告メール, 確認者 |
| payments | 支払 | 支払ID | 支払ID, 発注ID, 明細ID, 区分, 予定日, 金額外貨, 金額円, 送金日, 稟議AP |
| mItems | 商品マスタ | 商品コード | 商品コード, 品名, ブランド, 別名 |
| mSuppliers | 仕入先マスタ | 仕入先コード | 仕入先コード, 仕入先名, ブランド, 国内海外, 通貨, 支払条件, shipper別名 |
| mKinds | 種別マスタ | 種別 | 種別, 会計区分 |
| mDest | 配達先マスタ | 配達先コード | 配達先コード, 名称, 住所 |

`紐付状態` の値は `未紐付`／`候補あり`／`確定`。`状態` の値は `発注中`／`完了`／`取消`。

- [ ] **Step 1: テストを書く** — `tests/schema.test.js`
  - `schema: 全シートでheadersが重複しない`：各 `SHEETS[k].headers` の長さ＝Set の大きさ
  - `schema: key・required・protectedはheadersに含まれる`
  - `schema: colIndex('input','明細ID') === 0` と `colIndex('input','存在しない')` が throw する
- [ ] **Step 2: 実行して失敗を確認** — `npm test`、期待：`Cannot find module '../src/core/schema.js'`
- [ ] **Step 3: `schema.js` を実装** — 上の表のとおり `SHEETS` と `colIndex`。`input` の protected は `明細ID, 発注ID, 金額(円), 会計区分, 要確認`。`shipLines` の protected は `出荷明細ID, 品目テキスト`。
- [ ] **Step 4: `npm test` で通ることを確認**
- [ ] **Step 5: `setupLedger()` を実装** — シートが無ければ作って1行目に見出しを書き、2行目以降の固定、protected列の範囲保護（編集者：スクリプト所有者のみ）、`ブランド`（Yunth/Brighte/Straine/LOEM）・`通貨`（円/ドル/元/ウォン）・`種別`・`状態`・`紐付状態` のプルダウンを入れる。再実行しても壊れない（既存シートは見出しを確かめるだけ）
- [ ] **Step 6: 手動確認** — `clasp push` のあと空のスプシで `setupLedger()` を2回実行し、10シートができて見出しが1回だけ書かれていることを見る
- [ ] **Step 7: コミット** — `git commit -m "feat: ledger schema and setup"`

---

### Task 2: 採番

**Files:**
- Create: `src/core/ids.js`, `src/gas/triggers.js`
- Test: `tests/ids.test.js`

**Interfaces:**
- Consumes: `SHEETS`, `colIndex`（Task 1）
- Produces: `nextSerialId(prefix: 'PO'|'SH', date: Date, existingIds: string[]) -> string`、`lineId(orderId: string, branch: number) -> string`、`onEdit(e)`（GAS、Task 3 の `assignOrderIds` を呼ぶ）

- [ ] **Step 1: テストを書く**
  - `nextSerialId('PO', new Date('2026-11-05'), []) === 'PO-2611-001'`
  - `nextSerialId('PO', 2026-11, ['PO-2611-001','PO-2611-007','PO-2610-099']) === 'PO-2611-008'`（同じ月の最大＋1、他の月は無視）
  - `nextSerialId('SH', 2026-12, ['SH-2611-004']) === 'SH-2612-001'`
  - `lineId('PO-2611-003', 2) === 'PO-2611-003-02'`
  - 月999件超えは throw する
- [ ] **Step 2: 失敗を確認** — `npm test`
- [ ] **Step 3: `ids.js` を実装** — 月は Asia/Tokyo 基準で `YYMM`（`Utilities` を使わず、`date.getFullYear()` と `getMonth()` で作る。GASのタイムゾーンは appsscript.json で固定済み）
- [ ] **Step 4: 通ることを確認**
- [ ] **Step 5: `triggers.js` に `onEdit(e)` と `onOpen()` を実装** — `onEdit` は 発注明細入力・便・出荷明細 シートの編集行だけを対象にして Task 3／Task 7 の採番関数を呼ぶ。`onOpen` はメニュー「統合台帳」（NX取り込み／ビュー更新／移行）を追加する。`LockService` で同時編集時の二重採番を防ぐ
- [ ] **Step 6: コミット**

---

### Task 3: 入力行から発注・明細を作る、金額と会計区分

**Files:**
- Create: `src/core/orders.js`
- Test: `tests/orders.test.js`

**Interfaces:**
- Consumes: `nextSerialId`, `lineId`（Task 2）
- Produces:
  - `orderGroupKey(row) -> string` = `仕入先コード|発注日(yyyy-mm-dd)|稟議AP`
  - `assignOrderIds(rows: Row[], existingOrderIds: string[]) -> Row[]`（明細ID・発注IDが空の行にだけ振る。同じ group key の行は同じ発注IDで、枝番は既存の最大＋1）
  - `lineAmountJpy(row) -> number|null`
  - `accountingClass(kind: string, kindMaster: {種別,会計区分}[]) -> string`
  - `validateInputRow(row) -> string[]`（要確認メッセージ）
  - `toOrderRecords(rows) -> Order[]`（group key ごとに1件）
  - Row = 見出しをキーにしたオブジェクト

- [ ] **Step 1: テストを書く**
  - `assignOrderIds`：同じ仕入先・同日・同じAPの2行 → `PO-2611-001-01` と `-02`。別APの行 → `PO-2611-002-01`。すでにIDがある行は変えない。既存発注 `PO-2611-001` に同じキーの新しい行が来たら `PO-2611-001-03`（既存の枝番が01・02のとき）
  - `lineAmountJpy`：`{通貨:'円', 単価:616, 数量:18710}` → 11525360。`{通貨:'ウォン', 単価:940, 数量:600000, 換算レート:0.11}` → 62040000（四捨五入で円単位）。`{通貨:'ドル', 単価:10, 数量:5, 換算レート:''}` → `null`（Review Focus 5）
  - `validateInputRow`：レート空の外貨行 → `['換算レート未入力']` を含む。数量が0以下、または数値でない → `'数量不正'`。ブランド・仕入先コード・種別・発注日のどれかが空 → `'必須項目未入力: <列名>'`
  - `accountingClass('金型', master) === '固定資産'`。マスタにない種別 → `'要確認'`
- [ ] **Step 2: 失敗を確認**
- [ ] **Step 3: `orders.js` を実装** — 金額は `Math.round(単価 × 数量 × (通貨==='円' ? 1 : 換算レート))`。`単価` は仕入先単位あたりなので、`入数` が入っていれば `単価 ÷ 入数 × 数量` で計算する（数量は倉庫単位）。このケースもテストを1本足す：`{通貨:'円', 単価:4000, 入数:4, 数量:100}` → 100000
- [ ] **Step 4: 通ることを確認**
- [ ] **Step 5: `triggers.js` から呼ぶ** — 編集行に `assignOrderIds` → `lineAmountJpy` → `accountingClass` → `validateInputRow` を適用し、`金額(円)`・`会計区分`・`要確認` を書く。`発注` シートは `toOrderRecords` で発注IDごとに upsert する
- [ ] **Step 6: 手動確認** — 入力シートに3行入れ、IDと金額が自動で入り、発注シートに2件できることを見る
- [ ] **Step 7: コミット**

---

### Task 4: 発注残・輸送中・過納判定

**Files:**
- Create: `src/core/backlog.js`
- Test: `tests/backlog.test.js`

**Interfaces:**
- Produces:
  - `computeBacklog(lines: Row[], receipts: Row[]) -> Map<明細ID, { ordered:number, received:number, remaining:number, errors:string[] }>`
  - `computeInTransit(shipLines: Row[], receipts: Row[]) -> Map<出荷明細ID, number>`（`確定` の出荷明細の数量から、同じ便ID×明細IDの入荷実績を引いた数）
  - `isLineOpen(line, backlogEntry, payments) -> boolean`（状態が `取消` でなく、残数>0 か、送金日が空の支払がある）

- [ ] **Step 1: テストを書く**
  - 分納：明細の数量150000、実績 26400／50563／68253 → `remaining === 4784`（iMINEのVAマスクの実例）
  - 過納：数量100、実績120 → `remaining === 0` かつ `errors` に `'過納'`（Review Focus 4）
  - 取消：`状態:'取消'` の明細に実績10 → `remaining === 0` かつ `errors` に `'取消後入荷'`
  - 実績数が空の入荷行（予定だけ）は received に数えない
  - `computeInTransit`：確定の出荷明細4800、同じ便の入荷実績2400 → 2400。`候補あり` の出荷明細は結果に含めない
  - `isLineOpen`：残数0でも、送金日が空の後金がある → true
- [ ] **Step 2: 失敗を確認**
- [ ] **Step 3: 実装**
- [ ] **Step 4: 通ることを確認**
- [ ] **Step 5: コミット**

---

### Task 5: NXシートの解析

**Files:**
- Create: `src/core/nxParse.js`
- Test: `tests/nxParse.test.js`, `tests/fixtures/nx-sample.json`（`スケジュール表 20261124.xlsx` の蛇口発 1〜8行目と釜山発 1〜11行目の値を、セルの値のまま二次元配列で保存。日付はシリアル値のまま）

**Interfaces:**
- Produces:
  - `parseNxSheet(values: any[][], origin: string) -> { shipments: NxShipment[], shipLines: NxShipLine[], warnings: string[] }`
  - `NxShipment = { 発地, shipper, 'INV NO', 'H B/L', 'M B/L', VESSEL, ETD: Date|null, ETA: Date|null, NX管理番号, 輸入許可日: Date|null, 倉庫連絡日: Date|null }`
  - `NxShipLine = { 'H B/L', コンテナNO, コンテナタイプ, 品目テキスト, items: {name:string, qty:number}[], 配達予定日: Date|null, 配達先名, 要確認: string[] }`
  - `parseItemText(text: string) -> { items: {name, qty}[], unreadable: string[] }`
  - `parseLooseDate(v, refYear: number) -> Date|null`
  - `parseStatusMemos(memos: string[], refYear) -> { 輸入許可日, 倉庫連絡日, 納品確認日 }`

ルール：
- 見出し行は `shipper` と `H B/L NO` を含む行。列は見出し名で探す（位置は固定しない）
- shipper が空の行は直前の便の続き（同じH B/L）。H B/L が空でコンテナNOがある行も続きとして扱う。どちらも空の行は捨てる
- 対象商品が空の続き行は、items を空にして要確認 `'品目なし'` を付ける
- AIメモ列は `M/D 輸入許可`（`許可書`・`許可証` を含む）→ 輸入許可日、`ロジスコ連絡` →倉庫連絡日、`納品確認` → 納品確認日。年は ETD の年を使う

- [ ] **Step 1: テストを書く**（fixture を使う）
  - 蛇口発：最初の便 `CANDMZ57065` からコンテナ3本（`OERU4213169`, `OOLU6261502`, `OOLU6484300`）が出て、2本目と3本目が同じH B/Lの続きになる
  - `parseItemText('白ドライヤー：2400\nモカドライヤー：2200')` → items 2件、qty 2400／2200
  - `parseItemText('ブルードライヤー；4800')`、`'青ブラシ；12800'`、`'ピンクブラシ： 5000'`、`'ピンクドライヤー：2400\nブルードライヤー：240０'`（全角０）→ qty はそれぞれ 4800／12800／5000／2400・2400
  - `parseItemText('黒ブラシ：10,000')` → 10000
  - 数量のない行 `'＊VA：76,963\n40：21,542'` → `VA` 76963 は読み、`40：21,542` は品名が数字だけなので unreadable に入る（Review Focus 2）
  - `parseLooseDate(46183)` → 2026-06-10（Excelのシリアル値）。`'2026/12/1(10t車)'` → 2026-12-01。`'12/7\n(10t車x2, 4t車x1)'`（refYear 2026）→ 2026-12-07。`'未定'`、`''`、`null` → null（Review Focus 3）
  - 釜山発の便 `SELDWB17811` の配達予定日が文章の行は、日付を読み、時刻の文章は要確認には入れない。配達予定日が空の続き行は `配達予定日:null` で要確認 `'配達予定日なし'`
  - `parseStatusMemos(['6/8 輸入許可証済','6/8 ロジスコ連絡済','6/10 納品確認済'], 2026)` → 2026-06-08／06-08／06-10。誤字 `'6/10 輸入気箇所済'` は輸入許可日 null（推測しない）
- [ ] **Step 2: 失敗を確認**
- [ ] **Step 3: 実装** — 全角数字・全角コロン・全角セミコロンは半角に直してから、行ごとに `^(.+?)\s*[:;]\s*([\d,]+)\s*$` で読む。品名が数字だけの行は unreadable
- [ ] **Step 4: 通ることを確認**
- [ ] **Step 5: コミット**

---

### Task 6: 紐付候補（ルール）

**Files:**
- Create: `src/core/shipments.js`（この Task では `matchCandidates` のみ）
- Test: `tests/shipments.match.test.js`

**Interfaces:**
- Consumes: `computeBacklog`（Task 4）、`NxShipLine`（Task 5）
- Produces: `matchCandidates(item: {name, qty}, shipper: string, openLines: Row[], backlog: Map, suppliers: Row[], items: Row[]) -> { 明細ID: string, score: number, reasons: string[] }[]`（score の降順、最大3件）

採点：仕入先一致（shipper が仕入先マスタの `shipper別名` のどれかを含む）＋50、品名一致（商品マスタの `品名` か `別名` のどれかを item.name が含む、または item.name がそれを含む）＋40、数量 ≤ 残数 ＋10。仕入先が一致しない明細は候補にしない。

- [ ] **Step 1: テストを書く**
  - shipper `MITMES`、仕入先マスタ `{仕入先コード:'S-MT', shipper別名:'MITMES|Shenzhen Mtimes'}`、商品マスタ `{商品コード:'YTH-260WH', 別名:'白ドライヤー|Boost MAX WHITE'}`、残数5000の明細 → item `白ドライヤー 4800` の候補1位がその明細で score 100
  - 残数3000なら score 90 で、reasons に `'数量が残数超過'`
  - shipper が `Dongguan Hiee Electronic` で、MITMES の明細しかない → 候補は空
  - 同じ品名の明細が2つ（納期の違う発注）→ 2件とも返り、納期予定月の早い方が先
- [ ] **Step 2: 失敗を確認**
- [ ] **Step 3: 実装**
- [ ] **Step 4: 通ることを確認**
- [ ] **Step 5: コミット**

---

### Task 7: 便のupsertとNX取り込みの実行

**Files:**
- Modify: `src/core/shipments.js`（`upsertShipments` と `upsertShipLines` を追加）
- Create: `src/gas/importNx.js`
- Test: `tests/shipments.upsert.test.js`

**Interfaces:**
- Consumes: `parseNxSheet`（Task 5）、`matchCandidates`（Task 6）、`nextSerialId`（Task 2）
- Produces:
  - `upsertShipments(existing: Row[], parsed: NxShipment[], now: Date) -> { inserts: Row[], updates: {便ID, changes: object}[] }`（キーは `H B/L`。新しい便には `SH-` の便IDを振る）
  - `upsertShipLines(existing: Row[], parsed: NxShipLine[], shipIdByHbl: Map) -> { inserts, updates }`（キーは `便ID＋コンテナNO＋品目テキストの行番号`。品目テキスト1行＝出荷明細1行）
  - `assignShipmentIds(rows: Row[], existingIds: string[]) -> Row[]`（手入力の便で便IDが空の行に `SH-` を振り、`取込元:'手入力'` を入れる。onEdit から呼ぶ）
  - `importNxFile(fileId: string)`（GAS）、`importNxFromInbox()`（GAS、メニューから呼ぶ）

- [ ] **Step 1: テストを書く**
  - 同じ parsed を2回 upsert → 2回目は inserts も updates も0件（Review Focus 1）
  - ETA だけ変わった parsed → updates が1件で、changes は `{ETA: …}` だけ
  - 人が手で確定した `明細ID` と `紐付状態:'確定'` は、再取り込みで上書きしない
  - 手入力の便（`取込元:'手入力'`）は、NX取り込みで更新も削除もしない
  - `assignShipmentIds`：便IDが空の行だけに振り、既存の `SH-2611-004` があれば次は `SH-2611-005`
- [ ] **Step 2: 失敗を確認**
- [ ] **Step 3: 実装**
- [ ] **Step 4: 通ることを確認**
- [ ] **Step 5: `importNx.js` を実装**
  - スクリプトプロパティ `NX_INBOX_FOLDER_ID` のフォルダにある未処理のxlsxを、Drive API（`Drive.Files.copy` に `mimeType: application/vnd.google-apps.spreadsheet`）でスプシに変換する
  - シート名に「発」を含むシートを `parseNxSheet(values, シート名)` にかけ、upsert を適用する
  - 新しい出荷明細には、`紐付状態:'未紐付'` と `matchCandidates` の結果を書く（候補1位の score が100なら `候補あり`。それ以外は `未紐付`。自動で `確定` にはしない）
  - 処理済みのxlsxは `処理済` サブフォルダに移す
  - warnings と要確認の件数を `取込ログ` シートに1行追記する
- [ ] **Step 6: 便フォルダを作る** — `shipmentFolderName(shipment) -> string` を `shipments.js` に追加し、`'SH-2611-001_MITMES_CANDMZ57065'` を返すテストを足す。`importNx.js` は新しい便ごとに、通関書類フォルダ（スクリプトプロパティ `CUSTOMS_ROOT_FOLDER_ID`、既定値 `1bm51Cv0cWuOyjfmklHcrizNeVYisNH1f`）の下にこの名前のフォルダを作り、`書類フォルダURL` に入れる
- [ ] **Step 7: 手動確認** — `スケジュール表 20261124.xlsx` を受け取りフォルダに入れて取り込み、便シートの件数が、xlsxの各シートのNo.（便番号）の数と一致することを見る。同じファイルを再取り込みして、件数が増えないことを見る
- [ ] **Step 8: コミット**

---

### Task 8: 入荷予定の自動作成と便の段階

**Files:**
- Modify: `src/core/shipments.js`
- Test: `tests/shipments.receipts.test.js`

**Interfaces:**
- Produces:
  - `buildReceiptPlans(shipLines: Row[], receipts: Row[], lines: Row[]) -> Row[]`：`確定` の出荷明細のうち、同じ便ID×明細IDの入荷行がまだ無いものから、入荷予定行（`明細ID, 便ID, 入荷予定日=配達予定日, 予定数=数量, 納品場所=配達先名`）を作る
  - `shipmentStage(shipment: Row, shipLines: Row[], receipts: Row[], today: Date) -> '出航前'|'輸送中'|'入港済'|'輸入許可済'|'倉庫連絡済'|'納品済'`

- [ ] **Step 1: テストを書く**
  - 確定の出荷明細2本 → 入荷予定2行。2回目の実行では0行
  - `候補あり` の出荷明細からは作らない
  - 段階：ETD が今日より後 → `出航前`。ETD ≤ 今日 < ETA → `輸送中`。ETA ≤ 今日で輸入許可日が空 → `入港済`。輸入許可日あり → `輸入許可済`。倉庫連絡日あり → `倉庫連絡済`。全出荷明細に実績のある入荷 → `納品済`
- [ ] **Step 2: 失敗を確認**
- [ ] **Step 3: 実装**
- [ ] **Step 4: 通ることを確認**
- [ ] **Step 5: `onEdit` を変更する** — 出荷明細の `紐付状態` が `確定` になったら、その行に `buildReceiptPlans` を適用して入荷シートに追記する
- [ ] **Step 6: コミット**

---

### Task 9: ビュー

**Files:**
- Create: `src/core/views.js`, `src/gas/renderViews.js`
- Test: `tests/views.test.js`

**Interfaces:**
- Consumes: `computeBacklog`, `computeInTransit`（Task 4）、`shipmentStage`（Task 8）
- Produces（どれも `{ headers: string[], rows: any[][] }` を返す）：
  - `viewYomi(lines, backlog, payments)`：ブランド・仕入先・明細ごとの発注数・入荷済・発注残・支払状況（`前金済/後金未` などの短い文字列）
  - `viewBacklogByMonth(lines, backlog)`：行＝ブランド×会計区分、列＝納期予定月（`YYYY/MM`）、値＝発注残 × 単価の円換算。固定資産は商品原価と別の行
  - `viewInTransit(shipments, shipLines, receipts, today)`：便ごとの段階・ETD・ETA・品目一覧
  - `viewReceiptPlan(receipts, lines, items)`：実績が空の入荷を入荷予定日順に並べる。列の並びは 04 の入荷タブのA〜F列と同じ（元々納品月, 実際納品月, 商品名, 商品コード, 入荷予定日, 入荷予定数）。そのあとに `ブランド, 明細ID, 便ID` を続ける
  - `viewMismatch(lines, receipts, shipLines, backlog)`：納品書単価が明細単価と違う入荷、納品書数量が実績数と違う入荷、`過納`・`取消後入荷` の明細、14日以上 `未紐付` の出荷明細
  - `renderViews()`（GAS）：上の5つを `V_ヨミ表`、`V_発注残`、`V_輸送中`、`V_入荷予定`、`V_突合エラー` シートに値で書き出す（シートは丸ごと書き換え、手での編集を禁じる保護を付ける）。時間主導トリガーで1時間ごと＋メニューから実行

- [ ] **Step 1: テストを書く**
  - `viewBacklogByMonth`：Yunth 商品原価 2026/12 に残4784×単価940ウォン×0.11 = 494,666円（四捨五入）。同じ発注に金型の明細があれば別の行に出る
  - `viewReceiptPlan`：入荷予定日の昇順に並び、headers の先頭6つが上記の並び
  - `viewMismatch`：納品書単価625・明細単価616 → 1行。両方616 → 0行
  - `viewYomi`：残数0で支払も済んだ明細は、状態に `完了` と表示される
- [ ] **Step 2: 失敗を確認**
- [ ] **Step 3: 実装**
- [ ] **Step 4: 通ることを確認**
- [ ] **Step 5: `renderViews.js` を実装し、トリガーを設定する**（`setupLedger` の中で一度だけ作る）
- [ ] **Step 6: コミット**

---

### Task 10: 旧ヨミ表・04からの移行

**Files:**
- Create: `src/core/migrate.js`, `src/gas/migrateRun.js`
- Test: `tests/migrate.test.js`, `tests/fixtures/yomi-samples.json`（Yunth(TOA) 3〜8行目、Yunth(IMINE) 3〜10行目、Brighte(Mtimes) 3〜8行目、Straine(ローランド) 3〜6行目の値）

**Interfaces:**
- Consumes: `assignOrderIds`, `lineAmountJpy`（Task 3）、`isLineOpen`（Task 4）
- Produces:
  - `detectLayout(headerRow: string[]) -> 'domestic'|'overseas'|'straine'`：見出しに `単価\n（ウォン）`・`単価\n（ドル）`・`単価（元）` のどれかがあれば overseas、`発注数` が無ければ straine、それ以外は domestic
  - `mapYomiRow(row: any[], headerRow: string[], ctx: {ブランド, 仕入先コード}) -> { line: Row, payments: Row[], warnings: string[] }`：見出し名で列を引く。overseas の `支払い前金`／`支払い後金`／`支払い中間金` の文章（例 `'11/4送金：26,400箱(残数：123,600)'`）から、日付が読めたものを支払行にする
  - `selectOpenRows(mapped) -> mapped[]`：`未納品 > 0`、または支払が未済のものだけ
  - `reconcileBrand(oldBacklogTotal: number, ledgerBacklogTotal: number) -> { ok: boolean, diff: number }`
  - `migrateBrand(spreadsheetId, brand)`（GAS）：各仕入先タブを読み、入力シート・入荷・支払に書く。結果を `移行ログ` に書く

- [ ] **Step 1: テストを書く**
  - `detectLayout`：TOA → domestic、IMINE → overseas、ローランド → straine
  - IMINE の `Yunth　生VAコラーゲンマスク　4枚` の行 → `数量:150000`（`発注数` 列。数量の単位は倉庫単位の箱）、`単価` は空にせず `合計金額（円）÷発注数` から逆算した円単価（414）を入れ、`通貨:'円'`。warnings に `'外貨単価は合計金額から逆算'`
  - TOA の行で `発注数` が空の古い行 → `selectOpenRows` で落ちる
  - Straine の行 → `数量` が空になり、warnings に `'発注数なし：注文書から復元が必要'`。`selectOpenRows` は Straine の行を落とさず残す（担当者の復元待ち）
  - `reconcileBrand(4784, 4784).ok === true`、`reconcileBrand(4784, 4700)` は `{ok:false, diff:84}`
- [ ] **Step 2: 失敗を確認**
- [ ] **Step 3: 実装**
- [ ] **Step 4: 通ることを確認**
- [ ] **Step 5: `migrateRun.js` を実装する**
  - メニュー「移行」から、ブランドを選んで実行する
  - 04.商品入荷の入荷タブ（`入荷（Yunth）`・`入荷（Brighte） `・`入荷（Straine）`・`入荷まとめ_LOEM`。PROTEINは除く）の入荷実績も、商品コードと日付で明細に結び付けて入荷シートに入れる。結び付かない行は `移行ログ` に出す
  - 各ブランドの旧「発注残」タブの未納合計と `reconcileBrand` で照合する
- [ ] **Step 6: 手動確認** — テスト用にコピーしたヨミ表で Yunth を移行し、`V_発注残` の合計が旧発注残タブと一致すること、移行ログに要確認の行が出ることを見る
- [ ] **Step 7: コミット**

---

### Task 11: 04.商品入荷の自動化を台帳に付け替える

**Files:**
- Create: `docs/04-automation-notes.md`
- Modify: 04.商品入荷のコンテナバインドスクリプト（`clasp clone` で手元に取得して編集）

**Interfaces:**
- Consumes: `V_入荷予定` シート（Task 9。先頭6列は 04 の入荷タブと同じ並び）

- [ ] **Step 1: 04のスクリプトを取得して読む** — `clasp clone <04のscriptId>`。`フォーム`（メール下書き）と `予定自動登録`（カレンダー）が、どのシート名・列番号・範囲を読んでいるかを `docs/04-automation-notes.md` に一覧表で書く（関数名｜読むシート｜読む列｜書く先）
- [ ] **Step 2: 付け替え方針を書く** — 3ブランドとLOEMの入荷予定は `IMPORTRANGE` か `SpreadsheetApp.openById` で `V_入荷予定` から読む。PROTEINはこれまでどおり04のタブから読む。どちらを使うかは、Step 1 で分かった読み方（列番号固定かどうか）に合わせて選び、理由を notes に書く
- [ ] **Step 3: 改修する** — 読み元を切り替える関数を1つ（`getInboundRows_(brand)`）にまとめ、既存の呼び出し元はそれを使うように変える
- [ ] **Step 4: 手動確認** — 来月分の入荷予定で、メール下書きが今と同じ件名・本文で作られ、カレンダー登録の件数が改修前と同じことを、テスト用のコピーで確かめる（めぐさんに見てもらう）
- [ ] **Step 5: コミット**（04側のリポジトリ）

---

### Task 12: 切替

**Files:**
- Create: `docs/cutover-checklist.md`、`docs/入力の仕方.md`（商品担当向けの1枚）

- [ ] **Step 1: 入力ガイドを書く** — 発注明細入力の1行の書き方、ID・金額・会計区分は自動で入ること、要確認の見方、便の手入力の仕方（NX以外のフォワーダー）、支払実績の書き方。1ページに収める
- [ ] **Step 2: 切替チェックリストを書いて実行する**（切替日はまことが決める）
  1. 全ブランドで `reconcileBrand().ok`、Straine は担当者が復元を確認済み
  2. 04の自動化が台帳から動くことを確認済み（Task 11 Step 4）
  3. 旧ヨミ表3本と、04の移行済み入荷タブを閲覧専用にする（PROTEINのタブは触らない）
  4. 旧シートの各タブの先頭に「移行済：統合台帳へ」のリンクを入れる
  5. 商品担当とめぐさんに入力ガイドを渡す
- [ ] **Step 3: コミット**

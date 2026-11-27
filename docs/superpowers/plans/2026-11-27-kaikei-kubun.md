# 会計区分を仕入先×種別で決める 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 種別マスタに仕入先ごとの例外行を書けるようにし、会計区分を「仕入先×種別」で決める。台帳スプシの見出しは「初期設定」1回で合わせられるようにする。

**Architecture:** 引き方は `src/core/orders.js` の `accountingClass` を3引数にして Node でテストする。見出しの書き足しの判定は `src/core/schema.js` の純粋関数にし、`src/gas/setup.js` の `setupLedger` から呼ぶ。GAS 側の変更は `inputHandler.js` の1行と `setup.js` の見出し確認だけ。

**Tech Stack:** Google Apps Script（V8）、clasp、Node 22 の `node:test`（依存なし）

**Spec:** `docs/superpowers/specs/2026-11-27-kaikei-kubun-design.md`

## Global Constraints

- `src/core/*.js` は純粋関数。テストを先に書く（`npm test`）。末尾は `if (typeof module !== 'undefined') module.exports = {…}`
- `src/gas/*.js` はローカルでは `node --check` と `tests/gas-scope.test.js` だけで確かめる
- トップレベル関数名を全ファイルで重複させない（`str_` は `nxParse.js` にある。新しい名前は `headersToAppend` だけ）
- 列は見出し名で参照する。列番号を直接書かない
- ローカルで `clasp push` しない。反映は main へのマージだけ
- 台帳スプシはこの作業では触らない。種別マスタの開発費は「要確認（経理と確認）」のまま
- 種別マスタの見出しは `['種別','会計区分','仕入先コード']`（既存の2列の並びは変えない）
- 見つからないときの会計区分は `'要確認'`（今と同じ）

## Review Focus

1. 例外行が既定行より上にある／下にある → どちらでも、その仕入先は例外、他の仕入先は既定（Task 1 のテスト）
2. 経理の答え待ちで会計区分を空のまま足した行（「開発費｜｜S-IMN」）→ その行は飛ばして既定を使う（Task 1）
3. セルに前後の空白（「S-IMN 」）→ 一致として扱う（Task 1）
4. マージ直後、台帳の種別マスタ C1 がまだ空 → 引き方は既定どおり、「初期設定」は止まらずに C1 を書く（Task 2）
5. 見出しを手で変えた・C1 に別の文字がある → 「初期設定」は上書きせず、今までどおり止まる（Task 2）

---

### Task 1: 会計区分を仕入先×種別で引く

**Files:**
- Modify: `src/core/orders.js:66-69`（`accountingClass`）
- Modify: `src/core/schema.js:24`（`mKinds.headers`）
- Modify: `src/gas/inputHandler.js:15`
- Modify: `docs/rulings.md:33`
- Test: `tests/orders.test.js`、`tests/headers.test.js`（新規）

**Interfaces:**
- Produces: `accountingClass(kind: string, kindMaster: {種別, 会計区分, 仕入先コード?}[], supplierCode?: string) -> string`。種別が同じで仕入先コードが一致する行 → 種別が同じで仕入先コードが空の行 → `'要確認'`。会計区分が空の行は飛ばす（会計区分が空の既定行しか無いときは、今の `''` ではなく `'要確認'`）。値は `String(v == null ? '' : v).trim()` で文字列にしてから比べ、返す（数値のセルでも止まらない。明細側の値も同じ）
- Produces: `SHEETS.mKinds.headers === ['種別','会計区分','仕入先コード']`

- [ ] **Step 1: 失敗するテストを書く**（`tests/orders.test.js` の `orders: 会計区分` のあとに追加。既存の2引数のテストはそのまま残す＝仕入先コードの無い行は既定として読む確認）

```js
test('orders: 会計区分 仕入先コードの行が既定より優先（行の順番によらない）', () => {
  const m = [{ 種別: '開発費', 会計区分: '費用', 仕入先コード: '' }, { 種別: '開発費', 会計区分: '商品原価', 仕入先コード: 'S-IMN' }];
  for (const master of [m, m.slice().reverse()]) {
    assert.strictEqual(accountingClass('開発費', master, 'S-IMN'), '商品原価');
    assert.strictEqual(accountingClass('開発費', master, 'S-MTM'), '費用');
    assert.strictEqual(accountingClass('開発費', master), '費用');
  }
});
test('orders: 会計区分 既定の行が無く仕入先も違えば要確認', () => {
  const m = [{ 種別: '開発費', 会計区分: '商品原価', 仕入先コード: 'S-IMN' }];
  assert.strictEqual(accountingClass('開発費', m, 'S-MTM'), '要確認');
  assert.strictEqual(accountingClass('開発費', m), '要確認');
});
test('orders: 会計区分 会計区分が空の行は飛ばす', () => {
  const m = [{ 種別: '開発費', 会計区分: '', 仕入先コード: 'S-IMN' }, { 種別: '開発費', 会計区分: '費用', 仕入先コード: '' }];
  assert.strictEqual(accountingClass('開発費', m, 'S-IMN'), '費用');
});
test('orders: 会計区分 前後の空白は無視（マスタ側も明細側も）', () => {
  const m = [{ 種別: '開発費 ', 会計区分: ' 商品原価', 仕入先コード: ' S-IMN ' }];
  assert.strictEqual(accountingClass('開発費', m, 'S-IMN'), '商品原価');
  assert.strictEqual(accountingClass('開発費 ', m, ' S-IMN'), '商品原価');
});
test('orders: 会計区分 数値のセルでも止まらない', () => {
  const m = [{ 種別: '開発費', 会計区分: '費用', 仕入先コード: '' }, { 種別: '開発費', 会計区分: '商品原価', 仕入先コード: 123 }];
  assert.strictEqual(accountingClass('開発費', m, '123'), '商品原価');
  assert.strictEqual(accountingClass('開発費', m, 123), '商品原価');
});
test('orders: 会計区分 会計区分が空の既定行しか無ければ要確認', () => {
  assert.strictEqual(accountingClass('開発費', [{ 種別: '開発費', 会計区分: '' }]), '要確認');
});
```

新しいファイル `tests/headers.test.js` に追加（`tests/schema.test.js` は並列の nx-import-keys も変えるので、ぶつからないよう別ファイルにする）：

```js
const test = require('node:test');
const assert = require('node:assert');
const { rowsToObjects } = require('../src/core/schema.js');
const { accountingClass } = require('../src/core/orders.js');

test('schema: 種別マスタは A種別・B会計区分・C仕入先コードとして読む', () => {
  const kinds = rowsToObjects('mKinds', [['開発費', '費用', ''], ['開発費', '商品原価', 'S-IMN']]);
  assert.strictEqual(accountingClass('開発費', kinds, 'S-IMN'), '商品原価');
  assert.strictEqual(accountingClass('開発費', kinds, 'S-MTM'), '費用');
});
```

（見出しの定数をそのまま比べるテストにはしない。台帳の列の並び（A・B は今のまま、C が仕入先コード）を読み違える変更で落ちる形にする）

- [ ] **Step 2: 失敗を確かめる** — `npm test`。期待：上の7件がすべて FAIL（優先・既定なし・空行・空白・数値・空の既定・schema。今のコードは仕入先を見ずに種別が最初に一致した行を返すため）、既存の96件は PASS
- [ ] **Step 3: 実装する** — `accountingClass` を Interfaces のとおり3引数に（ループ1回で、一致した仕入先行はすぐ返し、最初の既定行を覚えておく）。JSDoc に引き方を1行。`SHEETS.mKinds.headers` を `['種別','会計区分','仕入先コード']` にし、同じ行の末尾に「種別は仕入先ごとの例外行で重複しうる」とコメント。`inputHandler.js:15` を `r.会計区分 = accountingClass(r.種別, kinds, r.仕入先コード);` に
- [ ] **Step 4: 通ることを確かめる** — `npm test` が全件 PASS、`for f in src/gas/*.js; do node --check "$f"; done` がエラーなし
- [ ] **Step 5: rulings.md の該当行を resolved にする** — `docs/rulings.md:33` の末尾に追記：` — resolved 2026-11-27: 種別マスタ gets a 仕入先コード column at the right; accountingClass takes the row whose 仕入先コード matches the line, else the row with a blank 仕入先コード (default for all suppliers), else 要確認; rows with a blank 会計区分 are skipped (Makoto's choice; 開発費 stays 要確認（経理と確認） until 経理 answers)`
- [ ] **Step 6: コミット**

```bash
git add src/core/orders.js src/core/schema.js src/gas/inputHandler.js tests/orders.test.js tests/headers.test.js docs/rulings.md
git commit -m "fix: decide 会計区分 by 仕入先×種別 (種別マスタ gets 仕入先コード)"
```

---

### Task 2: 初期設定が右端の足りない見出しを書き足す

**Files:**
- Modify: `src/core/schema.js`（`headersToAppend` を追加して export）
- Modify: `src/gas/setup.js:12-14`（既存シートの見出し確認）
- Modify: `docs/rulings.md`（末尾に Ruling と deferred を1行ずつ）、`docs/HANDOFF.md:35`（次にやること 4）、`docs/cutover-checklist.md:10`（マスタ入力）
- Test: `tests/headers.test.js`

**Interfaces:**
- Consumes: `SHEETS`（Task 1 で mKinds が3列）
- Produces: `headersToAppend(current: any[], defined: string[]) -> string[] | null`。`current` は台帳の1行目の値（文字列にしてから比べる。`null`/`undefined` は空）。先頭から一致する数を n として、n が定義の長さなら `[]`、n が0なら `null`、`current` の n 番目以降に空でないセルがあれば `null`、それ以外は `defined.slice(n)`

- [ ] **Step 1: 失敗するテストを書く**（`tests/headers.test.js`。require に `headersToAppend` を足す）

```js
test('schema: headersToAppend 一致なら足すものなし', () => {
  const def = ['種別', '会計区分', '仕入先コード'];
  assert.deepStrictEqual(headersToAppend(def.slice(), def), []);
});
test('schema: headersToAppend 右の空セルに足りない見出しを返す', () => {
  const def = ['種別', '会計区分', '仕入先コード'];
  assert.deepStrictEqual(headersToAppend(['種別', '会計区分', ''], def), ['仕入先コード']);
  assert.deepStrictEqual(headersToAppend(['種別', '会計区分'], def), ['仕入先コード']);
});
test('schema: headersToAppend 1列目から違う・途中が違う・足す場所に文字があるときは null', () => {
  const def = ['種別', '会計区分', '仕入先コード'];
  assert.strictEqual(headersToAppend(['', '', ''], def), null);
  assert.strictEqual(headersToAppend(['種別', '区分', ''], def), null);
  assert.strictEqual(headersToAppend(['種別', '会計区分', 'メモ'], def), null);
  assert.strictEqual(headersToAppend(['種別', '', '仕入先コード'], def), null);
});
```

- [ ] **Step 2: 失敗を確かめる** — `npm test`。期待：`headersToAppend is not a function` で上の3件が FAIL
- [ ] **Step 3: `headersToAppend` を `src/core/schema.js` に実装して export** — Interfaces の規則どおり
- [ ] **Step 4: `setupLedger` から呼ぶ** — 既存シートの分岐を「`headersToAppend(cur, def.headers)` が `null` なら `def.name + ' の見出しが定義と違います（定義：' + def.headers.join('｜') + '）'` で止める（まことさんが自分で直せるよう定義を出す）。1件以上なら、`def.headers.length - add.length + 1` 列目から1行目に書き、太字にする」に置き換える
- [ ] **Step 5: 通ることを確かめる** — `npm test` が全件 PASS、`node --check` が全 GAS ファイルでエラーなし
- [ ] **Step 6: docs を書く**
  - `docs/rulings.md` の末尾：`- 会計区分 follow-up: Ruling: setupLedger appends headers missing at the right of an existing sheet when row 1 matches the definition's leading headers and the cells to fill are blank; any other difference still stops setup — a schema change that appends a column can be merged before the live sheet is touched, and one 初期設定 run writes the header (種別マスタ C1 仕入先コード) — cost if wrong: none for existing sheets (only blank cells are written)`
  - `docs/rulings.md` の末尾にもう1行：`- 会計区分 follow-up: minor (deferred): editing 種別マスタ does not recompute 会計区分 of lines already entered — it is computed only when a 発注明細入力 row is edited; re-select the 種別 of the affected rows to recompute (no bulk recompute menu)`
  - `docs/HANDOFF.md` 次にやること 4 の下に3点：(1) 会計区分が仕入先で変わるなら、種別マスタに仕入先コードを書いた行を足す（仕入先コードが空の行は全仕入先の既定）。(2) この変更をマージしたら、仕入先コードの行を足す前に、所有者のまことさんが「統合台帳 → 初期設定」を1回押して種別マスタの C1 に「仕入先コード」を入れる（初期設定は押した人を OWNER_EMAIL にするため、ほかの人は押さない）。(3) 種別マスタを変えても入力済みの明細の会計区分は変わらない。引き直すには、その行の「種別」を選び直す（いったん別の種別にしてから戻す）。まとめて引き直す方法は実機で確かめていない
  - `docs/cutover-checklist.md` のマスタ入力の行：`種別マスタ（開発費の会計区分は経理と確認）` を `種別マスタ（開発費の会計区分は経理と確認。仕入先で変わるときは仕入先コードを書いた行を足す。空欄の行は全仕入先の既定。例外の行も移行の前に入れる）` に
- [ ] **Step 7: コミット**

```bash
git add src/core/schema.js src/gas/setup.js tests/headers.test.js docs/rulings.md docs/HANDOFF.md docs/cutover-checklist.md
git commit -m "fix: setupLedger appends headers added at the right of a master"
```

---

## 反映（この計画の外、記録だけ）

- PR を main にマージすると deploy ワークフローが反映する。そのあと、まことさんが「統合台帳 → 初期設定」を1回押す
- 仕入先コードの行は、マージと「初期設定」のあとに足す（旧コードは C 列を読まないので、先に足すと仕入先を区別せずに最初に見つかった行を使う）

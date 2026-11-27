# 統合台帳（procurement-ledger-clasp）

発注・輸送・入荷を1本の台帳にまとめるGoogle Apps Script。台帳スプシにコンテナバインド、claspで管理。

- 設計書: https://claude.ai/artifact/DoQV6iemaHVWCacYW58o81
- 実装計画: `docs/superpowers/plans/2026-11-26-procurement-ledger-phase0-1-plan.md`
- 実装時の判断: `docs/rulings.md`
- 台帳スプシ: https://docs.google.com/spreadsheets/d/1BgrBHO-cdnawQeekE4yXqrjwMIprx7KwsYunnNNgaZ0/edit

## 構成とルール

- `src/core/*.js` は副作用のない純粋関数。Node でテストする（`npm test`、`node:test`、依存なし）。新しいロジックはここに置き、テストを先に書く
- `src/gas/*.js` は SpreadsheetApp / DriveApp / Drive（高度なサービス v2）を触る薄い層。ローカルでは `node --check` と `tests/gas-scope.test.js` だけで確かめる
- GAS は全ファイルを1つのグローバルスコープで読む。トップレベルの関数名は全ファイルで重複させない（gas-scope テストが検出する）
- `src/core` の各ファイルの末尾は `if (typeof module !== 'undefined') module.exports = {…}`
- 列は見出し名で参照する（`SHEETS` と `colIndex`、`src/core/schema.js`）。列番号を直接書かない
- `src/appsscript.json` は Asia/Tokyo と Drive v2 を有効にした状態を保つ。`clasp create-script` などで上書きされたら戻す
- 反映は `clasp push`。テストが通らないコードは push しない
- フォルダID・ヨミ表IDの既定値は `src/gas/config.js`（スクリプトプロパティがあればそちらが優先）

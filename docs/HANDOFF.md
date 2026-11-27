# 統合台帳 引継ぎメモ（2026-11-27 時点）

発注・輸送・入荷を1本の台帳にまとめるGASプロジェクト。第0〜1段階のコードは完成し、本番の台帳スプシに反映済み。いまは「関門1（NX取り込みの実地テスト）」の直前。

## リンク

| もの | 場所 |
|---|---|
| リポジトリ | https://github.com/ogwmkt1230/procurement-ledger-clasp （Private。Orca のプロジェクトは `C:\Users\mogawa\orca\projects\procurement-ledger-clasp`、作業ごとの worktree は Orca が `orca\workspaces\procurement-ledger-clasp\…` に自動で作る） |
| 設計書 | https://claude.ai/artifact/DoQV6iemaHVWCacYW58o81 |
| 実装計画 | `docs/superpowers/plans/2026-11-26-procurement-ledger-phase0-1-plan.md` |
| 実装時の判断・保留した指摘 | `docs/rulings.md` |
| 台帳スプシ | https://docs.google.com/spreadsheets/d/1BgrBHO-cdnawQeekE4yXqrjwMIprx7KwsYunnNNgaZ0/edit |
| 台帳のscriptId | `1ij-SeU5qpatvSX2pL5POo6qwpS4_OT8h79fBikV2x0aB6cBGh7Iq28zc` |
| NX受け取りフォルダ | https://drive.google.com/drive/folders/1n-qDT5yyesk04PaL-a8RNuvU52rOF10h （24日付スケジュール表を投入済み） |
| 通関書類等フォルダ | https://drive.google.com/drive/folders/1bm51Cv0cWuOyjfmklHcrizNeVYisNH1f |
| 旧ヨミ表 | Yunth `1r31h7SiivdWty_WBLc91dtxLBS4MNzMhRd7f0AaAkZ8` / Brighte `1aYrcWPM5viVCFoyAUSEp8paZoVOixtrkINOtQ1AsCUk` / Straine `1BFmgwQhsFVVec8r9TrKHMDb4qpUz-3sOvXgdfwcWkMk` |
| 04.商品入荷（めぐさん） | `1sNr9eDCNYWC5J5Q15CrbTvzILR5DzHvUzuSkVNQ4LSw` |

## 済んでいること

- コード：`src/core`（純粋関数、テスト87件）と `src/gas`（スプシ・Drive操作）。最終レビューの重要指摘8件は修正済み
- 台帳スプシ：初期設定済み（10シート・各20,000行・保護列・入力規則・1時間ごとのビュー更新トリガー）。`OWNER_EMAIL` は m.ogawa@ai-robotics.co.jp
- マスタの下書き：種別（開発費は「要確認」）、配達先6件、仕入先20社（shipper別名つき）、商品121件（NX表記の別名つき）
- 反映の仕組み：PRで `test`、mainへのマージで `deploy`（`clasp push --force`）。Secret `CLASPRC_JSON`（Environment `production`）。手動の `gh workflow run deploy` で成功確認済み

## 次にやること（順番どおり）

1. **関門1：NX取り込みの実地テスト**（まことさんがスプシで「統合台帳 → NX取り込み」を押す）
   - 合格条件：便が41件（蛇口発38・釜山発3）、出荷明細に品目ごとの行、通関書類等フォルダに便ごとのフォルダ、xlsxが `NX取込/処理済` へ移動、`取込ログ` に1行
   - そのあと処理済のxlsxを受け取りフォルダに戻して再取り込みし、便・出荷明細の件数が増えないこと
   - 発注明細がまだ空なので、出荷明細の「候補」が空なのは正常
2. **GitHub Actions の部品更新**：`actions/checkout` と `actions/setup-node` を Node 24 対応の版へ（Node 20 非推奨の注意が出ている）
3. **保留した軽微な指摘8件**（`docs/rulings.md` 末尾の minor (deferred)）。優先度が高いのは「品目なしの要確認が多すぎる」「配達先コードにNXの自由記述が入る」
4. **マスタの確認（まことさん）**：商品マスタの別名のうち推測で入れたもの（モカリフト／茶色リフト → ELEKILIFT Natural、化粧水ミスト → ダブルCセラムミスト）、種別マスタの開発費の会計区分（経理と確認）
   - 会計区分が仕入先で変わるなら、種別マスタに仕入先コードを書いた行を足す（仕入先コードが空の行は全仕入先の既定。例：「開発費｜費用｜空欄」と「開発費｜商品原価｜S-IMN」）
   - 会計区分の仕入先×種別の変更をマージしたら、仕入先コードの行を足す前に、所有者のまことさんが「統合台帳 → 初期設定」を1回押して種別マスタの C1 に「仕入先コード」を入れる（初期設定は押した人を OWNER_EMAIL にするので、ほかの人は押さない）
   - 種別マスタを変えても、入力済みの明細の会計区分は変わらない（明細の行を編集したときに計算される）。引き直すには、その行の「種別」を選び直す（いったん別の種別にしてから戻す）。まとめて引き直す方法は実機で確かめていない
5. **04の自動化の付け替え**：`docs/04-automation-notes.md` の手順。04のscriptIdをまことさんにもらってから
6. **移行の予行演習**：旧ヨミ表のコピーで「移行」を実行し、`移行ログ` の照合が一致すること。Straineは発注数を商品担当が注文書から復元、LOEMは手入力
7. **切替**：`docs/cutover-checklist.md`（切替日はまことさんが決める）
8. **第2段階**（GAS入力画面・毎朝チェック通知）：関門2を通ってから、設計し直して別の計画を立てる

## 踏んだ地雷（同じことをしない）

- `clasp create-script` が `src/appsscript.json` を初期状態で上書きし、Drive v2 とタイムゾーンが消えた（「Drive is not defined」）。deploy にマニフェスト確認を入れてある
- ローカルで `clasp push` しない。反映は main へのマージだけ
- GASは全ファイルが1つのグローバルスコープ。トップレベル関数名の重複は `tests/gas-scope.test.js` が検出する
- Drive v2 の `Files.copy` で xlsx を変換するには `{ convert: true }` が要る
- NX取り込みと移行は台帳の所有者（OWNER_EMAIL）しか実行できない
- WSL から `/mnt/c` が見えなくなったら `sudo mount -t drvfs C: /mnt/c`
- `C:\Users\mogawa\procurement-ledger-clasp`（最初の置き場所）と WSL の `~/procurement-ledger-clasp` は古いコピー。使わない

## 業務上の前提（コードに効いているもの）

- NXの便は「発地＋表の便番号」で識別（H B/L が後から付く便があるため）
- IMINE のヨミ表「支払い前金」の「11/4送金：26,400箱」は入荷ではなく送金記録 → 支払として移行
- 数量は倉庫で数える単位。外貨の明細は行ごとに換算レートを持つ
- 対象は Yunth・Brighte・Straine・LOEM。PROTEIN は 04 に残す
- 入荷はすべて倉庫でめぐさんが記録、支払実績は商品担当が書く
- 質問はまことさんに選択肢形式で聞く

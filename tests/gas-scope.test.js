const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const files = ['core', 'gas'].flatMap(d => fs.readdirSync(path.join(__dirname, '../src', d)).filter(f => f.endsWith('.js')).map(f => path.join(__dirname, '../src', d, f)));

test('gas: トップレベル関数名が全ファイルで重複しない', () => {
  const seen = {};
  for (const f of files) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/^function\s+([\w$぀-鿿]+)/gm)) {
      assert.ok(!seen[m[1]], `${m[1]} が ${seen[m[1]]} と ${path.basename(f)} で重複`);
      seen[m[1]] = path.basename(f);
    }
  }
});
test('gas: moduleなしの単一スコープで全ファイルが読み込め、主要関数が呼べる', () => {
  const ctx = vm.createContext({ console, Date, Math, JSON, Map, Object, String, Number, Array, RegExp, isNaN, parseInt, Infinity });
  for (const f of files.slice().reverse()) vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
  assert.strictEqual(vm.runInContext("nextSerialId('PO', new Date(2026,10,1), [])", ctx), 'PO-2611-001');
  assert.strictEqual(vm.runInContext("lineAmountJpy({通貨:'円',単価:2,数量:3})", ctx), 6);
  assert.strictEqual(vm.runInContext("viewBacklogByMonth([], new Map()).headers.length", ctx), 2);
  assert.strictEqual(vm.runInContext("dataRowSpan(1, 5).startRow", ctx), 2);
  // edits.js が orders.js の関数（Node では require）を単一スコープでも使えること
  assert.strictEqual(vm.runInContext("assignInputRangeIds([{発注ID:'',明細ID:'',ブランド:'Yunth',仕入先コード:'S0',発注日:new Date(2026,10,1),稟議AP:'',品名:'VA'}], 0, 1, []).orders[0].発注ID", ctx), 'PO-2611-001');
  assert.strictEqual(vm.runInContext("typeof setupLedger + typeof renderViews + typeof importNxFile + typeof migrateBrand", ctx), 'functionfunctionfunctionfunction');
});

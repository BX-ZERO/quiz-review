/* 复核：答到一半回主页 → 重新打开页面 → 首页出现「继续答题」，进度不丢 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const dir = path.join(__dirname, '..');

function mkEl(attrs) {
  const o = {
    attrs: Object.assign({}, attrs || {}),
    innerHTML: '', textContent: '', hidden: false, value: '', checked: false,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    style: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    removeAttribute(k) { delete this.attrs[k]; },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    addEventListener() {},
    querySelector() { return null; },
    closest() { return this; },
    focus() {},
    appendChild() {},
    removeChild() {},
    click() {}
  };
  return o;
}

function boot(store) {
  const root = mkEl();
  const handlers = {};
  const sandbox = {
    console,
    confirm: () => true,
    setTimeout, clearTimeout,
    Math, Date, JSON,
    window: { scrollTo() {}, open() {}, location: { href: '' }, print() {}, getSelection: () => null },
    localStorage: {
      getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem(k, v) { store[k] = String(v); },
      removeItem(k) { delete store[k]; }
    },
    document: {
      documentElement: mkEl(),
      body: mkEl(),
      querySelector() { return root; },
      querySelectorAll() { return []; },
      getElementById() { return mkEl(); },
      createElement() { return mkEl(); },
      addEventListener(t, fn) { handlers[t] = fn; }
    }
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);

  for (const f of ['questions.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
  }

  function fire(attrs) {
    const el = mkEl(attrs);
    const ev = { target: el, preventDefault() {} };
    if (handlers.click) handlers.click(ev);
    if (handlers.change) handlers.change(ev);
  }

  return { root, fire, handlers, store };
}

let fail = 0;
function ok(cond, label) {
  if (cond) console.log('  通过  ' + label);
  else { console.log('  失败  ' + label); fail += 1; }
}

/* ---------- 第一轮：答到第 3 题 ---------- */
const store = {};
const a = boot(store);
a.fire({ 'data-act': 'quickPractice' });
a.fire({ 'data-act': 'pick', 'data-k': 'A' });
a.fire({ 'data-act': 'next' });
a.fire({ 'data-act': 'pick', 'data-k': 'B' });
a.fire({ 'data-act': 'next' });

const saved = store['qs.session.v1'] ? JSON.parse(store['qs.session.v1']) : null;
ok(!!saved, '答题过程中写入了会话记录');
ok(saved && saved.quiz && saved.quiz.i === 2, '停在第 3 题（i=2），实际 i=' + (saved && saved.quiz ? saved.quiz.i : '无'));
ok(saved && Object.keys(saved.quiz.picks).length === 2, '已答 2 题被记住');

/* 回主页 */
a.fire({ 'data-act': 'go', 'data-view': 'home' });
ok(a.root.innerHTML.indexOf('继续答题') >= 0, '回到主页后出现「继续答题」');
ok(a.root.innerHTML.indexOf('停在第 3 题') >= 0, '主页写明了停在第 3 题');

/* ---------- 第二轮：模拟关掉页面再打开 ---------- */
const b = boot(JSON.parse(JSON.stringify(store)));
ok(b.root.innerHTML.indexOf('继续答题') >= 0, '重新打开页面后仍能看到「继续答题」');

b.fire({ 'data-act': 'resumeQuiz' });
ok(/3 \/ \d+/.test(b.root.innerHTML), '继续后回到了第 3 题（3 / N）');

/* 放弃应当清掉 */
b.fire({ 'data-act': 'go', 'data-view': 'home' });
b.fire({ 'data-act': 'dropQuiz' });
ok(!b.store['qs.session.v1'], '放弃后会话记录被清掉');
ok(b.root.innerHTML.indexOf('继续答题') < 0, '放弃后主页不再出现继续入口');

console.log('\n失败项: ' + fail);
process.exit(fail ? 1 : 0);

const fs = require('fs');
const path = require('path');
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
    querySelector() { return mkEl(); },
    closest() { return this; },
    focus() {},
    appendChild() {},
    click() {}
  };
  return o;
}

const store = {};
const handlers = {};
const root = mkEl();

const sandbox = {
  console,
  confirm: () => true,
  setTimeout, clearTimeout,
  Math, Date, JSON,
  window: { scrollTo() {}, open() {}, location: { href: '' }, print() {} },
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
    addEventListener(t, fn) { handlers[t] = fn; },
    createElement() { return mkEl(); },
    getElementById() { return mkEl(); }
  }
};
sandbox.globalThis = sandbox;

const vm = require('vm');
const ctx = vm.createContext(sandbox);

function run(file) {
  const code = fs.readFileSync(path.join(dir, file), 'utf8');
  vm.runInContext(code, ctx, { filename: file });
}

run('questions.js');

const errs = [];
try {
  run('app.js');
} catch (e) {
  errs.push('boot: ' + e.message);
}

function fire(attrs) {
  const el = mkEl(attrs);
  const ev = { target: el, preventDefault() {} };
  try {
    if (handlers.click) handlers.click(ev);
    if (handlers.change) handlers.change(ev);
  } catch (e) {
    errs.push(attrs['data-act'] + ': ' + e.message + '\n' + (e.stack || '').split('\n')[1]);
  }
}

const views = ['papers', 'bank', 'wrong', 'import', 'dup', 'home'];
for (const v of views) fire({ 'data-act': 'go', 'data-view': v });

fire({ 'data-act': 'pickPaper', 'data-paper': '卷5' });
fire({ 'data-act': 'quickPractice' });
fire({ 'data-act': 'pick', 'data-k': 'A' });
fire({ 'data-act': 'confirm' });
fire({ 'data-act': 'next' });
fire({ 'data-act': 'sheet' });
fire({ 'data-act': 'closeModal' });
fire({ 'data-act': 'submit' });
fire({ 'data-act': 'finish' });
fire({ 'data-act': 'againWrong' });
fire({ 'data-act': 'go', 'data-view': 'wrong' });
fire({ 'data-act': 'redoAll' });
fire({ 'data-act': 'quickExam' });
fire({ 'data-act': 'pick', 'data-k': 'B' });
fire({ 'data-act': 'next' });
fire({ 'data-act': 'finish' });
fire({ 'data-act': 'editQ', 'data-id': 'j5-01' });
fire({ 'data-act': 'richToggle', 'data-f': 'explain' });
fire({ 'data-act': 'richToggle', 'data-f': 'explain' });
fire({ 'data-act': 'insertTable', 'data-f': 'explain' });
fire({ 'data-act': 'previewQ' });
fire({ 'data-act': 'closePreview' });
fire({ 'data-act': 'saveEdit', 'data-id': 'j5-01' });
fire({ 'data-act': 'closeModal' });
fire({ 'data-act': 'dupCheck' });
fire({ 'data-act': 'go', 'data-view': 'bank' });
fire({ 'data-act': 'selAll' });
fire({ 'data-act': 'pickSel' });
fire({ 'data-act': 'clearPending' });
fire({ 'data-act': 'randomPick' });

fire({ 'data-act': 'calcToggle' });
['6', '3', '/', '9', '0', '*', '1', '0', '0', '='].forEach(k => fire({ 'data-act': 'calcKey', 'data-k': k }));
const calcOut = root.textContent;
fire({ 'data-act': 'calcKey', 'data-k': 'back' });
fire({ 'data-act': 'calcKey', 'data-k': 'C' });
fire({ 'data-act': 'calcToggle' });
if (calcOut !== '70') errs.push('calc: 63/90*100 应为 70，实际 ' + JSON.stringify(calcOut));

const bank = store['qs.bank.v1'] ? JSON.parse(store['qs.bank.v1']) : [];
const cases = bank.filter(q => q.case);
console.log('案例题:', cases.length, '条', cases.map(q => q.id + '/' + q.case + (q.caseStem ? '/背景在' : '/背景丢')).join(' '));
console.log('错误数:', errs.length);
errs.slice(0, 12).forEach(e => console.log(' -', e));
console.log('题库条数:', bank.length, '状态键:', Object.keys(store).join(','));

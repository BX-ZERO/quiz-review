/* 题库体检：node tools/check.js
   检查结构是否自洽、解析有没有「依据」块、有没有乱码。
   有问题时退出码为 1。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = path.join(__dirname, '..');
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(dir, 'questions.js'), 'utf8'), ctx);
const qs = ctx.window.QUESTIONS || [];

const errs = [];
const warns = [];
const seen = new Set();

const plain = s => String(s || '')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ')
  .trim();

qs.forEach(function (q, i) {
  const tag = q.id || ('#' + i);
  if (!q.id) errs.push(tag + ' 缺少 id');
  if (seen.has(q.id)) errs.push(tag + ' id 重复');
  seen.add(q.id);

  if (['single', 'multi', 'judge'].indexOf(q.type) < 0) errs.push(tag + ' 题型异常：' + q.type);
  if (!plain(q.stem)) errs.push(tag + ' 题干为空');

  const opts = q.options || [];
  if (!opts.length) errs.push(tag + ' 没有选项');
  opts.forEach(function (o) {
    if (!plain(o.t)) errs.push(tag + ' 选项 ' + o.k + ' 文本为空');
  });

  const keys = opts.map(function (o) { return o.k; });
  const ans = q.answer || [];
  if (!ans.length) errs.push(tag + ' 没有答案');
  ans.forEach(function (a) {
    if (keys.indexOf(a) < 0) errs.push(tag + ' 答案 ' + a + ' 不在选项里');
  });
  if (q.type === 'single' && ans.length !== 1) errs.push(tag + ' 单选题答案有 ' + ans.length + ' 个');
  if (q.type === 'judge' && ans.length !== 1) errs.push(tag + ' 判断题答案有 ' + ans.length + ' 个');
  if (q.type === 'multi' && ans.length < 2) errs.push(tag + ' 多选题答案只有 ' + ans.length + ' 个');

  const ex = String(q.explain || '');
  if (!ex.trim()) warns.push(tag + ' 解析为空');
  else if (!/class="src"/.test(ex)) warns.push(tag + ' 解析缺「依据」块');
  const body = ex.replace(/<div class="src">[\s\S]*$/i, '');
  if (ex.trim() && plain(body).length < 15) warns.push(tag + ' 解析正文偏短（' + plain(body).length + ' 字）');

  if (/\uFFFD/.test(q.stem + ex)) errs.push(tag + ' 含乱码字符 U+FFFD');

  const papers = q.papers || [];
  if (papers.length && q.paper && papers.indexOf(q.paper) < 0) errs.push(tag + ' paper 不在 papers 里');
  if (!papers.length && !q.paper) warns.push(tag + ' 没有归属试卷');
});

const byPaper = {};
qs.forEach(function (q) {
  const p = (q.papers && q.papers[0]) || q.paper || '未分卷';
  byPaper[p] = (byPaper[p] || 0) + 1;
});

console.log('题库条数：' + qs.length + '　' + Object.keys(byPaper).map(function (p) {
  return p + ' ' + byPaper[p];
}).join('　'));

console.log('错误：' + errs.length);
errs.slice(0, 40).forEach(function (e) { console.log('  x ' + e); });
if (errs.length > 40) console.log('  …另有 ' + (errs.length - 40) + ' 条');

console.log('提示：' + warns.length);
warns.slice(0, 40).forEach(function (w) { console.log('  - ' + w); });
if (warns.length > 40) console.log('  …另有 ' + (warns.length - 40) + ' 条');

process.exitCode = errs.length ? 1 : 0;

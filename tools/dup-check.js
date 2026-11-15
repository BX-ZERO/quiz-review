/* 查重报告：列出题干相似的题组，并标出是「同卷内重复」还是「跨卷重复」
   用法：node tools/dup-check.js [阈值，默认 0.82]
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = path.join(__dirname, '..');
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(dir, 'questions.js'), 'utf8'), ctx);
const bank = ctx.window.QUESTIONS;

const THRESHOLD = Number(process.argv[2] || 0.82);

function plain(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&[a-z]+;/gi, '')
    .replace(/^[\s\d.、．)）(（]+/, '')
    .replace(/^(单项|多项|判断)?选择题[:：]?/, '')
    .replace(/[，。、；：？！“”‘’（）()【】\[\]…—\-\s,.?!;:'"`~]/g, '');
}

function grams(s) {
  const out = new Set();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

function sim(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = grams(a), B = grams(b);
  const ratio = A.size / Math.max(B.size, 1);
  if (ratio < 0.65 || ratio > 1.54) return 0;
  let hit = 0;
  for (const g of A) if (B.has(g)) hit++;
  return (2 * hit) / (A.size + B.size);
}

const papersOf = (q) => (q.papers && q.papers.length ? q.papers : [q.paper]);

const n = bank.length;
const parent = bank.map((_, i) => i);
function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }

const pairs = [];
for (let i = 0; i < n; i++) {
  for (let j = i + 1; j < n; j++) {
    const a = bank[i], b = bank[j];
    if (a.type !== b.type) continue;
    if (a.case && a.case === b.case) continue;
    const s = sim(plain(a.stem), plain(b.stem));
    if (s >= THRESHOLD) {
      pairs.push({ i, j, s, same: papersOf(a).some((p) => papersOf(b).includes(p)) });
      parent[find(i)] = find(j);
    }
  }
}

const groups = {};
pairs.forEach((p) => {
  const r = find(p.i);
  (groups[r] = groups[r] || []).push(p);
});

let inner = 0, cross = 0;
Object.keys(groups).forEach((k, gi) => {
  const ps = groups[k];
  const members = Array.from(new Set(ps.flatMap((p) => [p.i, p.j]))).map((i) => bank[i]);
  const same = ps.some((p) => p.same);
  if (same) inner++; else cross++;
  console.log(`\n组 ${gi + 1}  ${same ? '【同卷内重复】' : '【跨卷重复】'}`);
  members.forEach((q) => {
    console.log(`  ${q.id}  ${papersOf(q).join('/')} 第${q.no}题  ${q.type}  ${plain(q.stem).slice(0, 42)}`);
  });
  ps.forEach((p) => {
    console.log(`    相似度 ${p.s.toFixed(2)}  ${bank[p.i].id} ↔ ${bank[p.j].id}`);
  });
});

console.log(`\n共 ${Object.keys(groups).length} 组：同卷内 ${inner} 组，跨卷 ${cross} 组；题库 ${n} 条`);

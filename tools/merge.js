/* 把一份识别结果（JSON 数组）并入题库
   用法：node tools/merge.js 卷2 _juan2.json
   规则：
     同一卷里出现重复题 → 并在已有那条上，不新增；
     跨卷重复 → 各卷各自保留一条，不做合并（总题库视图会自动去重）；
     题干相似度阈值 0.82，题型不同或同属一个案例组的不参与判重。
   合并前自动备份为 questions.before-merge.js。
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = path.join(__dirname, '..');
const qfile = path.join(dir, 'questions.js');

const paperName = process.argv[2];
const inputFile = process.argv[3];
if (!paperName || !inputFile) {
  console.log('用法：node tools/merge.js <试卷名> <识别结果.json>');
  process.exit(1);
}

const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(qfile, 'utf8'), ctx);
const bank = ctx.window.QUESTIONS.map((q) => Object.assign({}, q));

const incoming = JSON.parse(fs.readFileSync(path.resolve(dir, inputFile), 'utf8'));

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
  const A = grams(a), B = grams(b);
  const ratio = A.size / Math.max(B.size, 1);
  if (ratio < 0.65 || ratio > 1.54) return 0;
  let hit = 0;
  for (const g of A) if (B.has(g)) hit++;
  return (2 * hit) / (A.size + B.size);
}

const THRESHOLD = 0.82;
const merged = [];
const added = [];

for (const raw of incoming) {
  const q = {
    id: raw.id,
    paper: paperName,
    papers: [paperName],
    no: String(raw.no || ''),
    type: raw.type || 'single',
    category: raw.category || '',
    stem: raw.stem || '',
    options: raw.options || [],
    answer: raw.answer || [],
    explain: raw.explain || ''
  };
  if (raw.case) {
    q.case = raw.case;
    q.caseStem = raw.caseStem || '';
  }

  const key = plain(q.stem);
  let best = null, bestScore = 0;
  for (const o of bank) {
    if (q.case && o.case && o.case === q.case) continue;
    if (o.type !== q.type) continue;
    const s = sim(key, plain(o.stem));
    if (s > bestScore) { bestScore = s; best = o; }
  }

  if (best && bestScore >= THRESHOLD) {
    const papersOf = (o) => (o.papers && o.papers.length ? o.papers : [o.paper]);
    if (papersOf(best).includes(paperName)) {
      // 同一卷里的重复题：并在已有条目上，不新增
      if (!best.explain || q.explain.length > best.explain.length + 20) best.explain = q.explain;
      if (plain(q.stem).length > plain(best.stem).length) best.stem = q.stem;
      if (JSON.stringify(q.answer) !== JSON.stringify(best.answer)) {
        console.log(`  注意：答案不一致 ${best.id} ${JSON.stringify(best.answer)} ≠ ${q.id} ${JSON.stringify(q.answer)}`);
      }
      merged.push({ keep: best.id, from: `${paperName} #${q.no}`, score: bestScore.toFixed(2) });
    } else {
      // 跨卷的重复题：各卷各自留一条，不合并
      bank.push(q);
      added.push(q.id + '(跨卷)');
    }
  } else {
    bank.push(q);
    added.push(q.id);
  }
}

const head = `/* 错题复习题库 —— window.QUESTIONS
   字段：id paper papers no type category stem options answer explain
   案例题另有 case（案例组 id）与 caseStem（小题共用的案例背景）
*/`;

fs.copyFileSync(qfile, path.join(dir, 'questions.before-merge.js'));
fs.writeFileSync(qfile, head + '\nwindow.QUESTIONS = ' + JSON.stringify(bank, null, 2) + ';\n', 'utf8');

console.log('新增', added.length, '条:', added.join(' '));
console.log('合并', merged.length, '条:', JSON.stringify(merged));
console.log('题库总数', bank.length);

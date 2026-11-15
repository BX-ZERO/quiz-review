// 题库一致性审计：重复组答案是否一致、解析里的结论与答案是否冲突
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const dir = path.join(__dirname, '..')
const file = path.join(dir, 'questions.js')
const ctx = { window: {} }
vm.runInContext(fs.readFileSync(file, 'utf8'), vm.createContext(ctx), { filename: file })
const QS = ctx.window.QUESTIONS

const plain = s => String(s || '')
  .replace(/<[^>]+>/g, '')
  .replace(/&[a-z]+;/gi, '')
  .replace(/[\s\p{P}\p{S}]/gu, '')
  .replace(/^[0-9]+/, '')
  .toLowerCase()

const grams = s => {
  const g = new Map()
  for (let i = 0; i < s.length - 1; i++) {
    const k = s.slice(i, i + 2)
    g.set(k, (g.get(k) || 0) + 1)
  }
  return g
}
const sim = (a, b) => {
  if (!a || !b) return 0
  const la = a.length, lb = b.length
  if (Math.min(la, lb) / Math.max(la, lb) < 0.65) return 0
  const A = grams(a), B = grams(b)
  let hit = 0
  let na = 0, nb = 0
  A.forEach(v => { na += v })
  B.forEach(v => { nb += v })
  A.forEach((v, k) => { if (B.has(k)) hit += Math.min(v, B.get(k)) })
  return (2 * hit) / (na + nb)
}

const papersOf = q => (Array.isArray(q.papers) && q.papers.length ? q.papers : [q.paper || '未分卷'])

// 1. 重复分组
const groups = []
const seen = new Array(QS.length).fill(-1)
for (let i = 0; i < QS.length; i++) {
  for (let j = i + 1; j < QS.length; j++) {
    if (QS[i].case && QS[i].case === QS[j].case) continue
    if (QS[i].type !== QS[j].type) continue
    if (sim(plain(QS[i].stem), plain(QS[j].stem)) >= 0.82) {
      if (seen[i] === -1 && seen[j] === -1) {
        const g = { ids: [QS[i].id, QS[j].id] }
        groups.push(g)
        seen[i] = groups.length - 1
        seen[j] = groups.length - 1
      } else if (seen[i] === -1) {
        const gi = seen[j]
        groups[gi].ids.push(QS[i].id)
        seen[i] = gi
      } else if (seen[j] === -1) {
        const gi = seen[i]
        groups[gi].ids.push(QS[j].id)
        seen[j] = gi
      }
    }
  }
}

const byId = {}
QS.forEach(q => { byId[q.id] = q })
const key = q => (q.answer || []).slice().sort().join('')
// 按选项文本比较，避免选项顺序不同造成的字母差异
const textKey = q => {
  const map = {}
  ;(q.options || []).forEach(o => { map[o.k] = plain(o.t) })
  return (q.answer || []).map(k => map[k] || k).sort().join('|')
}

let bad = 0
console.log('=== 重复组答案一致性 ===')
groups.forEach((g, idx) => {
  const textSet = new Set(g.ids.map(id => textKey(byId[id])))
  const letterSet = new Set(g.ids.map(id => key(byId[id])))
  if (textSet.size > 1 && letterSet.size > 1) {
    bad++
    console.log(`  不一致 组${idx + 1}: ` + g.ids.map(id => `${id}(${papersOf(byId[id]).join('/')})=${key(byId[id])}`).join('  '))
  }
})
console.log(bad ? `  共 ${bad} 组答案冲突` : `  共 ${groups.length} 组，全部一致`)

// 2. 解析结论与答案冲突
const pickRe = /(?:应选|故选|选)\s*([A-E]{1,5})(?![a-zA-Z\u4e00-\u9fa5])/g
const ansRe = /参考答案\s*[:：]?\s*([A-E]{1,5})/g
console.log('\n=== 解析结论与答案比对 ===')
let conflict = 0
QS.forEach(q => {
  const ex = String(q.explain || '')
  const want = key(q)
  const found = []
  let m
  while ((m = pickRe.exec(ex))) found.push(m[1])
  while ((m = ansRe.exec(ex))) found.push(m[1])
  found.forEach(f => {
    const k = f.split('').sort().join('')
    if (k !== want) {
      conflict++
      console.log(`  ${q.id}  答案=${want}  解析写=${k}  「${ex.replace(/<[^>]+>/g, '').slice(0, 60)}…」`)
    }
  })
})
console.log(conflict ? `  共 ${conflict} 处冲突` : '  无冲突')

// 3. 单选题干出现多个空括号
console.log('\n=== 单选题干括号数 ===')
let hole = 0
QS.forEach(q => {
  const n = (String(q.stem || '').replace(/<[^>]+>/g, '').match(/（\s*）|\(\s*\)/g) || []).length
  if (q.type === 'single' && n > 1) {
    hole++
    console.log(`  ${q.id}  括号${n}个  ${String(q.stem).replace(/<[^>]+>/g, '').slice(0, 46)}`)
  }
})
console.log(hole ? `  共 ${hole} 条需确认` : '  无异常')

// 4. 统计
console.log('\n=== 概览 ===')
const stat = {}
QS.forEach(q => papersOf(q).forEach(p => { stat[p] = (stat[p] || 0) + 1 }))
console.log('  ' + Object.keys(stat).sort().map(p => `${p} ${stat[p]}`).join('　'))
console.log(`  总题数 ${QS.length}　单选 ${QS.filter(q => q.type === 'single').length}　多选 ${QS.filter(q => q.type === 'multi').length}　判断 ${QS.filter(q => q.type === 'judge').length}`)
console.log(`  案例组 ${new Set(QS.filter(q => q.case).map(q => q.case)).size} 个　案例题 ${QS.filter(q => q.case).length} 条`)

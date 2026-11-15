/* 错题复习 · 交互脚本（纯前端单页，数据存 localStorage）
   视图：home / papers / bank / dup / quiz / result / wrong / import
*/
(function () {
  'use strict';

  var LS = { bank: 'qs.bank.v1', stat: 'qs.stat.v1', pref: 'qs.pref.v1', sess: 'qs.session.v1' };
  var TYPE_LABEL = { single: '单选', multi: '多选', judge: '判断' };
  var NO_PAPER = '未分卷';
  var LETTERS = 'ABCDEFGHIJ';

  var BANK = [];
  var STAT = {};
  var DUP = { ids: {}, groups: [] };

  var state = {
    view: 'home',
    quiz: null,
    openEx: {},
    edit: null,
    pending: null,
    pendingStart: null,
    bank: { paper: '', cat: '', type: '', status: 'all', q: '', sel: {} }
  };

  /* ---------------- 基础工具 ---------------- */

  function $(sel) { return document.querySelector(sel); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function stripTags(s) { return String(s || '').replace(/<[^>]*>/g, ''); }

  function uid() {
    return 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      var v = JSON.parse(raw);
      return v === null || v === undefined ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function writeJSON(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {
      toast('浏览器存储写入失败，可能是空间满了');
    }
  }

  var toastTimer = null;
  function toast(msg) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('on'); }, 1900);
  }

  /* ---------------- 数据 ---------------- */

  function normalize(q) {
    var o = q || {};
    var raw = o.options;
    if (!Array.isArray(raw)) raw = [];
    var options = raw.map(function (x, i) {
      if (x && typeof x === 'object') {
        return { k: String(x.k || LETTERS.charAt(i)), t: String(x.t == null ? '' : x.t) };
      }
      return { k: LETTERS.charAt(i), t: String(x == null ? '' : x) };
    });

    var ans = o.answer;
    if (Array.isArray(ans)) {
      ans = ans.map(function (x) { return String(x).toUpperCase().trim(); });
    } else {
      ans = String(ans == null ? '' : ans).toUpperCase().replace(/[^A-J]/g, '').split('');
    }
    ans = ans.filter(Boolean).sort();

    var type = String(o.type || '');
    if (!TYPE_LABEL[type]) type = ans.length > 1 ? 'multi' : 'single';

    var papers = Array.isArray(o.papers) ? o.papers.filter(Boolean).map(String) : [];
    if (!papers.length) {
      var single = String(o.paper || o.from || '');
      if (single) papers = [single];
    }

    var q2 = {
      id: String(o.id || uid()),
      paper: papers[0] || '',
      papers: papers,
      no: String(o.no == null ? '' : o.no),
      type: type,
      category: String(o.category || o.cat || ''),
      stem: String(o.stem || o.title || o.question || ''),
      options: options,
      answer: ans,
      explain: String(o.explain || o.analysis || '')
    };
    var cid = String(o.case || '');
    var cstem = String(o.caseStem || '');
    if (cid) q2.case = cid;
    if (cstem) q2.caseStem = cstem;
    return q2;
  }

  function saveBank() {
    writeJSON(LS.bank, BANK);
    refreshDup();
  }

  function initData() {
    if (localStorage.getItem(LS.bank) === null) {
      var seed = Array.isArray(window.QUESTIONS) ? window.QUESTIONS : [];
      BANK = seed.map(normalize);
      writeJSON(LS.bank, BANK);
    } else {
      var saved = readJSON(LS.bank, []);
      BANK = Array.isArray(saved) ? saved.map(normalize) : [];
    }
    STAT = readJSON(LS.stat, {});
    if (!STAT || typeof STAT !== 'object') STAT = {};
    migrateSeed();
    mergeNewSeed();
    pruneStat();
    refreshDup();
  }

  /* 题库种子加了新卷之后，已有用户打开页面时把新题补进来：
     按 id 和题干双去重，已有的题（含自己导入的）一条都不动。 */
  /* 把题库文件里的新题补进本地题库。
     只在「同一卷里已经有这道题」时跳过；跨卷的重复题各卷各留一条。 */
  function mergeNewSeed() {
    var seed = Array.isArray(window.QUESTIONS) ? window.QUESTIONS : [];
    if (!seed.length) return;
    var haveId = {}, haveKey = {};
    BANK.forEach(function (q) {
      haveId[q.id] = 1;
      papersOf(q).forEach(function (p) { haveKey[p + '|' + normStem(q.stem)] = 1; });
    });
    var added = 0;
    seed.forEach(function (raw) {
      var q = normalize(raw);
      if (haveId[q.id]) return;
      var key = normStem(q.stem);
      if (papersOf(q).some(function (p) { return haveKey[p + '|' + key]; })) return;
      BANK.push(q);
      haveId[q.id] = 1;
      papersOf(q).forEach(function (p) { haveKey[p + '|' + key] = 1; });
      added += 1;
    });
    if (added) writeJSON(LS.bank, BANK);
  }

  /* 老版本的示例题（id 以 seed- 开头）换成新的卷5 题库：
     删掉旧示例题与它们的作答记录，补进新种子，自己导入的题原样保留。 */
  function migrateSeed() {
    var i, hasOld = false;
    for (i = 0; i < BANK.length; i++) {
      if (BANK[i].id.indexOf('seed-') === 0) { hasOld = true; break; }
    }
    if (!hasOld) return;
    var seed = Array.isArray(window.QUESTIONS) ? window.QUESTIONS : [];
    BANK = BANK.filter(function (q) {
      if (q.id.indexOf('seed-') !== 0) return true;
      delete STAT[q.id];
      return false;
    });
    var have = {};
    BANK.forEach(function (q) { have[normStem(q.stem)] = 1; });
    if (seed.length) {
      seed.forEach(function (raw) {
        var q = normalize(raw);
        if (have[normStem(q.stem)]) return;
        BANK.push(q);
      });
    }
    writeJSON(LS.bank, BANK);
    writeJSON(LS.stat, STAT);
  }

  function pruneStat() {
    var have = {};
    var i;
    for (i = 0; i < BANK.length; i++) have[BANK[i].id] = true;
    var changed = false;
    Object.keys(STAT).forEach(function (k) {
      if (!have[k]) { delete STAT[k]; changed = true; }
    });
    if (changed) writeJSON(LS.stat, STAT);
  }

  function byId(id) {
    for (var i = 0; i < BANK.length; i++) if (BANK[i].id === id) return BANK[i];
    return null;
  }

  function recordAnswer(qid, ok, picks) {
    var s = STAT[qid] || { right: 0, wrong: 0 };
    if (ok) s.right += 1; else s.wrong += 1;
    s.last = Date.now();
    s.lastPicks = (picks || []).slice();
    STAT[qid] = s;
    writeJSON(LS.stat, STAT);
  }

  function doneIds() {
    var o = {};
    Object.keys(STAT).forEach(function (k) { o[k] = true; });
    return o;
  }

  function wrongIds() {
    var out = [];
    for (var i = 0; i < BANK.length; i++) {
      var s = STAT[BANK[i].id];
      if (s && s.wrong > 0) out.push(BANK[i].id);
    }
    return out;
  }

  function isCorrect(q, picks) {
    var a = q.answer.slice().sort().join('');
    var b = picks.slice().sort().join('');
    return a !== '' && a === b;
  }

  function paperOf(q) { return q.paper || NO_PAPER; }

  function papersOf(q) {
    if (q.papers && q.papers.length) return q.papers;
    return [paperOf(q)];
  }

  function paperIds(name) {
    var out = [];
    for (var i = 0; i < BANK.length; i++) {
      if (papersOf(BANK[i]).indexOf(name) >= 0) out.push(BANK[i].id);
    }
    return out;
  }

  function papersInfo() {
    var map = {}, order = [];
    BANK.forEach(function (q) {
      papersOf(q).forEach(function (p) {
        if (!map[p]) { map[p] = { name: p, total: 0, done: 0, right: 0, wrong: 0, rate: 0 }; order.push(p); }
        map[p].total += 1;
        var s = STAT[q.id];
        if (s) {
          map[p].done += 1;
          map[p].right += s.right || 0;
          map[p].wrong += s.wrong || 0;
        }
      });
    });
    order.sort(function (a, b) {
      if (a === NO_PAPER) return 1;
      if (b === NO_PAPER) return -1;
      return a.localeCompare(b, 'zh-Hans-CN');
    });
    return order.map(function (p) {
      var x = map[p];
      x.rate = x.done ? Math.round(x.right / x.done * 100) : 0;
      return x;
    });
  }

  function categories() {
    var seen = {}, out = [];
    BANK.forEach(function (q) {
      if (q.category && !seen[q.category]) { seen[q.category] = 1; out.push(q.category); }
    });
    return out.sort(function (a, b) { return a.localeCompare(b, 'zh-Hans-CN'); });
  }

  /* ---------------- 查重 ---------------- */

  function normStem(s) {
    return stripTags(s)
      .replace(/^\s*\d+\s*[.、．]\s*/, '')
      .replace(/[\s\u3000]/g, '')
      .replace(/[（）()【】\[\]、，,。.；;：:？?！!"'“”‘’]/g, '')
      .toLowerCase();
  }

  function grams(s) {
    var g = Object.create(null);
    for (var i = 0; i < s.length - 1; i++) {
      var k = s.slice(i, i + 2);
      g[k] = (g[k] || 0) + 1;
    }
    return g;
  }

  function sim(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    var la = a.length, lb = b.length;
    if (Math.min(la, lb) / Math.max(la, lb) < 0.65) return 0;
    var ga = grams(a), gb = grams(b);
    var hit = 0, total = 0, k;
    for (k in ga) { total += ga[k]; if (gb[k]) hit += Math.min(ga[k], gb[k]); }
    for (k in gb) total += gb[k];
    return total ? (2 * hit) / total : 0;
  }

  function refreshDup() {
    var n = BANK.length;
    var parent = [];
    var i, j;
    for (i = 0; i < n; i++) parent[i] = i;

    function find(x) {
      while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
      return x;
    }

    var keys = BANK.map(function (q) { return { s: normStem(q.stem), t: q.type }; });
    for (i = 0; i < n; i++) {
      for (j = i + 1; j < n; j++) {
        if (keys[i].t !== keys[j].t) continue;
        if (BANK[i].case && BANK[i].case === BANK[j].case) continue;
        if (find(i) === find(j)) continue;
        if (sim(keys[i].s, keys[j].s) >= 0.82) parent[find(i)] = find(j);
      }
    }

    var groups = {}, list = [], ids = {};
    for (i = 0; i < n; i++) {
      var r = find(i);
      if (!groups[r]) groups[r] = [];
      groups[r].push(BANK[i].id);
    }
    Object.keys(groups).forEach(function (k) {
      if (groups[k].length > 1) {
        list.push(groups[k]);
        groups[k].forEach(function (id) { ids[id] = true; });
      }
    });
    DUP = { ids: ids, groups: list };
  }

  /* ---------------- 视图 ---------------- */

  function render() {
    var app = $('#app');
    if (!app) return;
    var html = '';
    if (state.view === 'home') html = viewHome();
    else if (state.view === 'papers') html = viewPapers();
    else if (state.view === 'bank') html = viewBank();
    else if (state.view === 'dup') html = viewDup();
    else if (state.view === 'quiz') html = viewQuiz();
    else if (state.view === 'result') html = viewResult();
    else if (state.view === 'wrong') html = viewWrong();
    else if (state.view === 'import') html = viewImport();
    app.innerHTML = html;
    syncHeader();
    window.scrollTo(0, 0);
  }

  function syncHeader() {
    var sub = $('#hSub'), meta = $('#hMeta'), home = $('#btnHome');
    var titles = {
      home: ['总览', '复习计划'],
      papers: ['题库', '整卷选择，或者去总题库自己挑'],
      bank: ['总题库', '全部题目都在这里'],
      dup: ['重复检查', '题干相似的题会归为一组'],
      quiz: ['答题', ''],
      result: ['成绩', ''],
      wrong: ['错题本', '按试卷归类，同一题错了多少次都能看到'],
      import: ['导入', 'JSON 直接粘进来']
    };
    var t = titles[state.view] || ['总览', ''];
    if (sub) sub.textContent = t[0];
    if (meta) meta.textContent = t[1];
    if (home) home.hidden = state.view === 'home';
  }

  function viewHome() {
    var total = BANK.length;
    var done = 0;
    var wrong = 0;
    BANK.forEach(function (q) {
      if (STAT[q.id]) done += 1;
      if (STAT[q.id] && STAT[q.id].wrong > 0) wrong += 1;
    });
    var html = '';

    if (state.pending && state.pending.ids && state.pending.ids.length) {
      html += '<div class="panel"><div class="pending">' +
        '<div class="pdn">已选 <b>' + state.pending.ids.length + '</b> 题</div>' +
        '<div class="pdc">' + esc(state.pending.title || '自定义') + '</div>' +
        '<div class="pdb">' +
        '<button class="primary" data-act="quickPractice">开始练习</button>' +
        '<button data-act="quickExam">开始考试</button>' +
        '<button class="mini" data-act="clearPending">重新选</button>' +
        '</div></div></div>';
    }

    var qz0 = state.quiz;
    if (qz0 && !qz0.finished && qz0.ids && qz0.ids.length) {
      var pr = progressOf(qz0);
      html += '<div class="panel"><div class="pending resume">' +
        '<div class="pdn">未完成的' + (qz0.mode === 'exam' ? '考试' : '练习') +
        '　<b>' + pr.answered + '</b> / ' + pr.total + ' 题</div>' +
        '<div class="pdc">' + esc(qz0.title || '整库') +
        '　·　停在第 ' + (qz0.i + 1) + ' 题</div>' +
        '<div class="pdb">' +
        '<button class="primary" data-act="resumeQuiz">继续答题</button>' +
        '<button class="mini" data-act="dropQuiz">放弃这次</button>' +
        '</div></div></div>';
    }

    html += '<div class="entry">' +
      '<button data-act="entryPractice"><span class="en">PRACTICE</span>练习模式' +
      '<em>' + (state.pending ? '用已选的 ' + state.pending.ids.length + ' 题' : '整库顺序') + '，选完立刻判对错</em></button>' +
      '<button data-act="entryExam"><span class="en">EXAM</span>考试模式' +
      '<em>' + (state.pending ? '用已选的 ' + state.pending.ids.length + ' 题' : '整库顺序') + '，交卷后统一批改</em></button>' +
      '<button data-act="go" data-view="papers"><span class="en">BANK</span>题库' +
      '<em>按试卷选，或者从总题库勾题组卷</em></button>' +
      '<button data-act="go" data-view="wrong"><span class="en">MISTAKES</span>错题本' +
      '<em>按试卷和题目归类，记错误次数</em></button>' +
      '</div>';

    html += '<div class="panel"><div class="stats">' +
      '<div class="stat"><div class="k">题库</div><div class="v num">' + total + '</div></div>' +
      '<div class="stat"><div class="k">已作答</div><div class="v num">' + done + '</div></div>' +
      '<div class="stat"><div class="k">错题</div><div class="v num">' + wrong + '</div></div>' +
      '<div class="stat"><div class="k">正确率</div><div class="v num">' +
      (done ? Math.round(((done - wrong) / done) * 100) : 0) + '%</div></div>' +
      '</div></div>';

    html += '<div class="panel"><div class="bulkbar">' +
      '<div class="cnt">题库共 <b>' + total + '</b> 题　·　导入或者导出在题库页</div>' +
      '<button class="mini" data-act="go" data-view="import">导入 / 导出</button>' +
      '<button class="mini" data-act="dupCheck">重复检查</button>' +
      '</div></div>';

    return html;
  }

  function viewPapers() {
    var list = papersInfo();
    if (!list.length) {
      return '<div class="empty">还没有题目。<br><b>先去总题库导入一份卷子。</b></div>' +
        '<div class="panel"><div class="bulkbar">' +
        '<button data-act="go" data-view="bank">选择题目</button>' +
        '</div></div>';
    }
    var cards = list.map(function (p) {
      return '<div class="paper">' +
        '<div class="ph"><div class="pn">' + esc(p.name) + '</div>' +
        '<div class="meta">' + p.total + ' 题</div></div>' +
        '<div class="pb">' +
        '<button class="primary" data-act="pickPaper" data-paper="' + esc(p.name) + '">选择这卷</button>' +
        '<button class="mini" data-act="paperView" data-paper="' + esc(p.name) + '">看题目</button>' +
        '</div>' +
        '<div class="meta" style="margin-top:10px">已答 ' + p.done + ' 题　·　正确率 ' + p.rate + '%</div>' +
        '</div>';
    }).join('');

    return '<div class="papers">' + cards + '</div>' +
      '<div class="panel"><div class="bulkbar">' +
      '<div class="cnt"><b>总题库</b>　共 ' + BANK.length + ' 道题，可以自己挑</div>' +
      '<button class="primary" data-act="go" data-view="bank">选择题目</button>' +
      '<button data-act="dupCheck">重复检查</button>' +
      '</div></div>';
  }

  /* 总题库视图里，同一道题在多个卷里重复出现时只留一条 */
  function dedupList(list) {
    if (!DUP.groups.length) return list;
    var groupOf = {}, seen = {};
    DUP.groups.forEach(function (g, gi) {
      g.forEach(function (id) { groupOf[id] = gi; });
    });
    return list.filter(function (q) {
      var gi = groupOf[q.id];
      if (gi == null) return true;
      if (seen[gi]) return false;
      seen[gi] = true;
      return true;
    });
  }

  function filteredBank() {
    var f = state.bank;
    var st = STAT;
    var kw = (f.q || '').trim().toLowerCase();
    var list = BANK.filter(function (q) {
      if (f.paper && papersOf(q).indexOf(f.paper) < 0) return false;
      if (f.cat && q.category !== f.cat) return false;
      if (f.type && q.type !== f.type) return false;
      if (f.status !== 'all') {
        var s = st[q.id];
        if (f.status === 'undone' && s) return false;
        if (f.status === 'wrong' && !(s && s.wrong > 0)) return false;
        if (f.status === 'right' && !(s && s.right > 0)) return false;
      }
      if (kw) {
        var hay = (stripTags(q.stem) + ' ' + q.category + ' ' +
          q.options.map(function (o) { return o.t; }).join(' ')).toLowerCase();
        if (hay.indexOf(kw) < 0) return false;
      }
      return true;
    });
    if (!f.paper) list = dedupList(list);
    return list;
  }

  function viewBank() {
    var f = state.bank;
    var list = filteredBank();
    var papers = papersInfo();
    var selCount = Object.keys(f.sel).filter(function (k) { return f.sel[k]; }).length;

    var paperOpts = '<option value="">全部试卷</option>' + papers.map(function (p) {
      return '<option value="' + esc(p.name) + '"' + (f.paper === p.name ? ' selected' : '') + '>' +
        esc(p.name) + '（' + p.total + '）</option>';
    }).join('');

    var catOpts = '<option value="">全部分类</option>' + categories().map(function (c) {
      return '<option value="' + esc(c) + '"' + (f.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');

    var statusOpts = [['all', '全部状态'], ['undone', '没做过'], ['wrong', '答错过'], ['right', '答对过']]
      .map(function (p) {
        return '<option value="' + p[0] + '"' + (f.status === p[0] ? ' selected' : '') + '>' + p[1] + '</option>';
      }).join('');

    var typeOpts = '<option value="">全部题型</option>' +
      ['single', 'multi', 'judge'].map(function (t) {
        return '<option value="' + t + '"' + (f.type === t ? ' selected' : '') + '>' + TYPE_LABEL[t] + '</option>';
      }).join('');

    var rows = list.map(function (q) {
      var s = STAT[q.id];
      var sm = '<span class="pp">' + esc(papersOf(q).join(' / ')) + '</span>' +
        '<span>' + TYPE_LABEL[q.type] + '</span>' +
        (q.category ? '<span>' + esc(q.category) + '</span>' : '') +
        (q.no ? '<span>原题第 ' + esc(q.no) + ' 题</span>' : '');
      if (s && s.wrong > 0) sm += '<span class="dot-wrong">答错 ' + s.wrong + ' 次</span>';
      if (s && s.right > 0) sm += '<span class="dot-right">答对 ' + s.right + ' 次</span>';
      if (DUP.ids[q.id]) {
        var grp = null;
        for (var gi = 0; gi < DUP.groups.length; gi++) {
          if (DUP.groups[gi].indexOf(q.id) >= 0) { grp = DUP.groups[gi]; break; }
        }
        var also = (grp || []).filter(function (id) { return id !== q.id; })
          .map(function (id) { var o = byId(id); return o ? papersOf(o).join('/') : ''; })
          .filter(Boolean);
        sm += '<span class="duptag">' + (also.length ? '另见 ' + esc(also.join('、')) : '疑似重复') + '</span>';
      }
      sm += '<button class="mini" data-act="editQ" data-id="' + esc(q.id) + '">编辑</button>';

      return '<div class="bankrow">' +
        '<input type="checkbox" data-act="selOne" data-id="' + esc(q.id) + '"' +
        (f.sel[q.id] ? ' checked' : '') + '>' +
        '<div class="bt"><div class="st">' + (q.stem || '（无题干）') + '</div>' +
        '<div class="sm">' + sm + '</div></div>' +
        '</div>';
    }).join('');

    return '<div class="filters">' +
      '<select data-f="paper">' + paperOpts + '</select>' +
      '<select data-f="cat">' + catOpts + '</select>' +
      '<select data-f="type">' + typeOpts + '</select>' +
      '<select data-f="status">' + statusOpts + '</select>' +
      '<input type="search" data-f="q" placeholder="搜题干、选项、分类" value="' + esc(f.q) + '">' +
      '</div>' +
      '<div class="panel">' +
      (list.length ? rows : '<div class="empty">这个筛选条件下没有题目。<br><b>换个条件，或者先去导入题库。</b></div>') +
      '<div class="bulkbar">' +
      '<div class="cnt">已选 <b>' + selCount + '</b> 题　·　当前筛选 <b>' + list.length + '</b> 题</div>' +
      '<button class="mini" data-act="selAll">全选当前</button>' +
      '<button class="mini" data-act="selNone">清空</button>' +
      '<button class="primary" data-act="pickSel">用这 ' + selCount + ' 题</button>' +
      '<button class="mini" data-act="delSel">删除所选</button>' +
      '<button class="mini" data-act="randomPick">随机抽 20 题</button>' +
      '<button class="mini" data-act="openEdit">新增题目</button>' +
      '<button class="mini" data-act="go" data-view="import">导入 / 导出</button>' +
      '</div>' +
      '<div class="meta">题库存在浏览器本地存储里，换设备请先在导入页导出 JSON。</div>' +
      '</div>';
  }

  function viewDup() {
    if (!DUP.groups.length) {
      return '<div class="empty">没有发现重复题目。<br><b>题干相似度达到 0.82 才会被归为一组。</b></div>' +
        '<div class="panel"><div class="bulkbar"><button data-act="go" data-view="bank">回到总题库</button></div></div>';
    }
    var html = DUP.groups.map(function (ids, gi) {
      var rows = ids.map(function (id) {
        var q = byId(id);
        if (!q) return '';
        return '<div class="duprow">' +
          '<div class="dp"><span class="pp">' + esc(papersOf(q).join(' / ')) + '</span></div>' +
          '<div class="dt">' + (q.stem || '（无题干）') + '</div>' +
          '<div class="db">' +
          '<button class="mini" data-act="editQ" data-id="' + esc(q.id) + '">编辑</button>' +
          '<button class="mini" data-act="keepFirst" data-id="' + esc(q.id) + '">删掉其他</button>' +
          '</div></div>';
      }).join('');
      return '<div class="panel"><div class="dgh">第 ' + (gi + 1) + ' 组　·　' + ids.length + ' 道相似题</div>' +
        rows + '</div>';
    }).join('');

    return html +
      '<div class="tip">同一道题在不同卷子里重复出现时会被归到一组。' +
      '不同卷子的同一题可以都留着，也可以只留一条。</div>' +
      '<div class="panel"><div class="bulkbar"><button data-act="go" data-view="bank">回到总题库</button></div></div>';
  }

  function currentQ() {
    var qz = state.quiz;
    if (!qz) return null;
    return byId(qz.ids[qz.i]);
  }

  function caseHtml(q) {
    if (!q || !q.caseStem) return '';
    return '<div class="casemain"><span class="clab">案例</span>' + q.caseStem + '</div>';
  }

  function viewQuiz() {
    var qz = state.quiz;
    if (!qz) return '<div class="empty">没有正在进行的练习。</div>';
    var q = currentQ();
    if (!q) return '<div class="empty">这道题已经不在题库里了。</div>';
    var picks = qz.picks[q.id] || [];
    var judged = !!qz.judged[q.id];
    var open = !!state.openEx[q.id];

    var optsHtml = q.options.map(function (o) {
      var cls = 'opt';
      if (judged) {
        if (q.answer.indexOf(o.k) >= 0) cls += ' is-right';
        else if (picks.indexOf(o.k) >= 0) cls += ' is-wrong';
      } else if (picks.indexOf(o.k) >= 0) {
        cls += ' is-on';
      }
      return '<button class="' + cls + '" data-act="pick" data-k="' + esc(o.k) + '">' +
        '<span class="k">' + esc(o.k) + '</span>' +
        '<span class="t">' + o.t + '</span></button>';
    }).join('');

    var exHtml = '';
    if (q.explain) {
      exHtml = '<div class="ex' + (open ? ' open' : '') + '">' +
        '<button class="extog" data-act="toggleEx"><span class="tri">▶</span>解析</button>' +
        '<div class="exbody">' +
        (judged ? '<div class="ans">正确答案 <b>' + esc(q.answer.join('')) + '</b></div>' : '') +
        '<div class="txt">' + q.explain + '</div>' +
        '</div></div>';
    }

    var head = '<div class="qhead">' +
      '<span class="idx">' + (qz.i + 1) + ' / ' + qz.ids.length + '</span>' +
      '<span class="badge ' + q.type + '">' + TYPE_LABEL[q.type] + '</span>' +
      '<span class="cat">' + esc(papersOf(q).join(' / ')) + (q.no ? ' · 第 ' + esc(q.no) + ' 题' : '') + '</span>' +
      '<button class="mini" style="margin-left:auto" data-act="go" data-view="home">回主页</button>' +
      '</div>';

    var isLast = qz.i === qz.ids.length - 1;
    var canJudge = q.type === 'multi' && !judged && picks.length > 0;

    var pct = Math.round((qz.i + 1) / qz.ids.length * 1000) / 10;

    var bar = '<div class="qbar">' +
      '<div class="pbar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="in">' +
      '<span class="prog">第 <b>' + (qz.i + 1) + '</b> 题　共 ' + qz.ids.length + ' 题</span>' +
      '<span class="keys">数字键选择　← → 翻题　空格展开解析</span>' +
      '<button class="mini" data-act="prev"' + (qz.i === 0 ? ' disabled' : '') + '>上一题</button>' +
      '<button class="mini" data-act="sheet">答题卡</button>' +
      (canJudge ? '<button class="primary" data-act="confirm">确认答案</button>' : '') +
      (isLast
        ? '<button class="primary" data-act="finish">交卷</button>'
        : '<button class="primary" data-act="next">下一题</button>') +
      '</div></div>';

    return '<div class="qcard">' + head +
      caseHtml(q) +
      '<div class="stem">' + (q.stem || '（无题干）') + '</div>' +
      '<div class="opts' + (judged ? ' locked' : '') + '">' + optsHtml + '</div>' +
      exHtml +
      '</div>' + bar;
  }

  function viewResult() {
    var qz = state.quiz;
    if (!qz) return '<div class="empty">没有成绩。</div>';
    var right = 0, wrong = 0, blank = 0;
    var rows = qz.ids.map(function (id) {
      var q = byId(id);
      if (!q) return '';
      var picks = qz.picks[id] || [];
      var ok = picks.length ? isCorrect(q, picks) : false;
      if (!picks.length) blank += 1;
      else if (ok) right += 1;
      else wrong += 1;

      var mine = picks.length ? picks.slice().sort().join('') : '未作答';
      return '<div class="rv ' + (picks.length && ok ? 'ok' : 'no') + '">' +
        '<div class="rvh"><span class="tag">' + (picks.length ? (ok ? '答对' : '答错') : '未答') + '</span>' +
        '<span class="pp">' + esc(papersOf(q).join(' / ')) + '</span>' +
        (q.no ? '<span class="pp">第 ' + esc(q.no) + ' 题</span>' : '') +
        '</div>' +
        '<div class="stem">' + (q.stem || '') + '</div>' +
        '<div class="mine">你的作答 <b>' + esc(mine) + '</b>　正确答案 <b>' +
        esc(q.answer.join('')) + '</b></div>' +
        (q.explain ? '<div class="rv-ex"><span class="lab">解析</span>' + q.explain + '</div>' : '') +
        '</div>';
    }).join('');

    var total = qz.ids.length;
    var rate = total ? Math.round((right / total) * 100) : 0;

    return '<div class="score">' +
      '<div><div class="k">题目数</div><div class="v num">' + total + '</div></div>' +
      '<div><div class="k">答对</div><div class="v num">' + right + '</div></div>' +
      '<div><div class="k">答错</div><div class="v num">' + wrong + '</div></div>' +
      '<div><div class="k">正确率</div><div class="v num">' + rate + '%</div></div>' +
      '</div>' +
      '<div class="panel"><div class="bulkbar">' +
      '<div class="cnt">' + (blank ? '有 <b>' + blank + '</b> 题没作答' : '全部作答完毕') + '</div>' +
      '<button data-act="redoAll">再来一遍</button>' +
      (wrong || blank ? '<button class="primary" data-act="againWrong">只做错的</button>' : '') +
      '<button data-act="go" data-view="home">回总览</button>' +
      '</div></div>' +
      '<div class="review">' + rows + '</div>';
  }

  function viewWrong() {
    var ids = wrongIds();
    if (!ids.length) {
      return '<div class="empty">错题本是空的。<br><b>做错的题会自动收进来。</b></div>' +
        '<div class="panel"><div class="bulkbar"><button data-act="go" data-view="home">回总览</button></div></div>';
    }
    var byPaper = {};
    ids.forEach(function (id) {
      var q = byId(id);
      if (!q) return;
      var p = paperOf(q);
      if (!byPaper[p]) byPaper[p] = [];
      byPaper[p].push(q);
    });

    var names = Object.keys(byPaper).sort(function (a, b) {
      if (a === NO_PAPER) return 1;
      if (b === NO_PAPER) return -1;
      return a.localeCompare(b, 'zh-Hans-CN');
    });

    return names.map(function (name) {
      var list = byPaper[name].slice().sort(function (a, b) {
        return ((STAT[b.id] || {}).wrong || 0) - ((STAT[a.id] || {}).wrong || 0);
      });
      var body = list.map(function (q) {
        var s = STAT[q.id] || {};
        var picks = s.lastPicks && s.lastPicks.length ? s.lastPicks.slice().sort().join('') : '';
        return '<div class="rv no">' +
          '<div class="rvh">' +
          '<span class="tag">错 ' + (s.wrong || 1) + ' 次</span>' +
          (q.no ? '<span class="pp">第 ' + esc(q.no) + ' 题</span>' : '') +
          '<span class="pp">' + TYPE_LABEL[q.type] + '</span>' +
          (s.right ? '<span class="dot-right">后来对过 ' + s.right + ' 次</span>' : '') +
          '</div>' +
          '<div class="stem">' + (q.stem || '') + '</div>' +
          (picks ? '<div class="mine">上次作答 <b>' + esc(picks) + '</b>　正确答案 <b>' +
            esc(q.answer.join('')) + '</b></div>' : '') +
          (q.explain ? '<div class="rv-ex"><span class="lab">解析</span>' + q.explain + '</div>' : '') +
          '<div class="confirmrow">' +
          '<button class="mini" data-act="redoOne" data-id="' + esc(q.id) + '">重做这题</button>' +
          '<button class="mini" data-act="editQ" data-id="' + esc(q.id) + '">编辑</button>' +
          '<button class="mini" data-act="markMastered" data-id="' + esc(q.id) + '">移出错题本</button>' +
          '</div>' +
          '</div>';
      }).join('');

      return '<div class="ghead"><div><b>' + esc(name) + '</b></div>' +
        '<div class="meta">' + list.length + ' 题</div></div>' +
        '<div class="panel"><div class="review">' + body + '</div>' +
        '<div class="bulkbar">' +
        '<button class="primary" data-act="redoPaperWrong" data-paper="' + esc(name) + '">练这一卷的错题</button>' +
        '</div></div>';
    }).join('');
  }

  function viewImport() {
    return '<div class="panel">' +
      '<div class="tip" style="margin-top:0;margin-bottom:10px">' +
      '支持两种：题目数组，或者 <code>{ "questions": [...] }</code>。字段用 ' +
      '<code>stem / options / answer / explain / paper / no / type / category</code>。' +
      'answer 可以写 <code>["B"]</code> 或者 <code>"BC"</code>。</div>' +
      '<textarea class="imptext" id="impText" placeholder="粘贴 JSON"></textarea>' +
      '<div class="confirmrow">' +
      '<button class="primary" data-act="doImport">导入</button>' +
      '<button class="mini" data-act="doExport">导出全部</button>' +
      '<button class="mini" data-act="exportWrong">只导出错题</button>' +
      '<button class="mini" data-act="clearBank">清空题库</button>' +
      '<button class="mini" data-act="clearStat">清空作答记录</button>' +
      '<button class="mini" data-act="seedReset">恢复示例题</button>' +
      '</div>' +
      '<div class="tip">导入时题干和已有题目高度相似的会提示出来，之后可以在重复检查里处理。</div>' +
      '</div>';
  }

  /* ---------------- 弹窗 ---------------- */

  function showModal(html, wide) {
    var m = $('#modal'), box = $('#mbox');
    if (!m || !box) return;
    box.className = 'mbox' + (wide ? ' wide' : '');
    box.innerHTML = html;
    m.classList.add('on');
  }

  function closeModal() {
    var m = $('#modal');
    if (m) m.classList.remove('on');
  }

  function openSheet() {
    var qz = state.quiz;
    if (!qz) return;
    var btns = qz.ids.map(function (id, i) {
      var q = byId(id);
      var cls = '';
      if (i === qz.i) cls += ' now';
      var picks = qz.picks[id] || [];
      if (picks.length) {
        if (qz.judged[id] && q) cls += isCorrect(q, picks) ? ' right' : ' wrong';
        else cls += ' done';
      }
      return '<button class="' + cls.trim() + '" data-act="jump" data-i="' + i + '">' + (i + 1) + '</button>';
    }).join('');
    showModal('<div class="mtt">答题卡</div>' +
      '<div class="mbody"><div class="sheet">' + btns + '</div>' +
      '<div class="tip">浅色是已作答，绿色是答对，红色是答错。</div></div>' +
      '<div class="mact"><button data-act="closeModal">关闭</button>' +
      '<button class="primary" data-act="finish">交卷</button></div>');
  }

  /* ---------------- 题干与解析：所见即所得 ---------------- */

  var RICH_IDS = { stem: ['edStemR', 'edStem'], explain: ['edExR', 'edEx'], case: ['edCaseR', 'edCase'] };
  function richDivId(f) { return (RICH_IDS[f] || RICH_IDS.explain)[0]; }
  function richTaId(f) { return (RICH_IDS[f] || RICH_IDS.explain)[1]; }

  function readRich(f) {
    var div = document.getElementById(richDivId(f));
    var ta = document.getElementById(richTaId(f));
    if (div && !div.hidden) return div.innerHTML;
    return ta ? ta.value : '';
  }

  function toggleRich(f, btn) {
    var div = document.getElementById(richDivId(f));
    var ta = document.getElementById(richTaId(f));
    if (!div || !ta) return;
    if (div.hidden) {
      div.innerHTML = ta.value;
      div.hidden = false;
      ta.hidden = true;
      btn.textContent = '源码';
      div.focus();
    } else {
      ta.value = div.innerHTML;
      ta.hidden = false;
      div.hidden = true;
      btn.textContent = '所见即所得';
      ta.focus();
    }
  }

  function richBlock(f, label, value, extra) {
    var v = value || '';
    return '<div class="erow">' +
      '<div class="lrow"><label>' + label + '</label><div class="rtools">' +
      (extra || '') +
      '<button class="mini" data-act="richToggle" data-f="' + f + '">源码</button>' +
      '</div></div>' +
      '<div class="rich" contenteditable="true" data-rich="' + f + '" id="' + richDivId(f) + '">' +
      v + '</div>' +
      '<textarea class="richsrc" data-rich="' + f + '" id="' + richTaId(f) + '" rows="5" hidden>' +
      esc(v) + '</textarea>' +
      '</div>';
  }

  function insertTable(f) {
    var div = document.getElementById(richDivId(f));
    if (!div || div.hidden) { toast('先切回所见即所得，再插入表格'); return; }
    var html = '<table class="qtable"><thead><tr>' +
      '<th>表头 1</th><th>表头 2</th><th>表头 3</th>' +
      '</tr></thead><tbody>' +
      '<tr><td></td><td></td><td></td></tr>' +
      '<tr><td></td><td></td><td></td></tr>' +
      '</tbody></table>';
    div.focus();
    try {
      var sel = window.getSelection();
      var range = document.createRange();
      range.selectNodeContents(div);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('insertHTML', false, html + '<p><br></p>');
    } catch (e) {
      div.innerHTML += html;
    }
    div.focus();
    toast('表格已插到末尾，直接点单元格填内容');
  }

  function collectForm() {
    var paper = ($('#edPaper') || {}).value || '';
    var no = ($('#edNo') || {}).value || '';
    var cat = ($('#edCat') || {}).value || '';
    var type = ($('#edType') || {}).value || 'single';
    var optsRaw = ($('#edOpts') || {}).value || '';
    var ansRaw = ($('#edAns') || {}).value || '';

    var options = optsRaw.split(/\r?\n/).map(function (line) {
      var s = line.trim();
      if (!s) return null;
      var m = s.match(/^([A-J])\s*[.、．:：]\s*(.*)$/i);
      if (m) return { k: m[1].toUpperCase(), t: m[2] };
      return { k: '', t: s };
    }).filter(Boolean);

    var papers = paper.split(/[、,，;；\s]+/).map(function (s) { return s.trim(); }).filter(Boolean);

    var caseStem = stripTags(readRich('case')).trim() ? readRich('case') : '';

    return {
      paper: papers[0] || '',
      papers: papers,
      no: String(no).trim(),
      type: type,
      category: cat.trim(),
      stem: readRich('stem'),
      caseStem: caseStem,
      case: caseStem ? (($('#edCaseId') || {}).value || '') : '',
      options: options,
      answer: ansRaw.toUpperCase().replace(/[^A-J]/g, '').split(''),
      explain: readRich('explain')
    };
  }

  function previewCard(q) {
    var opts = (q.options || []).map(function (o, i) {
      var cls = 'opt' + (i === 0 ? ' is-on' : '');
      return '<button type="button" class="' + cls + '">' +
        '<span class="k">' + esc(o.k || String.fromCharCode(65 + i)) + '</span>' +
        '<span class="t">' + (o.t || '') + '</span></button>';
    }).join('');

    var ansTxt = (q.answer && q.answer.length) ? q.answer.join('') : '—';

    return '<div class="qcard">' +
      '<div class="qhead"><span class="idx">1 / 1</span>' +
      '<span class="badge ' + (q.type || 'single') + '">' +
      (TYPE_LABEL[q.type] || '单选') + '</span>' +
      '<span class="cat">' + esc((q.papers || [q.paper]).join(' / ')) +
      (q.no ? ' · 第 ' + esc(q.no) + ' 题' : '') + '</span></div>' +
      caseHtml(q) +
      '<div class="stem">' + (q.stem || '<span class="hint">（题干还是空的）</span>') + '</div>' +
      '<div class="opts">' + opts + '</div>' +
      (q.explain ?
        '<div class="ex open"><div class="extog"><span class="tri">▶</span>解析</div>' +
        '<div class="exbody"><div class="ans">正确答案 <b>' + esc(ansTxt) + '</b></div>' +
        '<div class="txt">' + q.explain + '</div></div></div>' : '') +
      '</div>';
  }

  function openPreview() {
    var box = document.getElementById('mbox');
    if (!box) return;
    var old = box.querySelector('.prevlayer');
    if (old && old.parentNode) old.parentNode.removeChild(old);

    var layer = document.createElement('div');
    layer.className = 'prevlayer';
    layer.innerHTML = '<div class="prevbar">预览：做题时的样子' +
      '<button class="mini" data-act="closePreview">关闭预览</button></div>' +
      previewCard(collectForm());
    box.appendChild(layer);
  }

  function openEdit(id) {
    var q = id ? byId(id) : null;
    var papers = papersInfo().map(function (p) { return p.name; })
      .filter(function (n) { return n !== NO_PAPER; });

    var optsText = q ? q.options.map(function (o) { return o.k + '. ' + stripTags(o.t); }).join('\n') : '';

    var html = '<div class="mtt">' + (q ? '编辑题目' : '新增题目') + '</div>' +
      '<div class="mbody"><div class="frm">' +
      '<div class="erow"><label>所属试卷（多卷用、分开）</label>' +
      '<input id="edPaper" value="' + esc(q ? papersOf(q).join('、') : (papers[0] || '卷1')) + '" list="paperList">' +
      '<datalist id="paperList">' + papers.map(function (p) {
        return '<option value="' + esc(p) + '">';
      }).join('') + '</datalist></div>' +
      '<div class="erow"><label>原题号</label>' +
      '<input id="edNo" value="' + esc(q ? q.no : '') + '"></div>' +
      '<div class="erow"><label>分类</label>' +
      '<input id="edCat" value="' + esc(q ? q.category : '') + '"></div>' +
      '<div class="erow"><label>题型</label>' +
      '<select id="edType">' +
      ['single', 'multi', 'judge'].map(function (t) {
        return '<option value="' + t + '"' + (q && q.type === t ? ' selected' : '') + '>' +
          TYPE_LABEL[t] + '</option>';
      }).join('') + '</select></div>' +
      '<div class="erow"><label>案例组（同一案例的各小题填同一编号；留空表示不是案例题）</label>' +
      '<input id="edCaseId" value="' + esc(q && q.case ? q.case : '') + '" placeholder="如 c2-1"></div>' +
      richBlock('case', '案例背景（几个小题共用的长题干）', q && q.caseStem ? q.caseStem : '') +
      richBlock('stem', '题干', q ? q.stem : '',
        '<button class="mini" data-act="insertTable" data-f="stem">插入表格</button>') +
      '<div class="erow"><label>选项（一行一个，写成 A. 内容）</label>' +
      '<textarea id="edOpts" rows="6">' + esc(optsText) + '</textarea></div>' +
      '<div class="erow"><label>答案（如 B 或 BDE）</label>' +
      '<input id="edAns" value="' + esc(q ? q.answer.join('') : '') + '"></div>' +
      richBlock('explain', '解析', q ? q.explain : '',
        '<button class="mini" data-act="insertTable" data-f="explain">插入表格</button>') +
      '</div></div>' +
      '<div class="mact">' +
      (q ? '<button data-act="delOne" data-id="' + esc(q.id) + '">删除</button>' : '') +
      '<button data-act="previewQ">预览</button>' +
      '<button data-act="closeModal">取消</button>' +
      '<button class="primary" data-act="saveEdit" data-id="' + esc(q ? q.id : '') + '">保存</button>' +
      '</div>';

    showModal(html, true);
  }

  function saveEdit(id) {
    var data = collectForm();
    var plain = stripTags(data.stem).trim();
    if (!plain && !/<img/i.test(data.stem)) { toast('题干不能为空'); return; }
    if (!data.options.length) { toast('至少写一个选项'); return; }
    if (!data.answer.length) { toast('答案不能为空'); return; }

    data.id = id || uid();

    var idx = -1;
    for (var i = 0; i < BANK.length; i++) if (BANK[i].id === data.id) { idx = i; break; }
    var item = normalize(data);
    if (idx >= 0) BANK[idx] = item; else BANK.push(item);
    saveBank();
    closeModal();
    toast('已保存');
    if (state.view === 'quiz' && !byId(state.quiz.ids[state.quiz.i])) state.view = 'bank';
    render();
  }

  /* ---------------- 答题流程 ---------------- */

  function saveSession() {
    var qz = state.quiz;
    if (!qz || qz.finished) {
      try { localStorage.removeItem(LS.sess); } catch (e) {}
      return;
    }
    writeJSON(LS.sess, { quiz: qz, openEx: state.openEx });
  }

  function loadSession() {
    var s = readJSON(LS.sess, null);
    if (!s || !s.quiz || !s.quiz.ids || !s.quiz.ids.length) return;
    var alive = s.quiz.ids.filter(function (id) { return !!byId(id); });
    if (!alive.length) {
      try { localStorage.removeItem(LS.sess); } catch (e) {}
      return;
    }
    s.quiz.ids = alive;
    if (s.quiz.i >= alive.length) s.quiz.i = alive.length - 1;
    if (!s.quiz.picks) s.quiz.picks = {};
    if (!s.quiz.judged) s.quiz.judged = {};
    if (s.quiz.mode !== 'exam') s.quiz.mode = 'practice';
    state.quiz = s.quiz;
    state.openEx = s.openEx || {};
  }

  function progressOf(qz) {
    var answered = 0;
    qz.ids.forEach(function (id) {
      if (qz.picks[id] && qz.picks[id].length) answered += 1;
    });
    return { answered: answered, total: qz.ids.length };
  }

  function startQuiz(ids, mode, title) {
    if (!ids.length) { toast('没有可用的题目'); return; }
    var old = state.quiz;
    if (old && !old.finished && old.ids && old.ids.length) {
      state.pendingStart = { ids: ids, mode: mode, title: title };
      showModal('<div class="mtt">还有一次没有答完</div>' +
        '<div class="mbody"><p>上一次的' + (old.mode === 'exam' ? '考试' : '练习') +
        '停在 ' + (old.i + 1) + ' / ' + old.ids.length + ' 题，已经答了 ' +
        progressOf(old).answered + ' 题。<br>开新的一次会把它顶掉。</p></div>' +
        '<div class="mact"><button data-act="closeModal">先不开了</button>' +
        '<button class="primary" data-act="forceStart">开新的</button></div>');
      return;
    }
    doStartQuiz(ids, mode, title);
  }

  function doStartQuiz(ids, mode, title) {
    state.quiz = { ids: ids.slice(), mode: mode, title: title || '', i: 0, picks: {}, judged: {}, finished: false };
    state.openEx = {};
    state.view = 'quiz';
    saveSession();
    render();
  }

  function pendingIds() {
    if (state.pending && state.pending.ids && state.pending.ids.length) return state.pending.ids.slice();
    return null;
  }

  function allIds() {
    return dedupList(BANK).map(function (q) { return q.id; });
  }

  function goQuiz(i) {
    var qz = state.quiz;
    if (!qz) return;
    if (i < 0 || i >= qz.ids.length) return;
    qz.i = i;
    saveSession();
    render();
  }

  function onPick(k) {
    var qz = state.quiz;
    if (!qz) return;
    var q = currentQ();
    if (!q) return;
    if (qz.judged[q.id]) return;

    var picks = qz.picks[q.id] || [];
    if (q.type === 'multi') {
      var at = picks.indexOf(k);
      if (at >= 0) picks.splice(at, 1);
      else picks.push(k);
      picks.sort();
      qz.picks[q.id] = picks;
      saveSession();
      render();
    } else {
      qz.picks[q.id] = [k];
      judgeCurrent();
    }
  }

  function judgeCurrent() {
    var qz = state.quiz;
    if (!qz) return;
    var q = currentQ();
    if (!q) return;
    if (qz.judged[q.id]) return;
    var picks = qz.picks[q.id] || [];
    if (!picks.length) return;

    qz.judged[q.id] = true;
    if (qz.mode === 'practice') {
      recordAnswer(q.id, isCorrect(q, picks), picks);
      state.openEx[q.id] = true;
    }
    saveSession();
    render();
  }

  function finishQuiz(force) {
    var qz = state.quiz;
    if (!qz) return;

    if (qz.mode === 'exam') {
      var blank = qz.ids.filter(function (id) {
        var p = qz.picks[id];
        return !p || !p.length;
      }).length;
      if (blank > 0 && !force) {
        showModal('<div class="mtt">还有题没做完</div>' +
          '<div class="mbody"><p>一共 ' + qz.ids.length + ' 题，还有 <b>' + blank +
          '</b> 题没作答。交卷之后这几题记作未答。</p></div>' +
          '<div class="mact"><button data-act="closeModal">继续答题</button>' +
          '<button class="primary" data-act="finish" data-force="1">仍然交卷</button></div>');
        return;
      }
      qz.ids.forEach(function (id) {
        var q = byId(id);
        if (!q) return;
        var picks = qz.picks[id] || [];
        if (!picks.length) return;
        if (!qz.judged[id]) {
          qz.judged[id] = true;
          recordAnswer(id, isCorrect(q, picks), picks);
        }
      });
    }
    closeModal();
    qz.finished = true;
    saveSession();
    state.view = 'result';
    render();
  }

  /* ---------------- 导入导出 ---------------- */

  function doImport() {
    var ta = $('#impText');
    if (!ta) return;
    var text = ta.value.trim();
    if (!text) { toast('先贴点内容'); return; }

    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      toast('JSON 格式不对：' + e.message.slice(0, 40));
      return;
    }
    var arr = Array.isArray(parsed) ? parsed
      : (parsed && Array.isArray(parsed.questions) ? parsed.questions : null);
    if (!arr) { toast('需要一个数组，或者 { questions: [...] }'); return; }

    var added = 0, dupCount = 0;
    arr.forEach(function (raw) {
      var q = normalize(raw);
      var key = normStem(q.stem);
      var hit = false;
      for (var i = 0; i < BANK.length; i++) {
        if (normStem(BANK[i].stem) === key) { hit = true; break; }
      }
      if (hit) dupCount += 1;
      BANK.push(q);
      added += 1;
    });

    saveBank();
    ta.value = '';
    toast('导入 ' + added + ' 题' + (dupCount ? '，其中 ' + dupCount + ' 题和已有题干相同' : ''));
    state.view = 'bank';
    render();
  }

  function download(name, text) {
    var blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function exportBank(onlyWrong) {
    var list = onlyWrong
      ? BANK.filter(function (q) { var s = STAT[q.id]; return s && s.wrong > 0; })
      : BANK;
    if (!list.length) { toast('没有可导出的题目'); return; }
    var d = new Date();
    var stamp = '' + d.getFullYear() +
      ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2);
    download('错题题库-' + stamp + (onlyWrong ? '-错题' : '') + '.json', JSON.stringify(list, null, 2));
    toast('已导出 ' + list.length + ' 题');
  }

  /* ---------------- 主题 ---------------- */

  function initTheme() {
    var pref = readJSON(LS.pref, {});
    var mode = pref && pref.theme;
    if (mode !== 'dark' && mode !== 'light') {
      mode = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    }
    applyTheme(mode);
  }

  function applyTheme(mode) {
    var html = document.documentElement;
    if (mode === 'dark') html.setAttribute('data-theme', 'dark');
    else html.removeAttribute('data-theme');
    updateThemeBtn(mode);
    var pref = readJSON(LS.pref, {}) || {};
    pref.theme = mode;
    writeJSON(LS.pref, pref);
  }

  function updateThemeBtn(mode) {
    var b = $('#btnTheme');
    if (!b) return;
    var next = mode === 'dark' ? '切到浅色' : '切到深色';
    b.setAttribute('title', next);
    b.setAttribute('aria-label', next);
  }

  function toggleTheme() {
    var cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    applyTheme(cur === 'dark' ? 'light' : 'dark');
  }

  /* ---------------- 动作 ---------------- */

  var ACTIONS = {
    go: function (el) {
      var v = el.getAttribute('data-view');
      if (v) { state.view = v; render(); }
    },
    entryPractice: function () {
      startQuiz(pendingIds() || allIds(), 'practice', state.pending ? state.pending.title : '整库练习');
    },
    entryExam: function () {
      startQuiz(pendingIds() || allIds(), 'exam', state.pending ? state.pending.title : '整库考试');
    },
    quickPractice: function () {
      startQuiz(pendingIds() || allIds(), 'practice', state.pending ? state.pending.title : '');
    },
    quickExam: function () {
      startQuiz(pendingIds() || allIds(), 'exam', state.pending ? state.pending.title : '');
    },
    clearPending: function () {
      state.pending = null;
      render();
      toast('已清空待答组卷');
    },
    resumeQuiz: function () {
      var qz = state.quiz;
      if (!qz) { toast('没有进行中的答题'); return; }
      state.view = 'quiz';
      render();
    },
    forceStart: function () {
      var p = state.pendingStart;
      state.pendingStart = null;
      closeModal();
      if (!p) return;
      doStartQuiz(p.ids, p.mode, p.title);
    },
    dropQuiz: function () {
      state.quiz = null;
      state.openEx = {};
      saveSession();
      render();
      toast('已经放弃这次答题');
    },
    pickPaper: function (el) {
      var name = el.getAttribute('data-paper');
      var ids = paperIds(name);
      if (!ids.length) { toast('这卷没有题目'); return; }
      state.pending = { ids: ids, title: name };
      state.view = 'home';
      render();
      toast('已选 ' + ids.length + ' 题，回主页开始');
    },
    paperView: function (el) {
      state.bank.paper = el.getAttribute('data-paper') || '';
      state.view = 'bank';
      render();
    },
    pick: function (el) { onPick(el.getAttribute('data-k')); },
    confirm: function () { judgeCurrent(); },
    prev: function () { goQuiz((state.quiz ? state.quiz.i : 0) - 1); },
    next: function () { goQuiz((state.quiz ? state.quiz.i : 0) + 1); },
    sheet: function () { openSheet(); },
    jump: function (el) {
      var i = parseInt(el.getAttribute('data-i'), 10);
      closeModal();
      goQuiz(i);
    },
    finish: function (el) { finishQuiz(el.getAttribute('data-force') === '1'); },
    toggleEx: function () {
      var q = currentQ();
      if (!q) return;
      state.openEx[q.id] = !state.openEx[q.id];
      render();
    },
    closeModal: function () { closeModal(); },
    editQ: function (el) { openEdit(el.getAttribute('data-id')); },
    openEdit: function () { openEdit(''); },
    saveEdit: function (el) { saveEdit(el.getAttribute('data-id') || ''); },
    richToggle: function (el) { toggleRich(el.getAttribute('data-f'), el); },
    insertTable: function (el) { insertTable(el.getAttribute('data-f')); },
    previewQ: function () { openPreview(); },
    closePreview: function () {
      var box = document.getElementById('mbox');
      var layer = box ? box.querySelector('.prevlayer') : null;
      if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
    },
    delOne: function (el) {
      var id = el.getAttribute('data-id');
      showModal('<div class="mtt">删除这道题</div>' +
        '<div class="mbody"><p>删掉之后就找不回来了。</p></div>' +
        '<div class="mact"><button data-act="closeModal">算了</button>' +
        '<button class="primary" data-act="doDel" data-id="' + esc(id) + '">删除</button></div>');
    },
    doDel: function (el) {
      var id = el.getAttribute('data-id');
      BANK = BANK.filter(function (q) { return q.id !== id; });
      if (STAT[id]) { delete STAT[id]; writeJSON(LS.stat, STAT); }
      saveBank();
      closeModal();
      render();
      toast('已删除');
    },
    selAll: function () {
      filteredBank().forEach(function (q) { state.bank.sel[q.id] = true; });
      render();
    },
    selNone: function () {
      state.bank.sel = {};
      render();
    },
    pickSel: function () {
      var ids = Object.keys(state.bank.sel).filter(function (k) { return state.bank.sel[k]; });
      if (!ids.length) { toast('还没选题目'); return; }
      var names = {};
      ids.forEach(function (id) { var q = byId(id); if (q) names[paperOf(q)] = 1; });
      state.pending = { ids: ids, title: Object.keys(names).join('、') || '自定义' };
      state.bank.sel = {};
      state.view = 'home';
      render();
      toast('已选 ' + ids.length + ' 题，回主页开始');
    },
    delSel: function () {
      var ids = Object.keys(state.bank.sel).filter(function (k) { return state.bank.sel[k]; });
      if (!ids.length) { toast('还没选题目'); return; }
      showModal('<div class="mtt">删除所选</div>' +
        '<div class="mbody"><p>要删掉 <b>' + ids.length + '</b> 道题，删了就拿不回来。</p></div>' +
        '<div class="mact"><button data-act="closeModal">算了</button>' +
        '<button class="primary" data-act="doDelSel">删除</button></div>');
    },
    doDelSel: function () {
      var ids = Object.keys(state.bank.sel).filter(function (k) { return state.bank.sel[k]; });
      var set = {};
      ids.forEach(function (k) { set[k] = 1; if (STAT[k]) delete STAT[k]; });
      BANK = BANK.filter(function (q) { return !set[q.id]; });
      state.bank.sel = {};
      writeJSON(LS.stat, STAT);
      saveBank();
      closeModal();
      render();
      toast('删了 ' + ids.length + ' 题');
    },
    randomPick: function () {
      var pool = filteredBank();
      if (!pool.length) { toast('当前没有可选题目'); return; }
      pool = pool.slice();
      for (var i = pool.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = pool[i]; pool[i] = pool[j]; pool[j] = t;
      }
      pool.slice(0, 20).forEach(function (q) { state.bank.sel[q.id] = true; });
      render();
      toast('随机选了 ' + Math.min(20, pool.length) + ' 题');
    },
    dupCheck: function () {
      refreshDup();
      state.view = 'dup';
      render();
    },
    keepFirst: function (el) {
      var id = el.getAttribute('data-id');
      var group = null;
      DUP.groups.forEach(function (g) { if (g.indexOf(id) >= 0) group = g; });
      if (!group) return;
      var set = {};
      group.forEach(function (x) { if (x !== id) set[x] = 1; });
      BANK = BANK.filter(function (q) { return !set[q.id]; });
      Object.keys(set).forEach(function (k) { if (STAT[k]) delete STAT[k]; });
      writeJSON(LS.stat, STAT);
      saveBank();
      render();
      toast('只留了这一条');
    },
    againWrong: function () {
      var qz = state.quiz;
      if (!qz) return;
      var ids = qz.ids.filter(function (id) {
        var q = byId(id);
        var picks = qz.picks[id] || [];
        return q && (!picks.length || !isCorrect(q, picks));
      });
      if (!ids.length) { toast('这次没有错题'); return; }
      startQuiz(ids, qz.mode, '错题重做');
    },
    redoAll: function () {
      var qz = state.quiz;
      if (!qz) return;
      startQuiz(qz.ids, qz.mode, qz.title);
    },
    redoOne: function (el) { startQuiz([el.getAttribute('data-id')], 'practice', '单题重做'); },
    redoPaperWrong: function (el) {
      var name = el.getAttribute('data-paper');
      var ids = paperIds(name).filter(function (id) {
        var s = STAT[id];
        return s && s.wrong > 0;
      });
      if (!ids.length) { toast('这卷没有错题'); return; }
      startQuiz(ids, 'practice', name + ' 错题');
    },
    markMastered: function (el) {
      var id = el.getAttribute('data-id');
      if (!STAT[id]) return;
      STAT[id].wrong = 0;
      writeJSON(LS.stat, STAT);
      render();
      toast('已移出错题本');
    },
    doImport: function () { doImport(); },
    doExport: function () { exportBank(false); },
    exportWrong: function () { exportBank(true); },
    clearBank: function () {
      showModal('<div class="mtt">清空题库</div>' +
        '<div class="mbody"><p>清空后可以点「恢复示例题」再灌回自带的那 30 题，' +
        '但自己导入的题会丢失。</p><p>建议先导出 JSON 备份。</p></div>' +
        '<div class="mact"><button data-act="closeModal">算了</button>' +
        '<button class="primary" data-act="doClearBank">清空</button></div>');
    },
    doClearBank: function () {
      BANK = [];
      saveBank();
      closeModal();
      state.view = 'bank';
      render();
      toast('题库已清空');
    },
    clearStat: function () {
      STAT = {};
      writeJSON(LS.stat, STAT);
      render();
      toast('作答记录已清空');
    },
    seedReset: function () {
      var seed = Array.isArray(window.QUESTIONS) ? window.QUESTIONS : [];
      if (!seed.length) { toast('没有示例题'); return; }
      var have = {};
      BANK.forEach(function (q) { have[normStem(q.stem)] = 1; });
      var added = 0;
      seed.forEach(function (raw) {
        var q = normalize(raw);
        if (have[normStem(q.stem)]) return;
        BANK.push(q);
        added += 1;
      });
      saveBank();
      render();
      toast(added ? '补回 ' + added + ' 题' : '示例题都已经在题库里了');
    }
  };

  /* ---------------- 事件 ---------------- */

  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el) return;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return;
    var act = el.getAttribute('data-act');
    if (!act) return;
    var fn = ACTIONS[act];
    if (!fn) return;
    e.preventDefault();
    fn(el);
  });

  document.addEventListener('change', function (e) {
    var el = e.target;
    if (!el || !el.getAttribute) return;
    if (el.getAttribute('data-act') === 'selOne') {
      state.bank.sel[el.getAttribute('data-id')] = !!el.checked;
      render();
      return;
    }
    var f = el.getAttribute('data-f');
    if (!f) return;
    if (f === 'q') { state.bank.q = el.value; return; }
    state.bank[f] = el.value;
    render();
  });

  document.addEventListener('input', function (e) {
    var el = e.target;
    if (!el || !el.getAttribute) return;
    if (el.getAttribute('data-f') !== 'q') return;
    state.bank.q = el.value;
    var app = $('#app');
    if (!app) return;
    app.innerHTML = viewBank();
    var box = app.querySelector('[data-f="q"]');
    if (box) { box.focus(); }
  });

  document.addEventListener('keydown', function (e) {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    var modal = $('#modal');
    if (modal && modal.classList.contains('on')) {
      if (e.key === 'Escape') { closeModal(); e.preventDefault(); }
      return;
    }
    if (state.view !== 'quiz') return;
    var k = e.key;
    if (/^[a-jA-J]$/.test(k)) {
      var q = currentQ();
      if (!q) return;
      var letter = k.toUpperCase();
      for (var i = 0; i < q.options.length; i++) {
        if (q.options[i].k === letter) { onPick(letter); e.preventDefault(); return; }
      }
    } else if (k === 'ArrowLeft') {
      goQuiz((state.quiz ? state.quiz.i : 0) - 1);
      e.preventDefault();
    } else if (k === 'ArrowRight') {
      goQuiz((state.quiz ? state.quiz.i : 0) + 1);
      e.preventDefault();
    } else if (k === 'Enter') {
      var qq = currentQ();
      if (qq && qq.type === 'multi') { judgeCurrent(); e.preventDefault(); }
    } else if (k === ' ' || k === 'Spacebar') {
      var qs = currentQ();
      if (qs) {
        state.openEx[qs.id] = !state.openEx[qs.id];
        render();
        e.preventDefault();
      }
    }
  });

  /* ---------------- 启动 ---------------- */

  function boot() {
    initTheme();
    initData();
    loadSession();
    var tb = $('#btnTheme');
    if (tb) tb.addEventListener('click', toggleTheme);
    var hb = $('#btnHome');
    if (hb) hb.addEventListener('click', function () {
      state.view = 'home';
      render();
    });
    state.view = 'home';
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

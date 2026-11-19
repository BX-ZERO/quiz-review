# 错题复习 / Quiz Review

`v1.1.1`

考试错题练习页。纯静态，无后端、无依赖。

## 使用

双击 `index.html` 即可，也可以用任意静态服务器托管。手机上打开 GitHub Pages 地址同样可用。

## 题库

共 222 道题，按 7 卷归档，其中 17 道属于 8 个案例组（同一案例背景下的多个小题）。

| 卷 | 题数 |
|---|---|
| 卷1 | 28 |
| 卷2 | 33 |
| 卷3 | 34 |
| 卷4 | 29 |
| 卷5 | 30 |
| 卷6 | 26 |
| 卷7 | 23 |

题库数据在 `questions.js`，格式为 `window.QUESTIONS = [...]`，每条字段：

```js
{
  id: "j3-06",        // 唯一标识
  paper: "卷3",       // 主卷
  papers: ["卷3"],    // 所属全部试卷
  no: "14",           // 卷内题号，原卷未显示题号时为空
  type: "single",     // single / multi / judge
  category: "材料堆放",
  stem: "题干（可含 HTML 表格与图片）",
  options: [{ k: "A", t: "选项文字" }],
  answer: ["B"],
  explain: "解析（含 <div class=\"src\">依据</div> 块）",
  case: "c3-1",       // 可选：案例组
  caseStem: "案例背景" // 可选：多个小题共用
}
```

## 功能

- 练习模式：选中即判，错的标红，解析随时展开
- 考试模式：答题不提示，交卷后统一批改
- 按卷选题，或去总题库自己挑；重复题只在总题库里合并显示
- 错题本按卷与题目归类，统计错误次数
- 题库管理：筛选、查重、逐条编辑（所见即所得，可插入表格）、JSON 导入导出
- 深浅色切换，答题页常驻快捷键提示（数字键选择、← → 翻题、空格展开解析）
- 进度与作答记录存 localStorage，答一半关页面也能继续

## tools

本地维护脚本，需要 Node.js。

| 脚本 | 用途 |
|---|---|
| `node tools/check.js` | 题库体检：字段完整性、答案合法性、乱码、解析过短 |
| `node tools/dup-check.js [阈值]` | 查重报告，默认相似度 0.82，分「同卷内 / 跨卷」两组 |
| `node tools/audit.js` | 一致性审计：重复组答案比对、解析结论与答案比对 |
| `node tools/merge.js <卷名> <json>` | 把一批新题并入题库，同卷重复合并、跨卷重复各留一条 |
| `node tools/render-test.js` | 渲染回归，跑一遍主要交互 |
| `node tools/resume-test.js` | 续答功能回归 |

## 说明

题目的原始截图不在本仓库内。题库内容以题库答案为准，部分题目与现行规范存在出入的，已在解析的「依据」里注明。

---

<a href="https://github.com/deepseek-ai/deepseek-harness"><img src="img/dsh-badge.png" width="121" height="20" alt="powered by dsh"></a>

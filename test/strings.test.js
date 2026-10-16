'use strict';

/**
 * 生成文案产物（miniapp/shared/strings.js）的验收测试
 * 覆盖本计划 §4.3「生成后的断言」与 §4.5 strings.test.js 列出的全部条目。
 *
 * 这些断言是「资产 → 代码」的接缝检查：资产被改动而生成器未同步时，
 * 这里与 `gen-strings.js --check` 会同时报错。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const constants = require('../shared/constants.js');
const strings = require('../miniapp/shared/strings.js');
const display = require('../miniapp/core/display.js');

const DOCS = path.join(__dirname, '..', '..');
const QUIZ_ASSET = path.join(DOCS, '文案资产-10题题库与计分表.md');

// ─────────────────────────────────────────────────────────────
// 条目数
// ─────────────────────────────────────────────────────────────

test('条目数：免责 6 处 / 题目 10 道且分区 3/3/2/2 / 原型 16 条 / 档位 5 条 / 状态提示 3 条', () => {
  assert.equal(Object.keys(strings.disclaimers).length, 6);
  assert.equal(strings.quiz.questions.length, 10);
  assert.equal(Object.keys(strings.archetypes).length, 16);
  assert.equal(strings.bands.length, 5);
  assert.equal(Object.keys(strings.pairStates).length, 3);

  const dist = { D1: 0, D2: 0, D3: 0, D4: 0 };
  for (const q of strings.quiz.questions) dist[q.dim]++;
  assert.deepEqual(dist, { D1: 3, D2: 3, D3: 2, D4: 2 });
  assert.equal(strings.quiz.questions.length, constants.REQUIRED_ANSWER_COUNT);

  for (const q of strings.quiz.questions) {
    assert.equal(q.options.length, 2, `${q.id} 应为二选一`);
    assert.deepEqual(q.options.map((o) => o.id), ['A', 'B']);
    assert.ok(q.stem.length > 0, `${q.id} 题干非空`);
    for (const o of q.options) assert.ok(o.text.length > 0, `${q.id}${o.id} 选项非空`);
  }
});

test('免责 6 处非空且逐条互不相同', () => {
  const values = Object.values(strings.disclaimers);
  for (const [key, text] of Object.entries(strings.disclaimers)) {
    assert.ok(text.length > 0, `${key} 免责文案非空`);
  }
  assert.equal(new Set(values).size, 6, '六处措辞各不相同（PRD 4.4 逐字）');
});

// ─────────────────────────────────────────────────────────────
// 逐字一致断言
// ─────────────────────────────────────────────────────────────

test('答题页免责与题库 §1.1 引导语：仅差首字（资产间不一致，生成器已提示并以 PRD §4.4 为准）', () => {
  assert.equal(strings.quiz.intro, strings.disclaimers.quiz, '答题页两处页面文字必须同一句');

  const asset = fs.readFileSync(QUIZ_ASSET, 'utf8');
  const found = asset.match(/答题页统一引导语：`([^`]+)`/);
  assert.ok(found, '题库 §1.1 应给出答题页统一引导语');
  assert.equal(
    strings.quiz.intro.slice(1),
    found[1],
    '题库 §1.1 引导语较 PRD §4.4 答题页少一个首字，此处固化为已知差异'
  );
  assert.equal(strings.quiz.intro.slice(0, 1), '请');
});

test('5 档标签与 PRD 3.5（常量源 BAND_BY_C）逐字一致，且下标即 C 值', () => {
  assert.equal(strings.bands.length, constants.BAND_BY_C.length);
  strings.bands.forEach((band, c) => {
    assert.equal(band.c, c, `bands[${c}].c 应等于下标`);
    assert.equal(band.label, constants.BAND_BY_C[c], `C=${c} 标签须与常量源逐字一致`);
  });
  assert.deepEqual(
    strings.bands.map((b) => b.label),
    ['极致互补型', '差异互补型', '均衡互补型', '高默契型', '同频共振型']
  );
});

test('5 档免责提示五档完全一致，且与 PRD 4.4 配对页措辞逐字一致', () => {
  for (const band of strings.bands) {
    assert.equal(band.disclaimer, strings.disclaimers.pair, `C=${band.c} 免责提示须与配对页逐字一致`);
    assert.equal(band.hints.length, 3, `C=${band.c} 应有 3 条相处提示`);
    assert.ok(band.summary.length > 0, `C=${band.c} 概述非空`);
  }
  assert.equal(new Set(strings.bands.map((b) => b.disclaimer)).size, 1);
});

test('16 原型名与常量源逐字一致，且解读结构完整（①概述 ②3 条特质 ③提示 ④免责）', () => {
  for (const [code, known] of Object.entries(constants.ARCHETYPES)) {
    const text = strings.archetypes[code];
    assert.ok(text, `缺少原型 ${code} 的解读`);
    assert.equal(text.code, code);
    assert.equal(text.name, known.name, `${code} 原型名须与常量源逐字一致`);
    assert.ok(text.symbol.length > 0, `${code} 主导意象非空`);
    assert.ok(text.summary.length > 0, `${code} ① 概述非空`);
    assert.equal(text.traits.length, 3, `${code} ② 特质描述应为 3 条`);
    assert.ok(text.relationHint.length > 0, `${code} ③ 相处模式提示非空`);
    assert.ok(text.disclaimer.length > 0, `${code} ④ 免责提示非空`);
  }
  assert.equal(new Set(Object.values(strings.archetypes).map((a) => a.disclaimer)).size, 1, '16 条免责句统一');
});

// ─────────────────────────────────────────────────────────────
// 排除项与合规
// ─────────────────────────────────────────────────────────────

test('5 档标题括注的「展示值」百分比未混入产物', () => {
  const raw = fs.readFileSync(path.join(__dirname, '..', 'miniapp', 'shared', 'strings.js'), 'utf8');
  for (const banned of ['约 92%', '约 83%', '约 67%', '展示值', '系统计算']) {
    assert.ok(!raw.includes(banned), `产物不应包含资产标题行括注「${banned}」`);
  }
});

test('产物不含全部 8 个禁用词（免责以外的全部文案）', () => {
  const banned = ['命中注定', '一定会', '宿命', '吉凶', '预言', '转运', '算命', '预测未来'];
  const narrative = JSON.stringify({
    quiz: strings.quiz,
    archetypes: strings.archetypes,
    bands: strings.bands.map((b) => ({ summary: b.summary, hints: b.hints })),
    pairStates: strings.pairStates,
  });
  for (const word of banned) assert.ok(!narrative.includes(word), `叙事文案命中禁用词「${word}」`);
});

test('叙事文案不含测评类与绝对化表述；免责文案中的否定式用法按 PRD 4.4 原文保留', () => {
  // 免责文案为法务复核稿，其中「心理学专业测评」「心理诊断」出现在否定句里（「不构成…」），
  // 属 PRD 4.4 的既定措辞，不由本测试改写；此处只扫叙事部分。
  const narrative = JSON.stringify({
    quiz: strings.quiz,
    archetypes: strings.archetypes,
    bands: strings.bands.map((b) => ({ summary: b.summary, hints: b.hints })),
    pairStates: strings.pairStates,
  });
  // 「量表」不能裸扫：中文无词边界，「不靠音量表达」里会跨词命中「量表」。故用固定搭配形式。
  const phrases = ['心理测评', '心理学专业测评', '准确率', '心理诊断', '专业量表', '心理量表', '测评量表'];
  const absolute = ['最般配', '天生一对', '必然', '永远'];
  for (const word of phrases.concat(absolute)) {
    assert.ok(!narrative.includes(word), `叙事文案命中受限表述「${word}」`);
  }

  // 免责文案命中否定式用法时，必须同时出现否定词，避免把「不构成诊断」误判为断言
  for (const [key, text] of Object.entries(strings.disclaimers)) {
    if (!/诊断|测评/.test(text)) continue;
    assert.match(text, /不构成|不作为|非/, `${key} 免责文案提及测评/诊断时必须为否定式`);
  }
});

test('题目与选项不含天体/星象意象（意象只出现在原型解读）', () => {
  const celestial = ['星', '月', '曜', '彗', '极光', '潮汐', '海洋', '穹顶'];
  for (const q of strings.quiz.questions) {
    const text = [q.stem, ...q.options.map((o) => o.text)].join('');
    for (const word of celestial) {
      assert.ok(!text.includes(word), `${q.id} 题面不应出现意象词「${word}」`);
    }
  }
});

// ─────────────────────────────────────────────────────────────
// display.js 查表与格式化
// ─────────────────────────────────────────────────────────────

test('display：原型查表合并索引与解读文案，非法码返回 null', () => {
  const found = display.archetype('ABAB');
  assert.equal(found.code, 'ABAB');
  assert.equal(found.id, 'archetype-abab');
  assert.equal(found.name, '双星型');
  assert.equal(found.symbolId, 'star-binary');
  assert.equal(found.symbol, '相互环绕的双星');
  assert.equal(found.traits.length, 3);

  assert.equal(display.archetype('ABAX'), null);
  assert.equal(display.archetype('abab'), null, '原型码大小写敏感，不做模糊匹配');
  assert.equal(display.archetypeName('ABAX'), '');

  const copy = display.archetype('ABAB');
  copy.traits.push('x');
  assert.equal(display.archetype('ABAB').traits.length, 3, '返回的数组应为副本，不污染生成产物');
});

test('display：题目与题号序列', () => {
  const ids = display.questionIds();
  assert.deepEqual(ids, constants.DIM_ORDER.flatMap((d) => constants.DIM_QUESTIONS[d]).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))));
  assert.equal(display.question('Q3').dim, 'D3');
  assert.equal(display.question('Q99'), null);
  assert.equal(display.questions().length, 10);
});

test('display：免责与配对状态提示查表', () => {
  assert.equal(display.disclaimer('home'), strings.disclaimers.home);
  assert.equal(display.disclaimer('nope'), '');
  assert.deepEqual(Object.keys(display.disclaimers()).sort(), ['guide', 'home', 'pair', 'quiz', 'result', 'share']);
  assert.equal(display.pairState('waiting'), strings.pairStates.waiting);
  assert.equal(display.pairState('nope'), '');
  assert.equal(display.band(4).label, '同频共振型');
  assert.equal(display.band(9), null);
  assert.equal(display.bandByLabel('高默契型').c, 3);
  assert.equal(display.bandByLabel('不存在型'), null);
});

test('display：同频度百分比格式化 —— 整数不带小数位，一位小数保留', () => {
  assert.equal(display.formatPercent(100), '100%');
  assert.equal(display.formatPercent(91.7), '91.7%');
  assert.equal(display.formatPercent(83.3), '83.3%');
  assert.equal(display.formatPercent(75), '75%');
  assert.equal(display.formatPercent(66.7), '66.7%');
  assert.equal(display.formatPercent(91.666666), '91.7%', '服务端未取整也应稳定呈现');
  assert.equal(display.formatPercent('83.3'), '83.3%');
  assert.equal(display.formatPercent(null), '');
  assert.equal(display.formatPercent(undefined), '');
  assert.equal(display.formatPercent(NaN), '');
});

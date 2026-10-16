#!/usr/bin/env node
'use strict';

/**
 * 构建期文案生成器
 *
 * 从 4 份【内容叙事】资产里**机械提取**叙事文案，并合入生成器内集中声明的界面静态文案，
 * 生成前端唯一可消费的文案产物：
 *   - miniapp/shared/strings.js
 *
 * 为什么不做人工誊抄：文案资产是唯一权威，手抄必然漂移。生成器把「资产 → 代码」
 * 变成可复现的确定性变换，并在提取时做逐条断言（标签与常量源对齐、段数完整等），
 * 任一断言失败即中止，不生成半成品。
 *
 * 文案来源与目标字段（本计划 §4.3）：
 *   PRD §4.4 免责文案表        → disclaimers.{home,guide,quiz,result,pair,share}
 *   题库 §1.1 引导语            → quiz.intro
 *   题库 §1.1 每题问法          → quiz.questionPrompt
 *   题库 §二 10 道题目          → quiz.questions[]
 *   原型解读 §二 16 条          → archetypes[code]
 *   5 档解读 §二 5 档叙事       → bands[]（下标 = C 值）
 *   5 档解读 §三 状态提示表     → pairStates
 *
 * **明确不提取**：5 档标题行中的「展示值约 83%」类括注（百分比由系统按公式计算，
 * 文案不得写死）；`###` 标题行本身只用于取档位与标签。
 *
 * 用法：
 *   node tools/gen-strings.js            生成（写盘）
 *   node tools/gen-strings.js --check    只校验，不写盘；不一致则 exit 1
 */

const fs = require('fs');
const path = require('path');

const constants = require('../shared/constants.js');

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'doc');
const OUT = path.join(ROOT, 'miniapp', 'shared', 'strings.js');
const CHECK_ONLY = process.argv.includes('--check');

const FILES = {
  prd: path.join(DOCS, 'PRD-抖音趣味测试小游戏-星语人格.md'),
  quiz: path.join(DOCS, '文案资产-10题题库与计分表.md'),
  archetypes: path.join(DOCS, '文案资产-16人格原型解读.md'),
  bands: path.join(DOCS, '文案资产-5档相处模式解读.md'),
};

/**
 * 界面静态文案（UI chrome）——按钮文字、区块标题、状态提示等。
 *
 * 为什么声明在生成器里：项目合规硬约束是「全部对外文案集中于单一文案源、页面内无硬编码文案」
 * （《技术资产》§12 验收清单）。叙事文案已由 4 份资产机械提取；界面静态文案尚无独立资产可依，
 * 故在此集中声明，随生成一并写入 `strings.ui`，页面一律经 `core/display.js` 的 `ui()` 读取，
 * **不在 TTML 里写死任何字样**。本表同样纳入生成期的禁用词自检。
 *
 * 与资产重叠的两项不在此重复声明，直接取自资产（避免同一句话两处维护）：
 *   - `ui.home.tagline`          ← PRD §1.1 一句话介绍
 *   - `ui.share.channels[].label` ← PRD §7.2 分享渠道（已确认 4 项）
 * 生成时断言其存在与条数，资产改动会被 `npm run gen:check` 立即暴露。
 */
const SHARE_CHANNEL_KEYS = ['friend', 'group', 'save_image', 'copy_code'];

const UI_TEXT = {
  home: {
    brand: '星语人格',
    brandSub: '好友同频测试',
    spec: '10 道题 · 约 3 分钟 · 无需注册',
    ctaStart: '开始测试',
    ctaPair: '已有邀请码 · 直接配对',
    ctaResume: '继续上次答题',
  },
  guide: {
    title: '开始之前',
    subtitle: '三步看懂这次测试',
    steps: [
      { no: '1', title: '回答 10 道题', desc: '凭第一感受二选一，没有对错，也不用纠结。' },
      { no: '2', title: '生成人格映像卡', desc: '得到你的原型符号与特质解读。' },
      { no: '3', title: '邀请好友配对', desc: '生成一张同频图谱，看你们的相处模式。' },
    ],
    note: '预计用时：约 3 分钟',
    noteResume: '上次进度已保留',
    cta: '开始答题',
  },
  quiz: {
    progress: '第 {n} / {total} 题',
    back: '上一题',
    hint: '作答即进入下一题 · 可返回上一题修改',
    hintLast: '生成结果',
  },
  result: {
    ctaInvite: '邀请好友配对',
    ctaShare: '分享',
    loadingTitle: '正在生成你的人格映像',
    loadingSub: '星点正在聚合，请稍候',
    loadingCta: '生成中…',
    failTitle: '未能生成结果',
    failText: '网络似乎不太稳定，你的人格映像没有生成成功。可以重新试一次。',
    failCta: '重新生成',
    pairCodeLabel: '配对码',
    // 结果卡内的两个字段标签，取自《文案资产-16人格原型解读》对应字段名（**主导意象** / **相处模式提示**）
    imageryLabel: '主导意象',
    relationLabel: '相处模式提示',
  },
  pair: {
    title: '同频图谱',
    roleSelf: '你的卡',
    roleInviter: '发起者',
    roleInvitee: '受邀者',
    pendingName: '待完成',
    waitText: '等待对方完成测试…',
    waitCta: '再次邀请',
    expiredTitle: '本次邀请已过期',
    expiredSub: '邀请有效期 7 天',
    expiredCta: '重新发起配对',
    markSame: '一致',
    markComp: '互补',
    bandPrefix: '相处模式：',
    shareCta: '分享图谱',
    switchCta: '换个好友配对',
    // 手工输入配对码：首页「已有邀请码 · 直接配对」的落地态。设计稿未覆盖此态（见交付说明），
    // 为闭合该入口补的最小输入面，示例拒绝原因对齐 core/route.js checkPairCode 的判定口径。
    inputHint: '输入好友的 8 位配对码',
    inputPlaceholder: '8 位字母与数字',
    inputCta: '确认配对',
    inputInvalid: '配对码格式不正确，请核对后再试',
    inputAmbiguous: '配对码不含 I / L / O / 0 / 1 这几个易混字符',
    // 服务端 ERROR_CODES.PAIR_CODE_NOT_FOUND(2001) 的落地提示（常量表只定义码→语义，不定义逐条提示语）
    inputNotFound: '没有找到这个邀请，请核对配对码',
    // 完成态 4 条维度对照带的展示文案（《美术资产》§6.5 版式：维度短名 + A/B 两端名）。
    // 维度短名取美术稿（「D1 表达」），A/B 端名取 PRD §3.2 维度表；逐维明细由服务端 completedView.dimensions 下发。
    dims: {
      D1: { title: 'D1 表达', a: '外显', b: '内隐' },
      D2: { title: 'D2 能量', a: '炽放', b: '静蓄' },
      D3: { title: 'D3 决策', a: '理性', b: '感性' },
      D4: { title: 'D4 关系', a: '主动', b: '随和' },
    },
  },
  share: {
    title: '分享给好友',
    subtitle: '邀请 TA 完成测试，一起看同频图谱',
    ctaInvite: '去邀请配对',
    ctaRetry: '再测一次',
  },
};

const problems = [];
const fail = (msg) => problems.push(msg);

/** 非阻塞提示：资产间存在不影响生成的分歧，须打印出来，避免静默改写文案。 */
const notices = [];
const notice = (msg) => notices.push(msg);

function readLines(label, file) {
  if (!fs.existsSync(file)) {
    fail(`缺少文案资产：${file}`);
    return [];
  }
  return fs.readFileSync(file, 'utf8').split('\n');
}

/** 按标题正则切块：每个块 = 标题捕获组 + 标题之后的原始行。 */
function splitBlocks(lines, headingPattern) {
  const blocks = [];
  let current = null;
  for (const line of lines) {
    const m = line.match(headingPattern);
    if (m) {
      if (current) blocks.push(current);
      current = { match: m, lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) blocks.push(current);
  return blocks;
}

function firstMatch(lines, pattern) {
  for (const line of lines) {
    const m = line.match(pattern);
    if (m) return m;
  }
  return null;
}

// ─────────────────────────────────────────────
// 0. 界面静态文案：手工声明 + 两处取自 PRD 的资产重叠项
// ─────────────────────────────────────────────

function buildUi(prdLines) {
  const tagline = firstMatch(prdLines, /^\s*- 一句话介绍：(.*)$/);
  if (!tagline) fail('PRD §1.1 缺少「一句话介绍」');

  const channelLine = firstMatch(prdLines, /^\s*- \*\*分享渠道（已确认 (\d+) 项）\*\*：(.+)$/);
  if (!channelLine) fail('PRD §7.2 缺少「分享渠道（已确认 N 项）」行');

  // 渠道行格式：`…**：抖音好友、抖音群、保存图片、复制配对码；渠道实际可用性以…为准`
  const labels = channelLine
    ? channelLine[2]
        .split('；')[0]
        .split('、')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const declared = channelLine ? Number(channelLine[1]) : 0;
  if (declared !== labels.length) {
    fail(`PRD §7.2 声明分享渠道 ${declared} 项，实际解析出 ${labels.length} 项`);
  }
  if (labels.length !== SHARE_CHANNEL_KEYS.length) {
    fail(`分享渠道键位数 ${SHARE_CHANNEL_KEYS.length} 与 PRD §7.2 渠道数 ${labels.length} 不一致`);
  }

  const channels = SHARE_CHANNEL_KEYS.map((key, i) => ({ key, label: labels[i] || '' }));

  return Object.assign({}, UI_TEXT, {
    home: Object.assign({}, UI_TEXT.home, { tagline: tagline ? tagline[1].trim() : '' }),
    share: Object.assign({}, UI_TEXT.share, { channels }),
  });
}

// ─────────────────────────────────────────────
// 1. PRD §4.4 免责文案
// ─────────────────────────────────────────────

const DISCLAIMER_SPECS = [
  ['home', '首页'],
  ['guide', '测试引导页'],
  ['quiz', '答题页'],
  ['result', '结果页'],
  ['pair', '配对页'],
  ['share', '分享弹窗'],
];

function extractDisclaimers(lines) {
  const out = {};
  for (const [key, label] of DISCLAIMER_SPECS) {
    // 只认 2 列表格行（| 位置 | 文案 |），避免误命中 6 章等 5 列页面表
    const row = lines.find((line) => {
      const parts = line.split('|');
      return parts.length === 4 && parts[2].trim() && parts[1].trim().startsWith(label);
    });
    if (!row) {
      fail(`PRD §4.4 免责文案表缺少「${label}」行`);
      continue;
    }
    out[key] = row.split('|')[2].trim();
  }
  return out;
}

// ─────────────────────────────────────────────
// 2. 题库：引导语、问法、10 道题目
// ─────────────────────────────────────────────

function extractQuiz(lines) {
  const intro = firstMatch(lines, /答题页统一引导语：`([^`]+)`/);
  const prompt = firstMatch(lines, /每题问法统一为：`([^`]+)`/);
  if (!intro) fail('题库缺少答题页统一引导语');
  if (!prompt) fail('题库缺少每题问法');

  const blocks = splitBlocks(lines, /^### (Q\d+)｜(.+?)（(D\d)）\s*$/);
  const questions = blocks.map(({ match, lines: body }) => {
    const id = match[1];
    const dim = match[3];
    const stem = firstMatch(body, /^\*\*题干\*\*：(.*)$/);
    const options = [];
    for (const optionId of ['A', 'B']) {
      const m = firstMatch(body, new RegExp(`^- \\*\\*${optionId}（([^）]+)）\\*\\*：(.*)$`));
      if (!m) fail(`${id} 缺少选项 ${optionId}`);
      else options.push({ id: optionId, endpoint: m[1].trim(), text: m[2].trim() });
    }
    if (!stem) fail(`${id} 缺少题干`);
    return { id, dim, stem: stem ? stem[1].trim() : '', options };
  });

  if (questions.length !== constants.REQUIRED_ANSWER_COUNT) {
    fail(`题库题数应为 ${constants.REQUIRED_ANSWER_COUNT}，实际 ${questions.length}`);
  }

  // 题号 ↔ 维度归属必须与常量源逐条一致（防止题库与 DIM_QUESTIONS 漂移）
  const dist = {};
  for (const dim of constants.DIM_ORDER) {
    dist[dim] = 0;
  }
  for (const q of questions) {
    if (!dist.hasOwnProperty(q.dim)) {
      fail(`题号 ${q.id} 的维度 ${q.dim} 非法`);
      continue;
    }
    dist[q.dim]++;
    const expected = constants.DIM_QUESTIONS[q.dim];
    if (!expected || !expected.includes(q.id)) {
      fail(`题号 ${q.id} 不属于 DIM_QUESTIONS.${q.dim}（常量源与题库不一致）`);
    }
  }
  const distText = constants.DIM_ORDER.map((d) => dist[d]).join('/');
  if (distText !== '3/3/2/2') fail(`题库维度分布应为 3/3/2/2，实际 ${distText}`);

  const expectedIds = constants.DIM_ORDER.flatMap((d) => constants.DIM_QUESTIONS[d]);
  const actualIds = questions.map((q) => q.id);
  const byNumber = (a, b) => Number(a.slice(1)) - Number(b.slice(1));
  if ([...expectedIds].sort(byNumber).join(',') !== [...actualIds].sort(byNumber).join(',')) {
    fail(
      `题库题号集合与常量源不一致：常量源 ${[...expectedIds].sort(byNumber).join(',')} / ` +
        `题库 ${[...actualIds].sort(byNumber).join(',')}`
    );
  }

  return {
    intro: intro ? intro[1] : '',
    questionPrompt: prompt ? prompt[1] : '',
    questions,
  };
}

// ─────────────────────────────────────────────
// 3. 原型解读 16 条
// ─────────────────────────────────────────────

function extractArchetypes(lines) {
  const blocks = splitBlocks(lines, /^### \d+ (.+?)（([AB]{4})）\s*$/);
  const parsed = {};

  for (const { match, lines: body } of blocks) {
    const name = match[1].trim();
    const code = match[2];
    const summary = firstMatch(body, /^- \*\*原型概述\*\*：(.*)$/);
    const symbol = firstMatch(body, /^\*\*主导意象\*\*：(.*)$/);
    const relationHint = firstMatch(body, /^- \*\*相处模式提示\*\*：(.*)$/);
    const disclaimer = firstMatch(body, /^- \*\*免责提示\*\*：(.*)$/);
    const traits = [];
    for (const line of body) {
      const m = line.match(/^\s+\d+\.\s+(.+)$/);
      if (m) traits.push(m[1].trim());
    }

    if (!summary) fail(`${code} 缺少原型概述`);
    if (!symbol) fail(`${code} 缺少主导意象`);
    if (!relationHint) fail(`${code} 缺少相处模式提示`);
    if (!disclaimer) fail(`${code} 缺少免责提示`);
    if (traits.length !== 3) fail(`${code} 特质描述应为 3 条，实际 ${traits.length}`);

    const known = constants.ARCHETYPES[code];
    if (!known) {
      fail(`原型码 ${code} 不在常量源 ARCHETYPES 内`);
    } else if (known.name !== name) {
      fail(`原型 ${code} 名称与常量源不一致：资产「${name}」/ 常量源「${known.name}」`);
    }

    parsed[code] = {
      code,
      name,
      symbol: symbol ? symbol[1].trim() : '',
      summary: summary ? summary[1].trim() : '',
      traits,
      relationHint: relationHint ? relationHint[1].trim() : '',
      disclaimer: disclaimer ? disclaimer[1].trim() : '',
    };
  }

  const expectedOrder = Object.keys(constants.ARCHETYPES);
  const actualOrder = Object.keys(parsed);
  if (actualOrder.join(',') !== expectedOrder.join(',')) {
    fail(`原型清单顺序与常量源不一致：资产 ${actualOrder.length} 条 / 常量源 ${expectedOrder.length} 条`);
  }
  for (const code of expectedOrder) {
    if (!parsed[code]) fail(`原型解读资产缺少 ${code}`);
  }

  return parsed;
}

// ─────────────────────────────────────────────
// 4. 5 档相处模式解读 + 状态提示
// ─────────────────────────────────────────────

function extractBands(lines) {
  const blocks = splitBlocks(lines, /^### C = (\d) · (.+)$/);
  const byC = {};

  for (const { match, lines: body } of blocks) {
    const c = Number(match[1]);
    // 标题行只取「·」后的标签，丢弃「（展示值约 83%，系统计算）」括注
    const label = match[2].split('（')[0].trim();

    const expectedLabel = constants.BAND_BY_C[c];
    if (expectedLabel !== label) {
      fail(`C=${c} 标签与常量源不一致：资产「${label}」/ 常量源「${expectedLabel}」`);
    }

    const summary = firstMatchAfter(body, /^\*\*① 概述\*\*/);
    const disclaimer = firstMatchAfter(body, /^\*\*③ 免责提示\*\*/);
    const hints = [];
    let inHints = false;
    for (const line of body) {
      if (/^\*\*② 相处提示\*\*/.test(line)) {
        inHints = true;
        continue;
      }
      if (/^\*\*/.test(line)) inHints = false;
      if (inHints) {
        const m = line.match(/^- (.+)$/);
        if (m) hints.push(m[1].trim());
      }
    }

    if (!summary) fail(`C=${c} 缺少① 概述`);
    if (!disclaimer) fail(`C=${c} 缺少③ 免责提示`);
    if (hints.length !== 3) fail(`C=${c} ② 相处提示应为 3 条，实际 ${hints.length}`);

    byC[c] = {
      c,
      label,
      summary: summary || '',
      hints,
      disclaimer: disclaimer || '',
    };
  }

  if (Object.keys(byC).length !== constants.BAND_BY_C.length) {
    fail(`档位数应为 ${constants.BAND_BY_C.length}，实际 ${Object.keys(byC).length}`);
  }

  // 按 C 升序排成数组，下标即 C 值，与 constants.BAND_BY_C 索引语义一致
  return constants.BAND_BY_C.map((label, c) => {
    if (!byC[c]) {
      fail(`缺少 C=${c}（${label}）的解读文案`);
      return { c, label, summary: '', hints: [], disclaimer: '' };
    }
    return byC[c];
  });
}

/** 取某标记行之后的第一个非空行内容。 */
function firstMatchAfter(lines, marker) {
  let hit = false;
  for (const line of lines) {
    if (!hit) {
      if (marker.test(line)) hit = true;
      continue;
    }
    const text = line.trim();
    if (text && !/^-{3,}$/.test(text)) return text;
  }
  return null;
}

const PAIR_STATE_SPECS = [
  ['waiting', '等待对方完成'],
  ['expired', '邀请已过期'],
  ['completed', '配对已完成'],
];

function extractPairStates(lines) {
  const out = {};
  for (const [key, label] of PAIR_STATE_SPECS) {
    const row = lines.find((line) => {
      const parts = line.split('|');
      return parts.length === 4 && parts[1].trim() === label && parts[2].trim();
    });
    if (!row) fail(`5 档资产 §三 状态提示表缺少「${label}」行`);
    else out[key] = row.split('|')[2].trim();
  }
  return out;
}

// ─────────────────────────────────────────────
// 5. 交叉一致性断言（文案之间不得互相矛盾）
// ─────────────────────────────────────────────

function assertCrossConsistency(disclaimers, quiz, archetypes, bands, ui) {
  if (disclaimers.quiz && quiz.intro && disclaimers.quiz !== quiz.intro) {
    fail('免责文案「答题页」与题库引导语不一致（PRD 4.4 要求逐字一致）');
  }
  for (const band of bands) {
    if (disclaimers.pair && band.disclaimer !== disclaimers.pair) {
      fail(`C=${band.c} 的免责提示与 PRD 4.4 配对页措辞不一致（五档必须同一句）`);
    }
  }
  const archetypeDisclaimers = new Set(Object.values(archetypes).map((a) => a.disclaimer));
  if (archetypeDisclaimers.size > 1) fail('16 条原型解读的免责提示句不统一');

  // 全量禁用词扫描留给 tools/check-strings.js（构建门禁），此处只做生成期快速自检
  const banned = ['命中注定', '一定会', '宿命', '吉凶', '预言', '转运', '算命', '预测未来'];
  const haystack = JSON.stringify({ disclaimers, quiz, archetypes, bands, ui });
  for (const word of banned) {
    if (haystack.includes(word)) fail(`生成产物命中禁用词「${word}」`);
  }
}

// ─────────────────────────────────────────────
// 6. 产物渲染
// ─────────────────────────────────────────────

const GEN_HEADER = [
  "'use strict';",
  '',
  '// ─────────────────────────────────────────────────────────────',
  '// 本文件由 tools/gen-strings.js 生成：叙事文案提取自 4 份【内容叙事】资产，',
  '// 界面静态文案合入生成器内集中声明的 UI_TEXT（见该文件顶部说明）。',
  '// 禁止手改：改动会在下一次生成时被覆盖，且 gen-strings.js --check 会失败。',
  '// 叙事文案改资产原文；界面文案改 tools/gen-strings.js 的 UI_TEXT，然后重新运行生成。',
  '// ─────────────────────────────────────────────────────────────',
  '',
].join('\n');

function render(value, indent) {
  const pad = '  '.repeat(indent + 1);
  const closePad = '  '.repeat(indent);

  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return 'Object.freeze([])';
    const body = value.map((item) => `${pad}${render(item, indent + 1)}`).join(',\n');
    return `Object.freeze([\n${body}\n${closePad}])`;
  }

  const keys = Object.keys(value || {});
  if (keys.length === 0) return 'Object.freeze({})';
  const body = keys.map((key) => `${pad}${JSON.stringify(key)}: ${render(value[key], indent + 1)}`).join(',\n');
  return `Object.freeze({\n${body}\n${closePad}})`;
}

function renderStrings(data) {
  return `${GEN_HEADER}module.exports = ${render(data, 0)};\n`;
}

// ─────────────────────────────────────────────
// 7. 主流程
// ─────────────────────────────────────────────

function main() {
  const prdLines = readLines('PRD', FILES.prd);
  const quizLines = readLines('题库', FILES.quiz);
  const archetypeLines = readLines('原型解读', FILES.archetypes);
  const bandLines = readLines('5 档解读', FILES.bands);

  const disclaimers = extractDisclaimers(prdLines);
  const quiz = extractQuiz(quizLines);
  const archetypes = extractArchetypes(archetypeLines);
  const bands = extractBands(bandLines);
  const pairStates = extractPairStates(bandLines);
  const ui = buildUi(prdLines);

  // 提取例外：答题页文案以 PRD §4.4 为唯一权威（PRD 第 4.4 节「免责文案统一模板」，
  // 该行即答题页底部弱提示 = 答题页引导语，本是同一处页面文字）。
  // 题库 §1.1 自述「与 PRD 4.4 免责文案一致」，但实际少一个「请」字，属资产间不一致。
  // 本产物取 PRD 版本，并把差异打印为提示，不复述为「一致」。
  if (quiz.intro && disclaimers.quiz && quiz.intro !== disclaimers.quiz) {
    notice(
      `题库 §1.1 引导语「${quiz.intro}」与 PRD §4.4 答题页「${disclaimers.quiz}」不一致，` +
        '本产物以 PRD §4.4 为准（题库该句少了首字）。'
    );
  }
  if (disclaimers.quiz) quiz.intro = disclaimers.quiz;

  assertCrossConsistency(disclaimers, quiz, archetypes, bands, ui);

  if (problems.length > 0) {
    console.error('[gen-strings] 提取校验未通过：');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  for (const n of notices) console.warn(`[gen-strings] 提示：${n}`);

  const content = renderStrings({ ui, disclaimers, quiz, archetypes, bands, pairStates });

  if (CHECK_ONLY) {
    if (!fs.existsSync(OUT)) {
      console.error('[gen-strings] --check 失败：产物缺失 miniapp/shared/strings.js，请先运行 node tools/gen-strings.js');
      process.exit(1);
    }
    if (fs.readFileSync(OUT, 'utf8') !== content) {
      console.error('[gen-strings] --check 失败：miniapp/shared/strings.js 与文案资产不一致（发生漂移）');
      console.error('  处置：重新运行 node tools/gen-strings.js 覆盖产物，并确认资产改动是预期的。');
      process.exit(1);
    }
    console.log('[gen-strings] 校验通过（未写盘）');
    return;
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const changed = !fs.existsSync(OUT) || fs.readFileSync(OUT, 'utf8') !== content;
  fs.writeFileSync(OUT, content, 'utf8');

  console.log(
    `[gen-strings] 生成完成：界面文案 ${Object.keys(ui).length} 组 / 免责 ${Object.keys(disclaimers).length} 处 / ` +
      `${quiz.questions.length} 题 / ${Object.keys(archetypes).length} 原型 / ${bands.length} 档 / ` +
      `${Object.keys(pairStates).length} 状态提示`
  );
  console.log(`  - miniapp/shared/strings.js ${changed ? '(更新)' : '(无变化)'}`);
}

main();

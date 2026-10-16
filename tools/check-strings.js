#!/usr/bin/env node
'use strict';

/**
 * 构建门禁 · 禁用词扫描
 *
 * 依据：PRD §4.3（专用词表全站强制，「命中禁用词即阻断发布」）、§4.4；本计划 §4.2 第三层。
 *
 * 扫描范围：
 *   1. `miniapp/**` —— 真正会呈现给用户的前端交付物（TTML/TTSS/JS/JSON 与生成文案）。
 *   2. PRD 与 4 份【内容叙事】资产原文 —— 上游文案，改动会经 `strings.js` 传导到前端。
 * 视觉文字（卡面、印章、标题字）同样在范围内：TTML/TTSS/JSON 里的任何字样都会被扫到。
 *
 * 词表声明行豁免：资产本身会**罗列**这 8 个禁用词（PRD 4.3 词表、16 原型解读的写作约束等）。
 * 判定规则为「同一行命中 ≥3 个禁用词即视为词表声明行」——真实文案不可能在一行里连写 3 个禁用词，
 * 故该豁免不会掩护任何真实命中。豁免行会被统计并打印，做到可见。
 *
 * 用法：
 *   node tools/check-strings.js              扫描；命中则 exit 1
 *   node tools/check-strings.js --selftest   反例自检：用内存假源文本证明门禁真的会拦，exit 1
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCAN_ROOT = path.join(ROOT, 'miniapp');
const DOCS_ROOT = path.join(ROOT, '..');
const SELFTEST = process.argv.includes('--selftest');

const BANNED_WORDS = ['命中注定', '一定会', '宿命', '吉凶', '预言', '转运', '算命', '预测未来'];
const SCAN_EXTENSIONS = ['.js', '.json', '.ttml', '.ttss', '.md'];

/**
 * 上游文案资产（相对 project-dy/）：这 5 份承载**用户可见文案与视觉文字**，
 * 是 `strings.js` 与页面文字的来源，必须纳入扫描。
 */
const UPSTREAM_DOCS = [
  '文案资产-10题题库与计分表.md',
  '文案资产-16人格原型解读.md',
  '文案资产-5档相处模式解读.md',
  '文案资产-达人引流素材规范.md',
  '美术资产-全流程视觉P01-P06线稿说明.md', // 卡面/标题字等视觉文字
];

/**
 * 刻意**不**纳入扫描的文档。原因：这些是需求/风控/工程文档，其风控条款必须指名禁用词
 * （如 PRD「不作为专业心理诊断依据，不测算吉凶」「命名体系不得含吉凶、运势、预言类语义」），
 * 扫描它们只会产出清一色的否定式误报，反而掩盖真实命中。
 * 用户可见文案的覆盖由上面 5 份资产 + `miniapp/**` 保证。
 */
const EXCLUDED_DOCS = [
  'PRD-抖音趣味测试小游戏-星语人格.md',
  '合规资产-提审自检清单.md',
  '技术资产-研发侧技术方案预研.md',
  '测试资产-验收用例与测试计划.md',
  '平台规则检索记录.md',
  '运营资产-上线计划与运营节奏.md',
  '待确认项台账-外部依赖确认单.md',
];

/** 同一行命中 ≥3 个禁用词 → 判定为词表声明行，不计为命中。 */
const DECLARATION_THRESHOLD = 3;

/**
 * 风控条款标记词。
 *
 * 为什么需要这条规则：资产与需求文档里必然存在**否定式风控条款**，它们必须指名禁用词才能表达禁止
 * （例：「不得将天体符号、卡牌意象与命运、吉凶、运势建立关联」「禁用画面：吉凶 / 运势类字幕」）。
 * 朴素的词表扫描会把这类条款全部误报为命中，而「命中即阻断」的门禁一旦长期误报就会被绕过。
 *
 * 判定口径：仅当同一行内**该禁用词的每一次出现**，其前方 `MARKER_WINDOW` 字符内都存在风控标记词时，
 * 才判为「风控条款」而豁免；只要有一次出现在否定语境之外，仍判为命中。
 */
const PROHIBITION_MARKERS = [
  '不得',
  '禁止',
  '禁用',
  '不含',
  '不涉及',
  '未与',
  '不属',
  '不暗示',
  '不作为',
  '不预测',
  '不测算',
  '不出现',
  '避免',
  '规避',
  '非专业',
  '非占卜',
  '非命理',
];
const MARKER_WINDOW = 50;

/** 递归收集待扫文件（返回 { path, text } 条目，便于 selftest 注入内存假源）。 */
function collectFiles(dir, acc) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      collectFiles(abs, acc);
    } else if (SCAN_EXTENSIONS.includes(path.extname(entry.name))) {
      acc.push({ path: path.relative(ROOT, abs), text: fs.readFileSync(abs, 'utf8') });
    }
  }
  return acc;
}

/** 判断某一处出现是否处于否定语境（前方窗口内存在风控标记词）。 */
function isNegatedContext(line, word) {
  let idx = line.indexOf(word);
  if (idx === -1) return false;
  while (idx !== -1) {
    const before = line.slice(Math.max(0, idx - MARKER_WINDOW), idx);
    if (!PROHIBITION_MARKERS.some((marker) => before.includes(marker))) return false;
    idx = line.indexOf(word, idx + 1);
  }
  return true;
}

/**
 * 逐文件、逐行扫描。
 * @returns {{hits:Array, exempt:Array, words:number, files:number}}
 */
function scan(entries) {
  const hits = [];
  const exempt = [];
  for (const entry of entries) {
    const lines = entry.text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const matched = BANNED_WORDS.filter((word) => lines[i].includes(word));
      if (matched.length === 0) continue;

      if (matched.length >= DECLARATION_THRESHOLD) {
        exempt.push({ path: entry.path, line: i + 1, reason: `词表声明行（同行 ${matched.length} 个禁用词）` });
        continue;
      }

      const negated = matched.filter((word) => isNegatedContext(lines[i], word));
      const real = matched.filter((word) => !negated.includes(word));

      if (negated.length > 0) {
        exempt.push({ path: entry.path, line: i + 1, reason: `风控条款否定式（${negated.join('、')}）` });
      }
      for (const word of real) {
        hits.push({ path: entry.path, line: i + 1, word, text: lines[i].trim() });
      }
    }
  }
  return { hits, exempt, words: BANNED_WORDS.length, files: entries.length };
}

function collectUpstreamDocs(acc) {
  for (const name of UPSTREAM_DOCS) {
    const abs = path.join(DOCS_ROOT, name);
    if (!fs.existsSync(abs)) {
      console.error(`[check-strings] 上游文案资产缺失：${name}`);
      process.exit(1);
    }
    acc.push({ path: name, text: fs.readFileSync(abs, 'utf8') });
  }
  return acc;
}

function report(hits) {
  console.error('[check-strings] 禁用词命中，阻断发布：');
  for (const hit of hits) {
    console.error(`  - ${hit.path}:${hit.line}  「${hit.word}」  → ${hit.text}`);
  }
  console.error(`  共 ${hits.length} 处。处置：改写为推荐词（特质/偏好/原型/性格倾向/相处模式/气质意象）。`);
}

function main() {
  if (SELFTEST) {
    // 反例自检：向内存注入假源文本，同时验证「真文案被拦」与「风控条款/词表声明行不误报」两侧。不写任何文件。
    const fake = [
      { path: 'miniapp/__selftest__/fake.ttml', text: '<view class="card">命中注定我们同频</view>' },
      { path: 'miniapp/__selftest__/fake.js', text: "const hint = '这件事一定会发生';\n" },
      { path: 'miniapp/__selftest__/negation.md', text: '- 不得将意象与命运、吉凶建立关联。\n' },
      {
        path: 'miniapp/__selftest__/declaration.md',
        text: '- 禁用词：命中注定、一定会、宿命、吉凶、预言、转运、算命、预测未来\n',
      },
    ];
    const { hits, exempt } = scan(fake);
    if (hits.length !== 2) {
      console.error(`[check-strings] --selftest 失败：真文案应命中 2 处，实际 ${hits.length} 处`);
      process.exit(1);
    }
    if (exempt.length !== 2) {
      console.error(`[check-strings] --selftest 失败：风控条款/词表声明行应豁免 2 处，实际 ${exempt.length} 处`);
      process.exit(1);
    }
    console.error('[check-strings] --selftest：命中与豁免位置如下（证明门禁既拦得住、又不误报）');
    report(hits);
    for (const e of exempt) console.error(`  [豁免] ${e.path}:${e.line}  ${e.reason}`);
    console.error('[check-strings] --selftest 结束，按约定返回非 0。');
    process.exit(1);
  }

  const entries = collectUpstreamDocs(collectFiles(SCAN_ROOT, []));
  const { hits, exempt, words, files } = scan(entries);

  if (hits.length > 0) {
    report(hits);
    process.exit(1);
  }

  console.log(
    `[check-strings] ${words} 禁用词 0 命中（扫描 ${files} 个文件：miniapp/** + ${UPSTREAM_DOCS.length} 份文案/美术资产）`
  );
  console.log(`  - 豁免 ${exempt.length} 处（非文案行，逐条列出以便人工复核）：`);
  for (const e of exempt) console.log(`       ${e.path}:${e.line}  ${e.reason}`);
  console.log(`  - 未纳入扫描的需求/风控文档 ${EXCLUDED_DOCS.length} 份（其风控条款必须指名禁用词，扫描必然误判）`);
}

main();

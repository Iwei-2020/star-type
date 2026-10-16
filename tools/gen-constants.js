#!/usr/bin/env node
'use strict';

/**
 * 构建期常量生成器
 *
 * 从 `shared/constants.js`（唯一数据源）生成前端可消费的展示用产物：
 *   - miniapp/shared/archetype-index.js   code → { id, name, symbolId }
 *   - miniapp/shared/client-constants.js  前端所需的非计算常量
 *
 * 生成时校验两份内容与现盘一致（--check 模式），防止常量源与前端产物漂移。
 *
 * **明确不生成**：DIM_QUESTIONS / DIM_ORDER / W_SAME / W_COMP / FULL / BAND_BY_C /
 * REQUIRED_ANSWER_COUNT / scoreArchetype / similarity。前端拿不到这些，也就不可能重算。
 *
 * 用法：
 *   node tools/gen-constants.js            生成（写盘）
 *   node tools/gen-constants.js --check    只校验，不写盘；不一致则 exit 1
 */

const fs = require('fs');
const path = require('path');

const constants = require('../shared/constants.js');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'miniapp', 'shared');
const CHECK_ONLY = process.argv.includes('--check');

const GEN_HEADER = [
  "'use strict';",
  '',
  '// ─────────────────────────────────────────────────────────────',
  '// 本文件由 tools/gen-constants.js 从 shared/constants.js 自动生成。',
  '// 禁止手改：改动会在下一次生成时被覆盖，且 gen-constants.js --check 会失败。',
  '// 用途：前端展示用。**不含任何计分 / 同频度逻辑**（技术资产 §1.2 单一权威实现）。',
  '// ─────────────────────────────────────────────────────────────',
  '',
].join('\n');

// ─────────────────────────────────────────────
// 1. 常量源自检
// ─────────────────────────────────────────────

/** 生成前的断言：常量源本身必须自洽，否则不生成任何产物。 */
function assertSourceOfTruth() {
  const problems = [];

  // 原型：恰好 16 条，且为 A/B 的全部 4 位组合
  const codes = Object.keys(constants.ARCHETYPES);
  if (codes.length !== 16) problems.push(`原型条目数应为 16，实际 ${codes.length}`);
  const expected = [];
  for (const a of ['A', 'B']) {
    for (const b of ['A', 'B']) {
      for (const d of ['A', 'B']) {
        for (const e of ['A', 'B']) expected.push(a + b + d + e);
      }
    }
  }
  for (const code of expected) {
    if (!constants.ARCHETYPES[code]) problems.push(`缺少原型码 ${code}`);
  }
  for (const code of codes) {
    if (!expected.includes(code)) problems.push(`非法原型码 ${code}（应为 A/B 的 4 位组合）`);
    const a = constants.ARCHETYPES[code];
    if (!a.id || !a.name || !a.symbolId) problems.push(`原型 ${code} 字段不完整`);
  }

  // 题目：恰好 10 条，维度分布 3/3/2/2，题号全局唯一
  const allQuestions = [];
  const dist = {};
  for (const dim of constants.DIM_ORDER) {
    const qs = constants.DIM_QUESTIONS[dim];
    if (!qs) problems.push(`维度 ${dim} 未定义题号`);
    else {
      dist[dim] = qs.length;
      allQuestions.push(...qs);
    }
  }
  if (allQuestions.length !== constants.REQUIRED_ANSWER_COUNT) {
    problems.push(`题号总数应为 ${constants.REQUIRED_ANSWER_COUNT}，实际 ${allQuestions.length}`);
  }
  if (new Set(allQuestions).size !== allQuestions.length) problems.push('题号存在重复');
  const distText = constants.DIM_ORDER.map((d) => dist[d]).join('/');
  if (distText !== '3/3/2/2') problems.push(`维度题数分布应为 3/3/2/2，实际 ${distText}`);

  // 同频度：5 档标签
  if (constants.BAND_BY_C.length !== 5) {
    problems.push(`相处模式档位数应为 5，实际 ${constants.BAND_BY_C.length}`);
  }

  // 配对码字母表：无重复、不含易混字符
  const alphabet = constants.ALPHABET;
  if (new Set(alphabet).size !== alphabet.length) problems.push('ALPHABET 存在重复字符');
  for (const ch of ['I', 'L', 'O', '0', '1']) {
    if (alphabet.includes(ch)) problems.push(`ALPHABET 不应包含易混字符 ${ch}`);
  }

  // 埋点：12 事件、公共字段环闭
  if (constants.EVENTS.length !== 12) problems.push(`埋点事件应为 12 个，实际 ${constants.EVENTS.length}`);
  for (const f of constants.EVENT_COMMON_FIELDS) {
    if (!f) problems.push('公共字段存在空值');
  }

  if (problems.length > 0) {
    console.error('[gen-constants] 常量源自检未通过：');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  return { dist, distText };
}

// ─────────────────────────────────────────────
// 2. 产物渲染
// ─────────────────────────────────────────────

function renderArchetypeIndex() {
  const lines = Object.entries(constants.ARCHETYPES).map(([code, a]) => {
    return `  ${code}: Object.freeze({ id: ${JSON.stringify(a.id)}, name: ${JSON.stringify(
      a.name
    )}, symbolId: ${JSON.stringify(a.symbolId)} }),`;
  });
  return `${GEN_HEADER}module.exports = Object.freeze({\n${lines.join('\n')}\n});\n`;
}

/** 从字母表反推易混字符，使前端无需持有 ALPHABET 即可做输入校验。 */
function deriveAmbiguousChars() {
  const candidates = 'ILO01';
  return candidates.split('').filter((ch) => !constants.ALPHABET.includes(ch)).join('');
}

function renderClientConstants() {
  const ambiguous = deriveAmbiguousChars();
  const payload = {
    APP_VERSION: constants.APP_VERSION,
    QUIZ_VERSION: constants.QUIZ_VERSION,
    PAIR_CODE_LEN: constants.CODE_LEN,
    AMBIGUOUS_CHARS: ambiguous,
    STORE: constants.STORE,
    EVENTS: constants.EVENTS,
    EVENT_COMMON_FIELDS: constants.EVENT_COMMON_FIELDS,
    REPORT_POLICY: constants.REPORT_POLICY,
    PAGE_IDS: constants.PAGE_IDS,
    ENTRY_SOURCES: constants.ENTRY_SOURCES,
    ERROR_CODES: constants.ERROR_CODES,
    PAIR_STATUS: constants.PAIR_STATUS,
    CODE_REJECT_REASONS: constants.CODE_REJECT_REASONS,
    POLL_BACKOFF_MS: constants.POLL_BACKOFF_MS,
  };

  const body = Object.entries(payload)
    .map(([key, value]) => {
      const json = JSON.stringify(value, null, 2)
        .split('\n')
        .map((line, i) => (i === 0 ? line : '  ' + line))
        .join('\n');
      return `  ${key}: ${json},`;
    })
    .join('\n');

  return `${GEN_HEADER}module.exports = Object.freeze({\n${body}\n});\n`;
}

// ─────────────────────────────────────────────
// 3. 写盘 / 校验
// ─────────────────────────────────────────────

function emit(relPath, content) {
  const abs = path.join(OUT_DIR, relPath);
  if (CHECK_ONLY) {
    if (!fs.existsSync(abs)) {
      console.error(`[gen-constants] --check 失败：产物缺失 ${relPath}，请先运行 node tools/gen-constants.js`);
      process.exit(1);
    }
    const onDisk = fs.readFileSync(abs, 'utf8');
    if (onDisk !== content) {
      console.error(`[gen-constants] --check 失败：${relPath} 与常量源不一致（发生漂移）`);
      console.error('  处置：删除该文件后重新运行 node tools/gen-constants.js，并确认 shared/constants.js 的改动是预期的。');
      process.exit(1);
    }
    return { relPath, changed: false };
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const changed = !fs.existsSync(abs) || fs.readFileSync(abs, 'utf8') !== content;
  fs.writeFileSync(abs, content, 'utf8');
  return { relPath, changed };
}

function main() {
  const { dist, distText } = assertSourceOfTruth();

  const results = [
    emit('archetype-index.js', renderArchetypeIndex()),
    emit('client-constants.js', renderClientConstants()),
  ];

  const mode = CHECK_ONLY ? '校验通过（未写盘）' : '生成完成';
  console.log(
    `[gen-constants] ${mode}：16 原型 / ${constants.REQUIRED_ANSWER_COUNT} 题(${distText}) / ${constants.BAND_BY_C.length} 档`
  );
  if (!CHECK_ONLY) {
    for (const r of results) {
      console.log(`  - miniapp/shared/${r.relPath} ${r.changed ? '(更新)' : '(无变化)'}`);
    }
  }
}

main();

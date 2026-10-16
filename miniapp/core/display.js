'use strict';

/**
 * 展示层文案索引
 *
 * 依据：本计划 §4.5（`display.js`：从 `strings.js` / `archetype-index.js` 取文案与原型；
 * 同频度百分比格式化）。
 *
 * 边界：**只做查表与格式化**。原型码 → 原型名的映射来自构建期生成的 `archetype-index.js`，
 * 解读文案来自构建期生成的 `strings.js`；两者都由资产机械提取，前端不持有原始文案副本，
 * 更不含任何计分或同频度实现（技术资产 §1.2 单一权威实现）。
 */

const archetypeIndex = require('../shared/archetype-index.js');
const strings = require('../shared/strings.js');

/** 原型完整展示信息：索引（id/name/symbolId）+ 解读文案。非法码返回 null。 */
function archetype(code) {
  const known = archetypeIndex[code];
  const text = strings.archetypes[code];
  if (!known || !text) return null;
  return {
    code,
    id: known.id,
    name: known.name,
    symbolId: known.symbolId,
    symbol: text.symbol,
    summary: text.summary,
    traits: text.traits.slice(),
    relationHint: text.relationHint,
    disclaimer: text.disclaimer,
  };
}

function archetypeName(code) {
  const found = archetype(code);
  return found ? found.name : '';
}

/** 本次题库的全部题目（按题库顺序）。 */
function questions() {
  return strings.quiz.questions.slice();
}

function question(id) {
  return strings.quiz.questions.find((q) => q.id === id) || null;
}

/** 题号序列，供会话机推导进度与完成度（前端不持有题数常量）。 */
function questionIds() {
  return strings.quiz.questions.map((q) => q.id);
}

/** 取某一处免责文案。key ∈ home / guide / quiz / result / pair / share。 */
function disclaimer(key) {
  return strings.disclaimers[key] || '';
}

/** 全部免责文案（按页面 scope 索引）。 */
function disclaimers() {
  return Object.assign({}, strings.disclaimers);
}

/**
 * 界面静态文案查表（唯一样本在构建期生成的 `strings.ui`）。
 * key 为点号路径：`ui('home.ctaStart')`、`ui('guide.steps')`、`ui('share.channels')`。
 * 路径缺失返回 ''；数组 / 对象原样返回，供 `tt:for` 直接使用。
 */
function ui(keyPath) {
  let node = strings.ui;
  for (const part of String(keyPath).split('.')) {
    if (node === null || node === undefined) return '';
    node = node[part];
  }
  return node === undefined ? '' : node;
}

/** 把 `{name}` 占位替换为 vars 中的值（如答题进度「第 {n} / {total} 题」）。 */
function fill(template, vars) {
  return String(template).replace(/\{(\w+)\}/g, (whole, name) =>
    vars && Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole
  );
}

/** 相处模式档位，下标即 C 值（0–4）。 */
function band(c) {
  return strings.bands[c] || null;
}

/** 按标签反查档位（配对结果的 band_label 直接来自服务端，不在前端重算 C）。 */
function bandByLabel(label) {
  return strings.bands.find((b) => b.label === label) || null;
}

/** 配对状态提示：key ∈ waiting / expired / completed。 */
function pairState(key) {
  return strings.pairStates[key] || '';
}

/**
 * 同频度百分比格式化：整数不带小数位（`100%` / `75%`），一位小数保留（`91.7%`）。
 * 数值本身由服务端按公式计算，前端只负责呈现，**不参与计算**。
 */
function formatPercent(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' && value.trim() === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const rounded = Math.round(n * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text}%`;
}

/** 答题页统一题问（题库 §1.1，取自 PRD §4.4 同一句；P-03 每题上方固定问法）。 */
function questionPrompt() {
  return strings.quiz.questionPrompt;
}

module.exports = {
  archetype,
  archetypeName,
  questionPrompt,
  questions,
  question,
  questionIds,
  disclaimer,
  disclaimers,
  ui,
  fill,
  band,
  bandByLabel,
  pairState,
  formatPercent,
};

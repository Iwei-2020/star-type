#!/usr/bin/env node
'use strict';

/**
 * 渲染字符集导出（字体子集化的输入）
 *
 * 依据：技术资产 §4.1（字形子集化方案）；实施计划 §4.5 与验证步骤 #8。
 *
 * 取源（合并后去重、按码位升序）：
 *   1. miniapp/shared/strings.js          全部文案值（文案唯一来源）
 *   2. miniapp/shared/archetype-index.js  原型码 / id / 名称 / symbolId
 *   3. miniapp/**\/*.ttml                  静态文案（剥离注释、插值表达式与标签后剩下的文字）
 *   4. miniapp/app.json                   window.navigationBarTitleText
 *
 * 为什么把 ttml 与 app.json 也纳入：本文件的用途是给 `pyftsubset --text-file=` 做输入，
 * 漏一个字符就会在真机上缺字，因此判据是「**实际会被渲染的文字**」而不是「文档里写了多少字」。
 * 故取源比实施计划 §4.5 的表述宽一层（计划只列了 strings.js + archetype-index.js）；
 * 差异与原因见交付汇报。
 *
 * 输出：build/font-chars.txt —— 单行、去重、按码位升序，可直接作为
 *   `pyftsubset --text-file=build/font-chars.txt`
 * 的输入（不含换行，故不会把换行误纳入子集）。分类计数只打印到终端，不进文件。
 *
 * 用法：node tools/export-text.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MINIAPP = path.join(ROOT, 'miniapp');
const OUT_DIR = path.join(ROOT, 'build');
const OUT_FILE = path.join(OUT_DIR, 'font-chars.txt');
const APP_JSON = path.join(MINIAPP, 'app.json');

const strings = require('../miniapp/shared/strings.js');
const archetypeIndex = require('../miniapp/shared/archetype-index.js');

/** 分类规则：用于核对字符构成是否合理（如「汉字数突然翻倍」往往意味着漏了排除项）。 */
const CATEGORIES = [
  { key: 'han', label: '汉字', test: (cp) => cp >= 0x4e00 && cp <= 0x9fff },
  {
    key: 'cjkPunct',
    label: '中文标点与全角符号',
    test: (cp) => (cp >= 0x3000 && cp <= 0x303f) || (cp >= 0xff00 && cp <= 0xffef),
  },
  { key: 'asciiLetter', label: 'ASCII 字母', test: (cp) => (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a) },
  { key: 'asciiDigit', label: 'ASCII 数字', test: (cp) => cp >= 0x30 && cp <= 0x39 },
  { key: 'asciiPunct', label: 'ASCII 符号与空白', test: (cp) => cp >= 0x20 && cp <= 0x7e },
];

/** 递归收集所有字符串值（键名是标识符，不渲染，故不计入）。 */
function collectStrings(value, sink) {
  if (typeof value === 'string') {
    sink.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, sink);
    return;
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) collectStrings(value[key], sink);
  }
}

/**
 * 剥离 ttml 的非渲染内容，只留静态文案：
 * 注释去掉；`{{...}}` 插值去掉（其值来自 strings.js，已单独取源，不重复计）；
 * 标签（含其中的 tt:for / class 等属性）整体去掉。
 */
function stripTtml(text) {
  return text
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\{\{[^}]*\}\}/g, ' ')
    .replace(/<[^>]*>/g, ' ');
}

function collectTtml(dir, sink) {
  let files = 0;
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      files += collectTtml(abs, sink);
    } else if (entry.name.endsWith('.ttml')) {
      sink.push(stripTtml(fs.readFileSync(abs, 'utf8')));
      files++;
    }
  }
  return files;
}

function main() {
  const pieces = [];

  // 1. 文案唯一来源
  collectStrings(strings, pieces);

  // 2. 原型索引（原型码会被渲染在结果卡上，故键与值一并取）
  for (const code of Object.keys(archetypeIndex)) {
    const item = archetypeIndex[code];
    pieces.push(code, item.id, item.name, item.symbolId);
  }

  // 3. ttml 静态文案
  const ttmlFiles = collectTtml(MINIAPP, pieces);

  // 4. 导航栏标题
  if (fs.existsSync(APP_JSON)) {
    const appJson = JSON.parse(fs.readFileSync(APP_JSON, 'utf8'));
    if (appJson.window && appJson.window.navigationBarTitleText) {
      pieces.push(appJson.window.navigationBarTitleText);
    }
  }

  const all = pieces.join('');
  const chars = [...new Set(all)]
    .filter((ch) => {
      const cp = ch.codePointAt(0);
      return cp > 0x1f && cp !== 0x7f; // 排除控制字符（含换行与制表）
    })
    .sort((a, b) => a.codePointAt(0) - b.codePointAt(0));

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, chars.join(''), 'utf8');

  const counts = new Map(CATEGORIES.map((c) => [c.key, 0]));
  let other = 0;
  for (const ch of chars) {
    const cp = ch.codePointAt(0);
    const hit = CATEGORIES.find((c) => c.test(cp));
    if (hit) counts.set(hit.key, counts.get(hit.key) + 1);
    else other++;
  }

  console.log(`[export-text] 渲染字符集已导出：build/font-chars.txt`);
  console.log(`  - 总字符数（去重后）${chars.length}`);
  console.log(
    `  - 分类计数：${CATEGORIES.map((c) => `${c.label} ${counts.get(c.key)}`).join(' / ')} / 其他符号 ${other}`
  );
  console.log(
    `  - 取源：strings.js 全部文案 + archetype-index.js（${Object.keys(archetypeIndex).length} 原型） + ${ttmlFiles} 个 ttml 静态文案 + app.json 标题`
  );
  console.log(`  - 口径对照：技术资产 §4.1 口径上界 1143（含文档排版符号与站外素材）；本文件只含实际渲染字符`);
}

main();

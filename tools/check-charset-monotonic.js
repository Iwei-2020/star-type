#!/usr/bin/env node
'use strict';

/**
 * 字符集只增不减门禁
 *
 * 依据：技术资产 §4.1「字符集只增不减」CI 门禁；实施计划 §4.5 与验证步骤 #9。
 *
 * 语义：字体子集一旦定稿，任何**新增**字符都意味着真机缺字风险的边界被悄悄扩大，
 * 必须显式确认，故以 exit 1 阻断并列出；字符**减少**是安全的（子集只会更小），仅提示。
 *
 * 基线：build/charset.lock（JSON：{ count, chars }）。缺失时自动生成基线并正常退出。
 * 刷新基线：人工确认新增字符确为预期文案后，删除 build/charset.lock 并重跑本脚本。
 *   （刻意不提供 --update 之类的便捷开关：刷新基线是一次需要人判断的动作，不应一键完成。）
 *
 * 用法：node tools/check-charset-monotonic.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BUILD_DIR = path.join(ROOT, 'build');
const CURRENT_FILE = path.join(BUILD_DIR, 'font-chars.txt');
const BASELINE_FILE = path.join(BUILD_DIR, 'charset.lock');

function readCurrentChars() {
  if (!fs.existsSync(CURRENT_FILE)) {
    console.error('[check-charset-monotonic] 缺少 build/font-chars.txt，请先运行 node tools/export-text.js');
    process.exit(1);
  }
  return new Set(fs.readFileSync(CURRENT_FILE, 'utf8').split(''));
}

function writeBaseline(chars) {
  const sorted = [...chars].sort((a, b) => a.codePointAt(0) - b.codePointAt(0));
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(
    BASELINE_FILE,
    `${JSON.stringify({ count: sorted.length, chars: sorted.join('') }, null, 2)}\n`,
    'utf8'
  );
  return sorted;
}

function main() {
  const current = readCurrentChars();

  if (!fs.existsSync(BASELINE_FILE)) {
    const sorted = writeBaseline(current);
    console.log(`[check-charset-monotonic] 基线已生成：build/charset.lock（${sorted.length} 字符）`);
    console.log('  - 后续运行将以此为「只增不减」的比较基准。');
    return;
  }

  let baseline;
  try {
    baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
  } catch (err) {
    console.error(`[check-charset-monotonic] build/charset.lock 不是合法 JSON：${err.message}`);
    console.error('  处置：删除该文件后重跑本脚本以重建基线。');
    process.exit(1);
  }

  const baseChars = new Set(String(baseline.chars || '').split(''));
  const added = [...current].filter((ch) => !baseChars.has(ch)).sort((a, b) => a.codePointAt(0) - b.codePointAt(0));
  const removed = [...baseChars].filter((ch) => !current.has(ch)).sort((a, b) => a.codePointAt(0) - b.codePointAt(0));

  if (added.length > 0) {
    console.error('[check-charset-monotonic] 字符集出现新增字符，阻断构建：');
    for (const ch of added) {
      const cp = ch.codePointAt(0);
      console.error(`  - ${JSON.stringify(ch)}  U+${cp.toString(16).toUpperCase().padStart(4, '0')}`);
    }
    console.error(`  共新增 ${added.length} 个字符（基线 ${baseChars.size} → 当前 ${current.size}）。`);
    console.error('  处置：确认新增字符确为预期文案后，删除 build/charset.lock 并重跑本脚本刷新基线；');
    console.error('        若为文案误增（如混入排版符号），请修正取源而不要刷新基线。');
    process.exit(1);
  }

  console.log(`[check-charset-monotonic] 通过：无新增字符（基线 ${baseChars.size} → 当前 ${current.size}）`);
  if (removed.length > 0) {
    console.log(`  - 提示：较基线减少 ${removed.length} 个字符（子集变小属安全；无需处理）`);
    console.log(`    ${removed.map((ch) => JSON.stringify(ch)).join(' ')}`);
  }
}

main();

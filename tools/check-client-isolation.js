#!/usr/bin/env node
'use strict';

/**
 * 构建门禁 · 前端隔离校验（单一权威实现的机器可验证化）
 *
 * 依据：技术资产 §1.2「人格结果与同频度计算仅在服务端实现一次，前端不做独立实现」；本计划 §4.2 第三层。
 *
 * 三项检查（任一命中即 exit 1）：
 *   A. 黑名单标识符扫描 `miniapp/**`：命中计分/同频度常量或函数名 → 前端存在实现副本或越权常量
 *   B. 越界 require：把每个相对 require 路径按**文件所在目录**解析为绝对路径，
 *      若解析结果落在 `miniapp/` 之外（如 `star-type/shared/constants.js`、`star-type/server/**`）→ 阻断。
 *      说明：`../shared/` 本身不是判据 —— `miniapp/core/*` 合法引用 `miniapp/shared/*`，
 *      两者相对路径写法相同，只有解析后的落点能区分，故用路径解析而非字符串匹配。
 *   C. app.json 结构校验（文件存在时）：pages / subPackages 声明的页面必须真实存在；分包 pages 不得为空。
 *
 * 黑名单用词边界匹配（`\b`），故 `PAIR_CODE_LEN` 不会误命中 `CODE_LEN`、`similarity_pct` 不会误命中 `similarity` ——
 * 前者是生成产物里合法的前端常量，后者是服务端返回的数据字段名，均非「前端重算」。
 *
 * 用法：
 *   node tools/check-client-isolation.js             校验；命中则 exit 1
 *   node tools/check-client-isolation.js --selftest  反例自检：内存假源文本含 scoreArchetype，exit 1
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MINIAPP = path.join(ROOT, 'miniapp');
const APP_JSON = path.join(MINIAPP, 'app.json');
const SELFTEST = process.argv.includes('--selftest');

const BLACKLIST = [
  'scoreArchetype',
  'similarity',
  'W_SAME',
  'W_COMP',
  'FULL',
  'BAND_BY_C',
  'DIM_QUESTIONS',
  'DIM_ORDER',
  'REQUIRED_ANSWER_COUNT',
  'ALPHABET',
  'CODE_LEN',
];
/** 同分取 A 端的实现痕迹（技术资产 §3.1 的 `a >= b`）。 */
const BLACKLIST_PATTERNS = [{ pattern: /a\s*>=\s*b/, label: 'a >= b（同分取 A 端的实现痕迹）' }];

const SCAN_EXTENSIONS = ['.js', '.json', '.ttml', '.ttss'];

function collectFiles(dir, acc) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      collectFiles(abs, acc);
    } else if (SCAN_EXTENSIONS.includes(path.extname(entry.name))) {
      acc.push({ path: path.relative(ROOT, abs), abs, text: fs.readFileSync(abs, 'utf8') });
    }
  }
  return acc;
}

/**
 * 去除注释内容后再扫描黑名单。
 *
 * 目的：注释里需要能写「本模块不得引用 XXX 常量」这类说明，而黑名单要拦的是**可执行的实现副本**。
 * 行号与列号通过等长替换为空格来保持，报错定位不受影响。
 */
function stripComments(text) {
  let out = '';
  let i = 0;
  let mode = 'code'; // code | line | block | single | double | template
  const n = text.length;

  while (i < n) {
    const ch = text[i];
    const next = i + 1 < n ? text[i + 1] : '';

    if (mode === 'code') {
      if (ch === '/' && next === '/') {
        mode = 'line';
        out += '  ';
        i += 2;
        continue;
      }
      if (ch === '/' && next === '*') {
        mode = 'block';
        out += '  ';
        i += 2;
        continue;
      }
      if (ch === "'") mode = 'single';
      else if (ch === '"') mode = 'double';
      else if (ch === '`') mode = 'template';
      out += ch;
      i++;
      continue;
    }

    if (mode === 'line') {
      if (ch === '\n') {
        mode = 'code';
        out += ch;
      } else {
        out += ' ';
      }
      i++;
      continue;
    }

    if (mode === 'block') {
      if (ch === '*' && next === '/') {
        mode = 'code';
        out += '  ';
        i += 2;
        continue;
      }
      out += ch === '\n' ? '\n' : ' ';
      i++;
      continue;
    }

    // 字符串内部：原样保留，处理转义与结束引号
    const quote = mode === 'single' ? "'" : mode === 'double' ? '"' : '`';
    if (ch === '\\') {
      out += ch + next;
      i += 2;
      continue;
    }
    if (ch === quote) mode = 'code';
    out += ch;
    i++;
  }

  return out;
}

/** A + B：标识符与 require 越界。 */
function scanSource(entries) {
  const violations = [];

  for (const entry of entries) {
    const code = stripComments(entry.text);
    const lines = code.split('\n');

    for (let i = 0; i < lines.length; i++) {
      for (const name of BLACKLIST) {
        if (new RegExp(`\\b${name}\\b`).test(lines[i])) {
          violations.push({ kind: 'BLACKLIST_IDENTIFIER', path: entry.path, line: i + 1, detail: name, text: lines[i].trim() });
        }
      }
      for (const { pattern, label } of BLACKLIST_PATTERNS) {
        if (pattern.test(lines[i])) {
          violations.push({ kind: 'BLACKLIST_PATTERN', path: entry.path, line: i + 1, detail: label, text: lines[i].trim() });
        }
      }
    }

    const requirePattern = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
    let match;
    while ((match = requirePattern.exec(code)) !== null) {
      const spec = match[1];
      if (!spec.startsWith('.')) continue; // 宿主/平台内置模块不在本约束内
      const line = code.slice(0, match.index).split('\n').length;
      const resolved = path.resolve(path.dirname(entry.abs), spec);
      const inside = resolved === MINIAPP || resolved.startsWith(MINIAPP + path.sep);
      if (!inside) {
        violations.push({
          kind: 'OUT_OF_BOUNDS_REQUIRE',
          path: entry.path,
          line,
          detail: `require('${spec}') → ${path.relative(ROOT, resolved)}（落在 miniapp/ 之外）`,
          text: match[0],
        });
      }
    }
  }

  return violations;
}

/**
 * C：app.json 结构校验（纯函数，便于 --selftest 用内存假配置覆盖）。
 *
 * 「分包 pages 不得为空」源自抖音 IDE 的**实测**约束——官方文档只写了 `pages` 相对分包根目录，
 * 未规定下限，但 IDE 编译即报 `app.json ["subPackages"][n]["pages"] can't be empty`。
 * 该约束与《普通分包 · 引用原则》「packageA 无法使用 packageB 的资源」叠加后，
 * 使「无页面的资源类分包」**既不可编译、也无法被其它包引用**，故在此固化为门禁拦截，
 * 避免同类配置再次漏到 IDE 才暴露。
 */
function validateAppConfig(config) {
  const problems = [];
  const declared = [];
  const requirePage = (relPage, scopeLabel) => {
    const base = path.join(MINIAPP, relPage);
    for (const ext of ['.js', '.ttml']) {
      if (!fs.existsSync(base + ext)) {
        problems.push(`${scopeLabel} 声明的页面 ${relPage} 缺少 ${relPage}${ext}`);
      }
    }
    declared.push(relPage);
  };

  if (!Array.isArray(config.pages) || config.pages.length === 0) {
    problems.push('app.json 缺少非空的 pages 数组');
  } else {
    for (const page of config.pages) requirePage(page, '主包');
  }

  const subPackages = config.subPackages || config.subpackages || [];
  if (!Array.isArray(subPackages)) {
    problems.push('app.json 的 subPackages 应为数组');
  } else {
    for (const pkg of subPackages) {
      if (!pkg || typeof pkg.root !== 'string' || !Array.isArray(pkg.pages)) {
        problems.push(`分包声明结构非法：${JSON.stringify(pkg)}`);
        continue;
      }
      if (pkg.pages.length === 0) {
        problems.push(`分包 ${pkg.root} 的 pages 为空：抖音 IDE 拒绝空分包（编译报错）；且分包资源不可被其它包引用，「无页面的资源类分包」不可实现`);
        continue;
      }
      for (const page of pkg.pages) requirePage(path.join(pkg.root, page), `分包 ${pkg.root}`);
    }
  }

  return { problems, summary: `主包 ${config.pages ? config.pages.length : 0} 页 / 分包 ${subPackages.length} 个 / 全部页面存在（共 ${declared.length} 页）` };
}

/** 读 app.json 并调用 validateAppConfig。 */
function checkAppJson() {
  if (!fs.existsSync(APP_JSON)) {
    return { problems: [], skipped: true, summary: 'app.json 尚未落地，跳过页面存在性校验' };
  }

  let config;
  try {
    config = JSON.parse(fs.readFileSync(APP_JSON, 'utf8'));
  } catch (err) {
    return { problems: [`app.json 不是合法 JSON：${err.message}`], skipped: false, summary: '' };
  }

  const result = validateAppConfig(config);
  return { problems: result.problems, skipped: false, summary: result.summary };
}

function report(violations) {
  console.error('[check-client-isolation] 前端隔离校验未通过，阻断构建：');
  for (const v of violations) {
    console.error(`  - [${v.kind}] ${v.path}:${v.line}  ${v.detail}`);
    console.error(`      ${v.text}`);
  }
  console.error('  处置：计分与同频度只在 server/lib 实现；前端只能消费 tools/ 生成的 miniapp/shared/* 产物。');
}

function main() {
  if (SELFTEST) {
    // 反例自检：内存假源文本含前端不该出现的实现痕迹。不写任何文件。
    const fake = [
      {
        path: 'miniapp/__selftest__/fake.js',
        abs: path.join(MINIAPP, '__selftest__', 'fake.js'),
        text: "const { scoreArchetype } = require('../../server/lib/scoring.js');\nreturn a >= b ? 'A' : 'B';\n",
      },
    ];
    const violations = scanSource(fake);
    const kinds = new Set(violations.map((v) => v.kind));
    const sourceOk = kinds.has('BLACKLIST_IDENTIFIER') && kinds.has('OUT_OF_BOUNDS_REQUIRE') && kinds.has('BLACKLIST_PATTERN');

    // app.json 负例：沿用真实存在的两个主包页面，只让分包 pages 为空，
    // 使唯一问题就是「空分包」，不与页面缺失类问题混在一起。
    const fakeConfig = {
      pages: ['pages/home/index', 'pages/guide/index'],
      subPackages: [{ root: 'packageAsset', name: 'asset', pages: [] }],
    };
    const configProblems = validateAppConfig(fakeConfig).problems;
    const emptyPkgHit = configProblems.find((p) => p.includes('pages 为空'));

    if (!sourceOk || !emptyPkgHit) {
      console.error(`[check-client-isolation] --selftest 失败：应命中三类源违规 + 空分包；实际源违规 ${sourceOk ? '命中' : `未命中（${[...kinds].join(',') || '无'}）`}、空分包 ${emptyPkgHit ? '命中' : '未命中'}`);
      process.exit(1);
    }
    console.error('[check-client-isolation] --selftest：源违规命中位置如下（证明门禁不是空跑）');
    report(violations);
    console.error(`[check-client-isolation] --selftest：app.json 空分包负例已命中 —— ${emptyPkgHit}`);
    console.error('[check-client-isolation] --selftest 结束，按约定返回非 0。');
    process.exit(1);
  }

  const entries = collectFiles(MINIAPP, []);
  const violations = scanSource(entries);
  const appCheck = checkAppJson();
  for (const p of appCheck.problems) {
    violations.push({ kind: 'APP_JSON', path: 'miniapp/app.json', line: 0, detail: p, text: '' });
  }

  if (violations.length > 0) {
    report(violations);
    process.exit(1);
  }

  console.log(`[check-client-isolation] 通过：${entries.length} 个前端文件无计分副本、无越界 require`);
  console.log(`  - ${appCheck.summary}`);
}

main();

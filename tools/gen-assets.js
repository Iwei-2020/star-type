#!/usr/bin/env node
'use strict';

/**
 * 构建期美术资源生成器
 *
 * 依据：《美术资产-全流程视觉P01-P06线稿说明》§八（美术产出清单 10–12）、§九（出图前校对清单）；
 * 实施计划第二阶段「视觉还原」。
 *
 * 做什么：从 3 份美术稿 HTML 里**机械抽取内联 `<svg>`**（美术稿本身就是资源唯一权威，手抄必然漂移），
 * 补 `xmlns`、base64 编码为 data-URI，生成前端唯一可消费的资源产物：
 *   - miniapp/shared/assets.js       矢量版（内联 style 的 background-image 消费）
 *   - miniapp/shared/assets-card.js  位图版（canvas drawImage 消费，见下）
 *
 * 产物内容：
 *   SYMBOLS         16 个原型符号（按 archetype-index.js 的原型码索引，顺序与键序逐条断言）
 *   SYMBOLS_VIOLET  同上 16 个的金色→淡紫换色版（配对图谱里「受邀者」缩略卡用，见线稿 §6.4）
 *   HOME_SIGIL      P-01 首页主视觉「星环 / 轨道」（美术稿 P-01 专属，不在符号库内）
 *   DECOR           20 个通用装饰元素（编号 A-x … D-x）
 *   ICONS           20 个功能图标（24 × 24 网格，编号 A-x … D-x）
 *   assets-card.js  SHARE_SYMBOLS / SHARE_BASE：同一批符号与装饰库 D-4「分享卡底组」的
 *                   PNG 预栅格化版，供 P-04 / P-05 的方形分享卡在 canvas 上 drawImage 使用。
 *
 * 为什么用 data-URI + base64：小程序对本地 `.svg` 路径的 `<image>` 支持不确定，且组件默认样式隔离，
 * 故统一以「内联 style 的 background-image」渲染（见各页面 index.ttml / index.ttss）。
 * 组件放置于**主包** `miniapp/shared/`，供主包页面与两个分包页面共同引用。
 *
 * 为什么还要一份 PNG：平台 canvas 的 `Image` 只接受位图（PNG / JPEG 等），**不支持 SVG**，
 * 而分享卡必须在 canvas 上合成（技术资产 §6「保存图片」行）。故用 @resvg/resvg-js
 * （纯 Rust WASM，无系统依赖）在构建期把同一批 `<svg>` 栅格化为 PNG —— 见 package.json
 * 的 devDependencies，属**构建期依赖**，不进小程序包。
 *
 * 跨格子引用：装饰库中 D-1 等格子会 `url(#fadeLine)` / `url(#glowRadial)` 引用**其它格子**里定义的
 * 渐变。逐格子独立编码会得到一个指向空气的 url()，故本生成器先索引全文 `<defs>`，再为每个引用补齐定义。
 *
 * 用法：
 *   node tools/gen-assets.js            生成（写盘）
 *   node tools/gen-assets.js --check    只校验，不写盘；不一致则 exit 1
 */

const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

const archetypeIndex = require('../miniapp/shared/archetype-index.js');

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'doc');
const OUT = path.join(ROOT, 'miniapp', 'shared', 'assets.js');
const OUT_CARD = path.join(ROOT, 'miniapp', 'shared', 'assets-card.js');
const CHECK_ONLY = process.argv.includes('--check');

/** PNG 栅格化边长（像素）：符号在卡上按 208rpx 绘制（2× 后为 208 画布像素），
 *  取 256 留出余量；底组满铺 750px 画布，故按画布边长栅格化。 */
const RASTER_SYMBOL = 256;
const RASTER_BASE = 750;

const FILES = {
  symbols: ['美术稿-原型符号库.html', '原型符号库'],
  decor: ['美术稿-通用装饰元素库.html', '通用装饰元素库'],
  icons: ['美术稿-功能图标库.html', '功能图标库'],
  flow: ['美术稿-全流程视觉-P01-P06.html', '全流程视觉 P01-P06'],
};

/** 库内编号形如 `01 · AAAA`（符号库）或 `A-1`（装饰 / 图标库）。 */
const IDX_CODE = /^[AB]{4}$/;
const IDX_GROUP = /^[A-D]-\d+$/;

const EXPECTED = { symbols: 16, decor: 20, icons: 20 };

const problems = [];
const fail = (msg) => problems.push(msg);

function read(key) {
  const [name, label] = FILES[key];
  const abs = path.join(DOCS, name);
  if (!fs.existsSync(abs)) {
    fail(`缺少美术稿：${name}`);
    return '';
  }
  return fs.readFileSync(abs, 'utf8');
}

/** 全文 <defs> 索引：id → 该定义块，供跨格子引用补齐。 */
function collectDefs(html) {
  const map = new Map();
  const blockRe = /<defs>([\s\S]*?)<\/defs>/g;
  let block;
  while ((block = blockRe.exec(html))) {
    const text = block[1];
    const wrapped = `<defs>${text}</defs>`;
    const idRe = /id="([^"]+)"/g;
    let id;
    while ((id = idRe.exec(text))) map.set(id[1], wrapped);
  }
  return map;
}

/**
 * 把抽取到的 `attrs >BODY` 还原为可直接编码的完整 svg：
 * 补 xmlns（内联 svg 缺命名空间时，作为独立资源图片无法渲染）、补 width/height
 * （只有 viewBox 而没有内在尺寸的 SVG 作为 CSS background-image 时部分内核不缩放），
 * 并补齐 BODY 里 url(#x) 引用的 <defs>。
 */
function toSvg(raw, defs) {
  const gt = raw.indexOf('>');
  if (gt === -1) {
    fail('抽到的 <svg> 缺少开标签结束符');
    return `<svg xmlns="http://www.w3.org/2000/svg"/>`;
  }
  let attrs = raw.slice(0, gt);
  const body = raw.slice(gt + 1);

  let prefix = '';
  const refs = new Set((body.match(/url\(#([^)]+)\)/g) || []).map((s) => s.slice(5, -1)));
  for (const id of refs) {
    const block = defs.get(id);
    if (block && !body.includes(`id="${id}"`)) prefix += block;
  }

  if (!/\sxmlns=/.test(attrs)) attrs += ' xmlns="http://www.w3.org/2000/svg"';
  const viewBox = attrs.match(/viewBox="([\d.\s-]+)"/);
  if (viewBox && !/\swidth=/.test(attrs)) {
    const parts = viewBox[1].trim().split(/\s+/);
    if (parts.length === 4) attrs += ` width="${parts[2]}" height="${parts[3]}"`;
    else fail(`viewBox 解析失败：${viewBox[1]}`);
  }

  return `<svg${attrs}>${prefix}${body}</svg>`;
}

function toDataUri(svg) {
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

/** 同一份 <svg> 的 PNG 版（供 canvas drawImage）：栅格化到指定边长，保留透明背景。 */
function toPngDataUri(svg, size, label) {
  let png;
  try {
    png = new Resvg(svg, {
      fitTo: { mode: 'width', value: size },
      background: 'rgba(0,0,0,0)',
    })
      .render()
      .asPng();
  } catch (err) {
    fail(`位图栅格化失败（${label}）：${err && err.message ? err.message : err}`);
    return '';
  }
  if (!png || png.length === 0) {
    fail(`位图栅格化结果为空（${label}）`);
    return '';
  }
  return `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
}

/** 抽取「.idx 编号 + 紧随其后的内联 <svg>」序列（三份库的格子结构一致）。 */
function extractCells(html, defs, label) {
  const cells = [];
  const re = /class="idx">([^<]+)<\/div>\s*<svg([\s\S]*?)<\/svg>/g;
  let m;
  while ((m = re.exec(html))) cells.push({ idx: m[1].trim(), svg: toSvg(m[2], defs) });
  if (cells.length === 0) fail(`${label} 未抽到任何内联 <svg>（稿结构可能已变化）`);
  return cells;
}

// ─────────────────────────────────────────────
// 1. 原型符号（16）+ 换色版
// ─────────────────────────────────────────────

function buildSymbols() {
  const html = read('symbols');
  const defs = collectDefs(html);
  const cells = extractCells(html, defs, FILES.symbols[1]);

  const raw = {};
  const order = [];
  for (const cell of cells) {
    const code = cell.idx.split('·').pop().trim();
    if (!IDX_CODE.test(code)) {
      fail(`原型符号库编号「${cell.idx}」无法解析出原型码`);
      continue;
    }
    if (raw[code]) fail(`原型符号库出现重复原型码 ${code}`);
    raw[code] = cell.svg;
    order.push(code);
  }

  if (order.length !== EXPECTED.symbols) {
    fail(`原型符号应为 ${EXPECTED.symbols} 个，实际 ${order.length} 个`);
  }
  // 顺序断言：结果页按 archetype-index 键序取符号，顺序错位会静默张冠李戴
  const expectedOrder = Object.keys(archetypeIndex);
  if (order.join(',') !== expectedOrder.join(',')) {
    fail(
      `原型符号顺序与 archetype-index 键序不一致（会导致符号与原型错配）：\n` +
        `    符号库 ${order.join(',')}\n    索引   ${expectedOrder.join(',')}`
    );
  }

  const gold = {};
  const violet = {};
  for (const code of Object.keys(raw)) {
    gold[code] = toDataUri(raw[code]);
    // 受邀者缩略卡用淡紫：把金色换成 --violet，原有淡紫点缀保持不变
    violet[code] = toDataUri(raw[code].replace(/#e8c87a/gi, '#c9b6ff'));
  }
  return { gold, violet, raw };
}

// ─────────────────────────────────────────────
// 2. 首页主视觉（P-01 星环 / 轨道）
// ─────────────────────────────────────────────

function buildHomeSigil() {
  const html = read('flow');
  const defs = collectDefs(html);
  const m = html.match(/<svg class="home-sigil"([\s\S]*?)<\/svg>/);
  if (!m) {
    fail('全流程视觉稿未找到 P-01 主视觉（<svg class="home-sigil">）');
    return '';
  }
  return toDataUri(toSvg(m[1], defs));
}

// ─────────────────────────────────────────────
// 3. 通用装饰元素（20）与功能图标（20）
// ─────────────────────────────────────────────

function buildLibrary(key) {
  const html = read(key);
  const defs = collectDefs(html);
  const [name, label] = FILES[key];
  const cells = extractCells(html, defs, label);

  const map = {};
  const svgs = {};
  for (const cell of cells) {
    if (!IDX_GROUP.test(cell.idx)) {
      fail(`${name} 出现无法识别的编号「${cell.idx}」（应为 A-1 … D-4 形态）`);
      continue;
    }
    if (map[cell.idx]) fail(`${name} 出现重复编号 ${cell.idx}`);
    map[cell.idx] = toDataUri(cell.svg);
    svgs[cell.idx] = cell.svg;
  }
  if (Object.keys(map).length !== EXPECTED[key]) {
    fail(`${label} 应为 ${EXPECTED[key]} 个，实际 ${Object.keys(map).length} 个`);
  }
  return { uris: map, svgs };
}

// ─────────────────────────────────────────────
// 3.5 方形分享卡的 PNG 位图（canvas 用）
// ─────────────────────────────────────────────

/**
 * 分享卡需要在 canvas 上合成，而平台 canvas 只认位图，故把符号与装饰库 D-4
 * 「分享卡底组」（B-1 + A-1 + C-1，降透明满铺）预栅格化。产出的键序与
 * assets.js 的 SYMBOLS 完全一致，来源同一批 `<svg>`，不存在两套美术口径。
 */
function buildCardAssets(symbolSvgs, decorSvgs) {
  const baseSvg = decorSvgs['D-4'];
  if (!baseSvg) {
    fail('装饰库缺少 D-4（分享卡底组），无法生成方形分享卡底图');
    return { base: '', symbols: {} };
  }

  const symbols = {};
  for (const code of Object.keys(symbolSvgs)) {
    symbols[code] = toPngDataUri(symbolSvgs[code], RASTER_SYMBOL, `符号 ${code}`);
  }
  return { base: toPngDataUri(baseSvg, RASTER_BASE, '分享卡底组 D-4'), symbols };
}

// ─────────────────────────────────────────────
// 4. 产物渲染
// ─────────────────────────────────────────────

const GEN_HEADER = [
  "'use strict';",
  '',
  '// ─────────────────────────────────────────────────────────────',
  '// 本文件由 tools/gen-assets.js 从 3 份美术稿的内联 <svg> 机械提取生成。',
  '// 禁止手改：改动会在下一次生成时被覆盖，且 gen-assets.js --check 会失败。',
  '// 改动符号 / 装饰 / 图标请改美术稿原文，然后重新运行 node tools/gen-assets.js。',
  '//',
  '// 值为 data-URI（base64 SVG），用法：内联 style 的 background-image。',
  '// 组件位于主包 miniapp/shared/，供主包页面与 packageQuiz / packagePair 共同引用。',
  '// ─────────────────────────────────────────────────────────────',
  '',
].join('\n');

function renderMap(map, indent) {
  const pad = '  '.repeat(indent + 1);
  const closePad = '  '.repeat(indent);
  const keys = Object.keys(map);
  if (keys.length === 0) return 'Object.freeze({})';
  return `Object.freeze({\n${keys
    .map((k) => `${pad}${JSON.stringify(k)}: ${JSON.stringify(map[k])}`)
    .join(',\n')}\n${closePad}})`;
}

function renderAssets(data) {
  return `${GEN_HEADER}module.exports = Object.freeze({
  HOME_SIGIL: ${JSON.stringify(data.homeSigil)},
  SYMBOLS: ${renderMap(data.symbols, 1)},
  SYMBOLS_VIOLET: ${renderMap(data.symbolsViolet, 1)},
  DECOR: ${renderMap(data.decor, 1)},
  ICONS: ${renderMap(data.icons, 1)},
});
`;
}

const CARD_GEN_HEADER = [
  "'use strict';",
  '',
  '// ─────────────────────────────────────────────────────────────',
  '// 本文件由 tools/gen-assets.js 从 3 份美术稿的内联 <svg> 机械提取，',
  '// 并用 @resvg/resvg-js 预栅格化为 PNG 生成。',
  '// 禁止手改：改动会在下一次生成时被覆盖，且 gen-assets.js --check 会失败。',
  '// 改动符号 / 底组请改美术稿原文，然后重新运行 node tools/gen-assets.js。',
  '//',
  '// 值为 data-URI（base64 PNG），用法：canvas 2d 的 drawImage',
  '// （平台 canvas 的 Image 只接受位图，不支持 SVG）。',
  '// 消费方：miniapp/core/share-card.js（P-04 / P-05 方形分享卡）。',
  '// ─────────────────────────────────────────────────────────────',
  '',
].join('\n');

function renderCardAssets(data) {
  return `${CARD_GEN_HEADER}module.exports = Object.freeze({
  SHARE_BASE: ${JSON.stringify(data.base)},
  SHARE_SYMBOLS: ${renderMap(data.symbols, 1)},
});
`;
}

// ─────────────────────────────────────────────
// 5. 主流程
// ─────────────────────────────────────────────

/** 产物一致性校验：缺失或与美术稿不一致都判失败（避免漂移静默通过）。 */
function checkSame(file, content, label) {
  if (!fs.existsSync(file)) {
    console.error(`[gen-assets] --check 失败：产物缺失 ${label}，请先运行 node tools/gen-assets.js`);
    process.exit(1);
  }
  if (fs.readFileSync(file, 'utf8') !== content) {
    console.error(`[gen-assets] --check 失败：${label} 与美术稿不一致（发生漂移）`);
    console.error('  处置：重新运行 node tools/gen-assets.js 覆盖产物，并确认美术稿改动是预期的。');
    process.exit(1);
  }
}

function main() {
  const { gold, violet, raw: symbolSvgs } = buildSymbols();
  const homeSigil = buildHomeSigil();
  const decor = buildLibrary('decor');
  const icons = buildLibrary('icons');
  const card = buildCardAssets(symbolSvgs, decor.svgs);

  if (problems.length > 0) {
    console.error('[gen-assets] 抽取校验未通过：');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  const content = renderAssets({
    homeSigil,
    symbols: gold,
    symbolsViolet: violet,
    decor: decor.uris,
    icons: icons.uris,
  });
  const cardContent = renderCardAssets(card);

  if (CHECK_ONLY) {
    checkSame(OUT, content, 'miniapp/shared/assets.js');
    checkSame(OUT_CARD, cardContent, 'miniapp/shared/assets-card.js');
    console.log('[gen-assets] 校验通过（未写盘）');
    return;
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const changed = !fs.existsSync(OUT) || fs.readFileSync(OUT, 'utf8') !== content;
  const changedCard = !fs.existsSync(OUT_CARD) || fs.readFileSync(OUT_CARD, 'utf8') !== cardContent;
  fs.writeFileSync(OUT, content, 'utf8');
  fs.writeFileSync(OUT_CARD, cardContent, 'utf8');

  const kb = (n) => `${Math.round(n / 1024)}KB`;
  console.log(
    `[gen-assets] 生成完成：原型符号 ${Object.keys(gold).length} 个（含淡紫换色版）/ ` +
      `首页主视觉 1 个 / 装饰 ${Object.keys(decor.uris).length} 个 / 图标 ${Object.keys(icons.uris).length} 个 / ` +
      `分享卡位图：符号 ${Object.keys(card.symbols).length} + 底组 1`
  );
  console.log(`  - miniapp/shared/assets.js ${changed ? '(更新)' : '(无变化)'}，约 ${kb(Buffer.byteLength(content))}`);
  console.log(`  - miniapp/shared/assets-card.js ${changedCard ? '(更新)' : '(无变化)'}，约 ${kb(Buffer.byteLength(cardContent))}`);
}

main();

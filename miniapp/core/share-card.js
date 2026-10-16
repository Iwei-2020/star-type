'use strict';

/**
 * 方形分享卡（1:1）合成
 *
 * 依据：《美术资产-全流程视觉P01-P06线稿说明》§5.2（方形分享卡线稿：符号 / 原型名 /
 * 意象行 / 概述首句 ≤22 字截断 / 配对入口 / 免责）、《技术资产》§6「保存图片」行
 * （Canvas 绘制分享卡 → 相册，图片内印配对码）与「Canvas 需按 2× 绘制」。
 *
 * 为什么走「预栅格化位图 + 系统字体」：
 *   平台 canvas 的 `Image` 只接受 PNG / JPEG 等位图（不支持 SVG），而美术资源在
 *   `shared/assets.js` 里是 data-URI SVG。故符号与底组由 `tools/gen-assets.js` 在构建期
 *   用 resvg 预栅格化为 PNG data-URI，落在 `shared/assets-card.js`，运行时只 `drawImage`。
 *   画布文字用系统字体渲染，不经子集字体，因此不进入字符集门禁口径。
 *
 * 边界：只做「取展示文案 → 画布合成 → 存相册」。文案一律取自 `display`（原型解读 /
 * 界面文案 / 免责），位图取自构建期产物；**不触碰计分与同频度**（技术资产 §1.2）。
 */

const display = require('./display.js');
const cardAssets = require('../shared/assets-card.js');

/** 画布逻辑边长（pt）：美术稿 §5.2 方形卡 375pt 见方（= 750rpx）。 */
const CARD_PT = 375;
/** 绘制倍率（技术资产 §6：按 2× 绘制，避免低端机字体发虚）。 */
const SCALE = 2;
/** 画布像素边长；同时是导出图片的边长。 */
const CARD_PX = CARD_PT * SCALE;
/** 概述首句截断字数（美术稿 §5.2：≤ 22 字截断）。 */
const SUMMARY_MAX = 22;
/** 概述最多折行数（超出部分丢弃，避免长文案顶掉免责区）。 */
const SUMMARY_LINES = 2;

/** 色值 Token 取 PRD 5.2（canvas 无 CSS 变量，此处以内联常量落地）。 */
const COLORS = {
  bgFrom: '#1B1035',
  bgTo: '#3A2A6B',
  ivory: '#F5EFE6',
  gold: '#E8C87A',
  violet: '#C9B6FF',
  summary: 'rgba(245,239,230,0.78)',
  note: 'rgba(245,239,230,0.50)',
  chipLine: 'rgba(201,182,255,0.50)',
};

/** 标题 / 正文两族字体（与美术资产 §1 同口径；设备缺失时由系统字体兜底）。 */
const FONT_TITLE = '"LXGW WenKai","Songti SC","STSong",serif';
const FONT_BODY = '"PingFang SC","Source Han Sans SC","Microsoft YaHei",sans-serif';

/**
 * 版面尺寸：均以 rpx 记（该倍率下 1 rpx = 1 画布像素），数值取美术稿 §5.2 的 px × 2。
 * 免责字号从美术稿的 20rpx 上调为 24rpx —— 美术资产 §1 明确「不得低于 24rpx」，为合规锁。
 */
const M = {
  padY: 52,
  sigil: 208,
  gap: 18,
  nameSize: 56,
  imagerySize: 28,
  summarySize: 24,
  summaryMaxW: 520,
  chipSize: 22,
  chipPadX: 28,
  chipPadY: 8,
  noteSize: 24,
  footGap: 16,
  footInnerGap: 10,
};

const NAME_LH = 1.2;
const IMAGERY_LH = 1.2;
const SUMMARY_LH = 1.7;
const CHIP_LH = 1.2;
const NOTE_LH = 1.35;

const titleFont = (size) => `600 ${size}px ${FONT_TITLE}`;
const bodyFont = (size) => `400 ${size}px ${FONT_BODY}`;

/** 概述首句（按中文句读切分），超出 max 字即截断并加省略号（美术稿 §5.2）。 */
function firstSentence(text, max) {
  const raw = String(text === null || text === undefined ? '' : text).trim();
  if (!raw) return '';
  const head = (raw.split(/[。！？；;.!?\n]/)[0] || '').trim();
  if (head.length > max) return `${head.slice(0, max)}…`;
  return head;
}

function measureWidth(ctx, text) {
  const m = ctx.measureText(String(text));
  return m && typeof m.width === 'number' ? m.width : 0;
}

/** 按当前 ctx.font 折行（逐字贪心；中文单字宽度即 font-size，无需词典）。 */
function wrap(ctx, text, maxWidth) {
  const lines = [];
  let line = '';
  for (const ch of String(text || '')) {
    const next = line + ch;
    if (line && measureWidth(ctx, next) > maxWidth) {
      lines.push(line);
      line = ch;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** 圆角矩形路径（不用 ctx.roundRect：小程序端对其支持不一致）。 */
function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function drawImageBox(ctx, img, x, y, w, h, alpha) {
  if (!img) return;
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = alpha === undefined ? 1 : alpha;
  ctx.drawImage(img, x, y, w, h);
  ctx.globalAlpha = prev === undefined ? 1 : prev;
}

/**
 * 组装卡片数据模型（纯展示：文案 + 位图 src），非法原型码或资源缺失时返回 null。
 * 位图对象在 `compose` 里装载后回填 symbolImg / baseImg。
 */
function buildModel(archetypeCode, pairCode) {
  const found = display.archetype(archetypeCode);
  if (!found) return null;

  const symbolSrc = cardAssets.SHARE_SYMBOLS[found.code];
  const baseSrc = cardAssets.SHARE_BASE;
  if (!symbolSrc || !baseSrc) return null;

  return {
    symbolSrc,
    baseSrc,
    symbolImg: null,
    baseImg: null,
    name: found.name,
    imagery: found.symbol,
    summary: firstSentence(found.summary, SUMMARY_MAX),
    pairCode: pairCode ? String(pairCode) : '',
    pairCodeLabel: display.ui('result.pairCodeLabel'),
    note: display.disclaimer('share'),
  };
}

/**
 * 在给定 2d 上下文上绘制整张卡（纯函数：只依赖 ctx 标准接口，便于单测）。
 * 纵向为「整块居中」：先按实际折行数算出块高，再取其垂直居中起点。
 */
function drawCard(ctx, model) {
  const px = CARD_PX;
  const cx = px / 2;

  // ① 背景渐变 135°（PRD 5.2）
  const bg = ctx.createLinearGradient(0, 0, px, px);
  bg.addColorStop(0, COLORS.bgFrom);
  bg.addColorStop(1, COLORS.bgTo);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, px, px);

  // ② 底组：装饰库 D-4「分享卡底组」（B-1 + A-1 + C-1，降透明满铺）
  drawImageBox(ctx, model.baseImg, 0, 0, px, px, 0.45);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.font = bodyFont(M.summarySize);
  const summaryLines = wrap(ctx, model.summary, M.summaryMaxW).slice(0, SUMMARY_LINES);

  const chipBox = model.pairCode ? M.chipSize * CHIP_LH + M.chipPadY * 2 : 0;
  const chipGap = model.pairCode ? M.gap + M.footGap : 0;
  const nameH = M.nameSize * NAME_LH;
  const imageryH = M.imagerySize * IMAGERY_LH;
  const summaryH = M.summarySize * SUMMARY_LH * summaryLines.length;
  const noteH = M.noteSize * NOTE_LH;

  const blockH =
    M.sigil + M.gap + nameH + M.gap + imageryH + M.gap + summaryH + chipGap + chipBox + M.footInnerGap + noteH;
  let y = Math.max(M.padY, (px - blockH) / 2);

  // ③ 主导意象符号（居中）
  drawImageBox(ctx, model.symbolImg, cx - M.sigil / 2, y, M.sigil, M.sigil, 1);
  y += M.sigil + M.gap;

  // ④ 原型名
  ctx.font = titleFont(M.nameSize);
  ctx.fillStyle = COLORS.ivory;
  ctx.fillText(model.name, cx, y + nameH / 2);
  y += nameH + M.gap;

  // ⑤ 意象行
  ctx.font = titleFont(M.imagerySize);
  ctx.fillStyle = COLORS.gold;
  ctx.fillText(model.imagery, cx, y + imageryH / 2);
  y += imageryH + M.gap;

  // ⑥ 概述首句（≤22 字截断，最多 2 行）
  ctx.font = bodyFont(M.summarySize);
  ctx.fillStyle = COLORS.summary;
  for (const line of summaryLines) {
    ctx.fillText(line, cx, y + (M.summarySize * SUMMARY_LH) / 2);
    y += M.summarySize * SUMMARY_LH;
  }

  // ⑦ 配对入口：配对码 chip（无配对码则整段不占位）
  if (model.pairCode) {
    y += M.gap + M.footGap;
    const label = model.pairCodeLabel ? `${model.pairCodeLabel} · ${model.pairCode}` : model.pairCode;
    ctx.font = bodyFont(M.chipSize);
    const w = measureWidth(ctx, label) + M.chipPadX * 2;
    roundRectPath(ctx, cx - w / 2, y, w, chipBox, chipBox / 2);
    ctx.strokeStyle = COLORS.chipLine;
    ctx.lineWidth = 2;
    const canDash = typeof ctx.setLineDash === 'function';
    if (canDash) ctx.setLineDash([8, 8]);
    ctx.stroke();
    if (canDash) ctx.setLineDash([]);
    ctx.fillStyle = COLORS.violet;
    ctx.fillText(label, cx, y + chipBox / 2);
    y += chipBox;
  }

  // ⑧ 免责：常驻卡内（PRD 6 章 P-06：分享卡内文字 + 弹窗底部各一次）
  y += M.footInnerGap;
  ctx.font = bodyFont(M.noteSize);
  ctx.fillStyle = COLORS.note;
  ctx.fillText(model.note, cx, y + noteH / 2);
}

/** 用 canvas 节点装载一张 data-URI 位图。 */
function loadImage(node, src) {
  return new Promise((resolve, reject) => {
    if (!node || typeof node.createImage !== 'function') {
      reject(new Error('no_create_image'));
      return;
    }
    const img = node.createImage();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image_load_failed'));
    img.src = src;
  });
}

/** 导出临时文件：优先 canvasToTempFilePath，平台不支持时退回 toDataURL + 写临时文件。 */
function viaCanvasToTempFilePath(node) {
  return new Promise((resolve, reject) => {
    tt.canvasToTempFilePath({
      canvas: node,
      x: 0,
      y: 0,
      width: CARD_PX,
      height: CARD_PX,
      destWidth: CARD_PX,
      destHeight: CARD_PX,
      fileType: 'png',
      success: (res) => {
        const path = res && res.tempFilePath ? res.tempFilePath : '';
        if (path) resolve(path);
        else reject(new Error('empty_temp_file_path'));
      },
      fail: (err) => reject(new Error(err && err.errMsg ? err.errMsg : 'canvas_to_temp_failed')),
    });
  });
}

function viaDataUrl(node) {
  return new Promise((resolve, reject) => {
    if (!node || typeof node.toDataURL !== 'function') {
      reject(new Error('no_to_data_url'));
      return;
    }
    const api = typeof tt === 'undefined' ? null : tt;
    if (!api || typeof api.getFileSystemManager !== 'function') {
      reject(new Error('no_file_system'));
      return;
    }
    const dataUrl = String(node.toDataURL('image/png'));
    const base64 = dataUrl.split(',')[1] || '';
    if (!base64) {
      reject(new Error('empty_data_url'));
      return;
    }
    const fs = api.getFileSystemManager();
    if (!fs || typeof fs.writeFileSync !== 'function') {
      reject(new Error('no_file_system'));
      return;
    }
    const env = api.env ? api.env : null;
    const dir = env && env.USER_DATA_PATH ? env.USER_DATA_PATH : '';
    const path = `${dir}/share-card-${Date.now()}.png`;
    try {
      fs.writeFileSync(path, base64, 'base64');
      resolve(path);
    } catch (err) {
      reject(new Error(err && err.message ? String(err.message) : 'write_temp_failed'));
    }
  });
}

function exportPng(node) {
  if (typeof tt === 'undefined' || !tt) return Promise.reject(new Error('no_tt'));
  if (typeof tt.canvasToTempFilePath === 'function') {
    return viaCanvasToTempFilePath(node).catch(() => viaDataUrl(node));
  }
  return viaDataUrl(node);
}

/** 存相册（失败不抛：渠道失败只做弱提示，不改变弹窗状态 —— 美术资产 §7.3）。 */
function saveAlbum(filePath) {
  return new Promise((resolve) => {
    if (!filePath) {
      resolve({ ok: false, code: 'NO_TEMP_FILE', msg: 'no_temp_file' });
      return;
    }
    if (typeof tt === 'undefined' || !tt || typeof tt.saveImageToPhotosAlbum !== 'function') {
      resolve({ ok: false, code: 'NO_SAVE_API', msg: 'no_save_api' });
      return;
    }
    try {
      tt.saveImageToPhotosAlbum({
        filePath,
        success: () => resolve({ ok: true, code: 'OK', msg: '' }),
        fail: (err) => resolve({ ok: false, code: 'SAVE_FAILED', msg: err && err.errMsg ? err.errMsg : 'save_failed' }),
      });
    } catch (err) {
      resolve({ ok: false, code: 'SAVE_FAILED', msg: err && err.message ? String(err.message) : 'save_threw' });
    }
  });
}

/**
 * 合成并保存方形分享卡。
 * @param {{host:object, canvasId:string, archetypeCode:string, pairCode?:string}} opts
 *   host 为持有隐藏 canvas 的组件实例（需具备 createSelectorQuery）。
 * @returns {Promise<{ok:boolean, code:string, msg:string}>} 一律 resolve，不抛异常。
 */
function saveToAlbum(opts) {
  const o = opts || {};
  const fail = (code, msg) => Promise.resolve({ ok: false, code, msg });

  const model = buildModel(o.archetypeCode, o.pairCode);
  if (!model) return fail('CARD_DATA_INVALID', 'card_data_invalid');
  if (!o.host || typeof o.host.createSelectorQuery !== 'function') return fail('NO_HOST', 'no_host');

  return new Promise((resolve) => {
    const done = (res) => resolve(res || { ok: false, code: 'UNKNOWN', msg: 'unknown' });

    try {
      o.host
        .createSelectorQuery()
        .select(`#${o.canvasId}`)
        .fields({ node: true, size: true })
        .exec((res) => {
          const node = res && res[0] ? res[0].node : null;
          if (!node || typeof node.getContext !== 'function') {
            done({ ok: false, code: 'NO_CANVAS', msg: 'no_canvas_node' });
            return;
          }

          node.width = CARD_PX;
          node.height = CARD_PX;
          const ctx = node.getContext('2d');

          Promise.all([loadImage(node, model.symbolSrc), loadImage(node, model.baseSrc)])
            .then((imgs) => {
              model.symbolImg = imgs[0];
              model.baseImg = imgs[1];
              drawCard(ctx, model);
              return exportPng(node);
            })
            .then((filePath) => saveAlbum(filePath))
            .then((out) => done(out))
            .catch((err) => done({ ok: false, code: 'SAVE_FAILED', msg: err && err.message ? String(err.message) : 'failed' }));
        });
    } catch (err) {
      done({ ok: false, code: 'SAVE_FAILED', msg: err && err.message ? String(err.message) : 'threw' });
    }
  });
}

module.exports = {
  CARD_PX,
  SUMMARY_MAX,
  firstSentence,
  wrap,
  buildModel,
  drawCard,
  saveToAlbum,
};

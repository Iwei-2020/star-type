'use strict';

/**
 * 方形分享卡合成单测（miniapp/core/share-card.js）
 * 断言口径：① 文案取值与截断规则（美术资产 §5.2）；② 版式元素落位（居中符号 / 配对码 chip /
 * 卡内免责）；③ 存相册链路成功与各类失败一律 resolve、不抛。
 */

const test = require('node:test');
const assert = require('node:assert');

const shareCard = require('../miniapp/core/share-card.js');

/** 记录型 2d 上下文：只实现本模块用到的方法，便于断言调用序列与参数。 */
function makeCtx() {
  const calls = [];
  const ctx = {
    calls,
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    textAlign: '',
    textBaseline: '',
    globalAlpha: 1,
    createLinearGradient: (...a) => {
      calls.push(['createLinearGradient', a]);
      return { addColorStop: (...b) => calls.push(['addColorStop', b]) };
    },
    fillRect: (...a) => calls.push(['fillRect', a]),
    drawImage: (...a) => calls.push(['drawImage', a]),
    measureText: (t) => {
      const m = /(\d+(?:\.\d+)?)px/.exec(ctx.font);
      const size = m ? Number(m[1]) : 0;
      return { width: String(t).length * size };
    },
    fillText: (...a) => calls.push(['fillText', a]),
    beginPath: () => calls.push(['beginPath', []]),
    moveTo: (...a) => calls.push(['moveTo', a]),
    lineTo: (...a) => calls.push(['lineTo', a]),
    quadraticCurveTo: (...a) => calls.push(['quadraticCurveTo', a]),
    closePath: () => calls.push(['closePath', []]),
    stroke: () => calls.push(['stroke', []]),
    setLineDash: (dash) => calls.push(['setLineDash', dash]),
  };
  return ctx;
}

const textsOf = (ctx) => ctx.calls.filter((c) => c[0] === 'fillText').map((c) => c[1][0]);
const findCalls = (ctx, name) => ctx.calls.filter((c) => c[0] === name);

test('firstSentence：取首句、超长按 22 字截断、空值安全', () => {
  assert.strictEqual(shareCard.firstSentence('你倾向于把能量向外打开。后半句不进入卡片。', 22), '你倾向于把能量向外打开');
  assert.strictEqual(shareCard.firstSentence('甲'.repeat(30), 22), `${'甲'.repeat(22)}…`);
  assert.strictEqual(shareCard.firstSentence('', 22), '');
  assert.strictEqual(shareCard.firstSentence(null, 22), '');
});

test('wrap：按当前字号逐字折行', () => {
  const ctx = makeCtx();
  ctx.font = '400 24px sans-serif';
  assert.deepStrictEqual(shareCard.wrap(ctx, '一二三四五六', 100), ['一二三四', '五六']);
  assert.deepStrictEqual(shareCard.wrap(ctx, '一二', 100), ['一二']);
  assert.deepStrictEqual(shareCard.wrap(ctx, '', 100), []);
});

test('buildModel：合法原型码组装文案模型，非法码返回 null', () => {
  const model = shareCard.buildModel('AAAA', 'K7Q2');
  assert.ok(model, 'AAAA 应为合法原型码');
  assert.strictEqual(model.pairCode, 'K7Q2');
  assert.strictEqual(model.pairCodeLabel, '配对码');
  assert.ok(model.name.length > 0);
  assert.ok(model.imagery.length > 0);
  assert.ok(model.summary.length <= shareCard.SUMMARY_MAX + 1, '概述首句须 ≤22 字截断');
  assert.ok(model.note.length > 0, '卡内免责文案不可为空');
  assert.strictEqual(model.symbolSrc.slice(0, 22), 'data:image/png;base64,', '符号须为 PNG 位图');
  assert.strictEqual(model.baseSrc.slice(0, 22), 'data:image/png;base64,', '底组须为 PNG 位图');

  assert.strictEqual(shareCard.buildModel('ZZZZ', 'K7Q2'), null);
  assert.strictEqual(shareCard.buildModel('', ''), null);
});

test('drawCard：背景、底组、居中符号、文案与配对码 chip 逐项落位', () => {
  const model = shareCard.buildModel('AAAA', 'K7Q2');
  const ctx = makeCtx();
  const symbolImg = { tag: 'symbol' };
  const baseImg = { tag: 'base' };
  model.symbolImg = symbolImg;
  model.baseImg = baseImg;

  shareCard.drawCard(ctx, model);

  const px = shareCard.CARD_PX;
  assert.deepStrictEqual(findCalls(ctx, 'fillRect')[0][1], [0, 0, px, px], '须满铺背景');
  assert.strictEqual(findCalls(ctx, 'createLinearGradient').length, 1);

  const draws = findCalls(ctx, 'drawImage');
  assert.strictEqual(draws.length, 2, '底组 + 符号各一次');
  assert.deepStrictEqual(draws[0][1], [baseImg, 0, 0, px, px], '底组满铺');
  assert.strictEqual(draws[1][1][1], px / 2 - 104, '符号须水平居中');
  assert.strictEqual(draws[1][1][3], 208);
  assert.strictEqual(draws[1][1][4], 208);

  const texts = textsOf(ctx);
  assert.ok(texts.includes(model.name), '缺原型名');
  assert.ok(texts.includes(model.imagery), '缺意象行');
  assert.ok(texts.includes(model.note), '缺卡内免责');
  assert.ok(texts.includes(`配对码 · K7Q2`), '缺配对码 chip');

  const dash = findCalls(ctx, 'setLineDash');
  assert.deepStrictEqual(dash[0][1], [8, 8], 'chip 须虚线描边');
  assert.deepStrictEqual(dash[1][1], [], '虚线须复位');
});

test('drawCard：无配对码时不画 chip（不留空环、不占位）', () => {
  const model = shareCard.buildModel('AAAA', '');
  const ctx = makeCtx();
  model.symbolImg = { tag: 'symbol' };
  model.baseImg = { tag: 'base' };

  shareCard.drawCard(ctx, model);

  assert.strictEqual(findCalls(ctx, 'setLineDash').length, 0, '无配对码不应出现虚线框');
  assert.ok(!textsOf(ctx).some((t) => t.includes('配对码')), '无配对码不应出现配对入口文案');
  assert.ok(textsOf(ctx).includes(model.note), '免责仍须常驻');
});

test('drawCard：概述超出两行时只画两行（保住免责区不被顶掉）', () => {
  const model = shareCard.buildModel('AAAA', 'K7Q2');
  const ctx = makeCtx();
  model.symbolImg = { tag: 'symbol' };
  model.baseImg = { tag: 'base' };
  model.summary = '甲'.repeat(shareCard.SUMMARY_MAX);

  shareCard.drawCard(ctx, model);

  const summaryRuns = textsOf(ctx).filter((t) => /^甲+…?$/.test(t));
  assert.ok(summaryRuns.length <= 2, `概述最多两行，实际 ${summaryRuns.length}`);
  assert.ok(textsOf(ctx).includes(model.note), '免责仍须常驻');
});

test('saveToAlbum：合成 → 导出 → 存相册成功返回 ok', async () => {
  const modelOwner = {};
  const node = {
    width: 0,
    height: 0,
    getContext: () => makeCtx(),
    createImage() {
      const img = { onload: null, onerror: null };
      let src = '';
      Object.defineProperty(img, 'src', {
        set(value) {
          src = value;
          modelOwner.srcs.push(value);
          setTimeout(() => img.onload && img.onload(), 0);
        },
        get: () => src,
      });
      return img;
    },
  };
  modelOwner.srcs = [];

  const host = {
    createSelectorQuery: () => {
      const q = { exec: (cb) => cb([{ node, width: 750, height: 750 }]) };
      q.select = () => q;
      q.fields = () => q;
      return q;
    },
  };

  const saved = [];
  global.tt = {
    canvasToTempFilePath: (opts) => {
      assert.strictEqual(opts.canvas, node);
      opts.success({ tempFilePath: '/tmp/share-card.png' });
    },
    saveImageToPhotosAlbum: (opts) => {
      saved.push(opts.filePath);
      opts.success({});
    },
  };

  const res = await shareCard.saveToAlbum({ host, canvasId: 'shareCardCanvas', archetypeCode: 'AAAA', pairCode: 'K7Q2' });
  delete global.tt;

  assert.deepStrictEqual(res, { ok: true, code: 'OK', msg: '' });
  assert.strictEqual(saved[0], '/tmp/share-card.png');
  assert.strictEqual(node.width, shareCard.CARD_PX, '画布须按 2× 尺寸设置');
  assert.strictEqual(node.height, shareCard.CARD_PX);
  assert.ok(modelOwner.srcs.length === 2, '符号与底组各装载一次');
});

test('saveToAlbum：无宿主 / 非法原型码 / 无平台 API 时一律 resolve 失败态', async () => {
  const noHost = await shareCard.saveToAlbum({ archetypeCode: 'AAAA' });
  assert.strictEqual(noHost.ok, false);
  assert.strictEqual(noHost.code, 'NO_HOST');

  const badCode = await shareCard.saveToAlbum({ host: { createSelectorQuery: () => ({}) }, archetypeCode: 'ZZZZ' });
  assert.strictEqual(badCode.ok, false);
  assert.strictEqual(badCode.code, 'CARD_DATA_INVALID');

  const noCanvas = await shareCard.saveToAlbum({
    host: { createSelectorQuery: () => { const q = { exec: (cb) => cb([{ node: null }]) }; q.select = () => q; q.fields = () => q; return q; } },
    canvasId: 'shareCardCanvas',
    archetypeCode: 'AAAA',
  });
  assert.strictEqual(noCanvas.ok, false);
  assert.strictEqual(noCanvas.code, 'NO_CANVAS');
});

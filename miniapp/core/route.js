'use strict';

/**
 * 落地路由解析
 *
 * 依据：本计划 §4.4-④（落地路由缺「受邀者尚无本人结果」分支）；《技术资产》§7（entry_source 落点）。
 *
 * 形态：**纯函数**。输入小程序启动 query 与「本地是否已有结果」，输出应进入的页面、
 * 需要挂起的配对码、落地来源。本模块不做任何存储读写——
 * 持久化「挂起的配对码」由页面调用 `session.setPendingPair()` 完成，职责不重叠。
 *
 * 分支（本计划 §4.4-④）：
 *   带合法 code + 本地有结果   → P-05（直接进入配对视图）
 *   带合法 code + 本地无结果   → P-02（先答题），并把 code 挂到 pendingPairCode
 *   无 code / code 非法        → P-01
 */

const {
  ENTRY_SOURCES,
  PAIR_CODE_LEN,
  AMBIGUOUS_CHARS,
  CODE_REJECT_REASONS,
} = require('../shared/client-constants.js');

/** 页面 ID 与 client-constants 的 PAGE_IDS 逐项一致（由 test/session.test.js 断言）。 */
const PAGES = {
  HOME: 'P-01',
  GUIDE: 'P-02',
  QUIZ: 'P-03',
  RESULT: 'P-04',
  PAIR: 'P-05',
  SHARE: 'P-06',
};

/**
 * scene 取值 → 落地来源。
 * 具体 k 值由平台侧决定，尚未复核（D-1），故仅覆盖已知几种，其余归 `direct`；
 * 若 query 显式带 `entry_source` 且命中枚举，则以显式值为准。
 */
const SCENE_TO_SOURCE = {
  pair: 'scene_pair',
  share: 'scene_share',
  short_video: 'scene_short_video',
  video: 'scene_short_video',
  douyin_task: 'douyin_task',
  task: 'douyin_task',
};

/** query 既支持对象（平台通常已解析），也支持原始 `a=1&b=2` 字符串（便于单测与兜底）。 */
function normalizeQuery(input) {
  if (!input) return {};
  if (typeof input === 'object') return input;
  if (typeof input !== 'string') return {};
  const out = {};
  for (const pair of input.replace(/^\?/, '').split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const key = eq === -1 ? pair : pair.slice(0, eq);
    const value = eq === -1 ? '' : pair.slice(eq + 1);
    if (!key) continue;
    try {
      out[decodeURIComponent(key)] = decodeURIComponent(value);
    } catch (err) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * 客户端侧配对码检查。
 * 按用户决策「明确拒绝」：只做 `trim + toUpperCase + 去空白与连字符`，
 * **不做** O→0 / I→1 一类模糊映射；含歧义字符直接拒绝。
 * 前端拿不到 ALPHABET（隔离门禁黑名单），故此处只用 PAIR_CODE_LEN 与 AMBIGUOUS_CHARS 判定长度与易混字符。
 *
 * @returns {null|{ok:true, code:string}|{ok:false, reason:string, chars?:string}}
 */
function checkPairCode(raw) {
  if (raw === undefined || raw === null) return null;
  const cleaned = String(raw).trim().toUpperCase().replace(/[\s-]/g, '');
  if (!cleaned) return { ok: false, reason: CODE_REJECT_REASONS[0] }; // 'EMPTY'

  const ambiguous = [...cleaned].filter((ch) => AMBIGUOUS_CHARS.includes(ch));
  if (ambiguous.length > 0) {
    return { ok: false, reason: 'AMBIGUOUS_CHARS', chars: [...new Set(ambiguous)].join('') };
  }
  if (cleaned.length !== PAIR_CODE_LEN) return { ok: false, reason: 'INVALID_CODE' };
  if (!/^[A-Z0-9]+$/.test(cleaned)) return { ok: false, reason: 'INVALID_CODE' };
  return { ok: true, code: cleaned };
}

/** 解析落地来源，保证返回值恒在 ENTRY_SOURCES 枚举内。 */
function resolveEntrySource(query, scene) {
  const explicit = query.entry_source;
  if (explicit && ENTRY_SOURCES.includes(explicit)) return explicit;
  if (scene && SCENE_TO_SOURCE[scene]) return SCENE_TO_SOURCE[scene];
  return 'direct';
}

/**
 * @param {object} input
 * @param {object|string} [input.query] 启动参数
 * @param {boolean} [input.hasResult] 本地是否已有本人结果缓存
 * @returns {{page:string, params:object, pendingPairCode:string|null, entrySource:string, code:object|null}}
 */
function resolveEntry(input) {
  const source = input || {};
  const query = normalizeQuery(source.query);
  const hasResult = source.hasResult === true;
  const scene = typeof query.scene === 'string' ? query.scene : '';
  const codeCheck = checkPairCode(query.code);

  let entrySource = resolveEntrySource(query, scene);

  // 无 code，或 code 形态非法 → 首页（非法码不挂起，交由用户重新输入）
  if (!codeCheck || !codeCheck.ok) {
    return {
      page: PAGES.HOME,
      params: {},
      pendingPairCode: null,
      entrySource,
      code: codeCheck,
    };
  }

  // 带合法配对码的链接即分享落地，除非 query 已显式声明来源
  if (entrySource === 'direct') entrySource = 'scene_pair';

  if (hasResult) {
    return {
      page: PAGES.PAIR,
      params: { pair_code: codeCheck.code },
      pendingPairCode: null,
      entrySource,
      code: codeCheck,
    };
  }

  // 受邀者本人尚无结果：先进引导页答题，配对码挂起，待 computeResult 成功后由页面取出并进 P-05
  return {
    page: PAGES.GUIDE,
    params: { pair_code: codeCheck.code },
    pendingPairCode: codeCheck.code,
    entrySource,
    code: codeCheck,
  };
}

module.exports = {
  PAGES,
  SCENE_TO_SOURCE,
  normalizeQuery,
  checkPairCode,
  resolveEntrySource,
  resolveEntry,
};

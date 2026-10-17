/**
 * 抖音云函数服务产物：acceptInvite.js
 *
 * **构建期生成，禁止手改**。源：server/lib/codes.js / server/lib/envelope.js / server/lib/errors.js / server/lib/handlers.js / server/lib/pairing.js / server/lib/scoring.js / server/lib/similarity.js / server/lib/store-cloud.js / server/lib/store-provider.js / server/lib/store.js / shared/constants.js / server/functions/acceptInvite/index.js
 * 改完源后重跑 `node tools/gen-cloud-functions.js`（生成脚本：tools/gen-cloud-functions.js）。
 *
 * 平台契约（已与线上函数服务核对）：入口 `module.exports = async function (params)`，
 * `params` 即 HTTP 请求体本身，返回值作为 Response Body（平台序列化为 JSON 信封）；
 * 调用路径 = 文件名，即 `/acceptInvite`。
 */
'use strict';

(function () {
  var __registry = {};
  var __cache = {};

  /** 内部模块解析：命中注册表用打包实现，未命中回落 Node 内置（如 crypto）。 */
  function __req(id) {
    if (!Object.prototype.hasOwnProperty.call(__registry, id)) return require(id);
    if (!__cache[id]) {
      var m = { exports: {} };
      __registry[id](m, m.exports, __req);
      __cache[id] = m.exports;
    }
    return __cache[id];
  }

  // ── server/lib/codes.js
  __registry["server/lib/codes.js"] = function (module, exports, require) {
'use strict';

/**
 * 配对码：生成 / 归一化 / 展示分组
 *
 * 依据：《技术资产》§3.5 + 本计划 §4.4-⑤（用户决策：**明确拒绝**，不做模糊归一化）。
 *
 * 字母表 `ALPHABET` 已去除易混字符 I / L / O / 0 / 1。
 * 实测 `ALPHABET.length === 31`，故码空间为 31^8 ≈ 8.5e11
 * （《技术资产》§3.5 注释写作 32^8 ≈ 1.1e12，底数有误，此处以 ALPHABET.length 计算）。
 */

const crypto = require('crypto');
const {
  ALPHABET,
  CODE_LEN,
  CODE_RETRY_LIMIT,
  CODE_REJECT_REASONS,
} = __req('shared/constants.js');
const { raise } = __req('server/lib/errors.js');

/** 从字母表中反推「不在表内」的易混字符，供输入校验复用（与生成器同一套逻辑）。 */
const AMBIGUOUS_CHARS = ['I', 'L', 'O', '0', '1'].filter((ch) => !ALPHABET.includes(ch)).join('');

/** 码空间大小：31^8 ≈ 8.5e11。 */
const CODE_SPACE = ALPHABET.length ** CODE_LEN;

/**
 * 生成一个 8 位配对码。
 * @param {(max:number)=>number} [randomInt] 随机整数源，默认 crypto.randomInt；测试可注入固定序列
 * @returns {string}
 */
function generatePairCode(randomInt = crypto.randomInt) {
  let out = '';
  for (let i = 0; i < CODE_LEN; i++) {
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  return out;
}

/**
 * 归一化用户输入的配对码。
 *
 * 策略（用户已决策）：只做 `trim + toUpperCase + 去空白与连字符`，随后**严格校验**。
 * 含 I / L / O / 0 / 1 等易混字符 → 明确拒绝（AMBIGUOUS_CHARS），不做 O→0、I→1 类模糊映射，
 * 因为 `1` 与 `0` 同时可能源自 `I` 与 `O`，模糊映射不唯一。
 *
 * @param {unknown} input
 * @returns {{ok:true, reason:null, value:string}
 *         | {ok:false, reason:'EMPTY'|'AMBIGUOUS_CHARS'|'INVALID_CODE', value:null, char?:string}}
 */
function normalizePairCode(input) {
  if (typeof input !== 'string') {
    return { ok: false, reason: CODE_REJECT_REASONS[0], value: null };
  }
  const compact = input.replace(/[\s-]/g, '').toUpperCase();
  if (compact === '') {
    return { ok: false, reason: 'EMPTY', value: null };
  }

  for (const ch of compact) {
    if (AMBIGUOUS_CHARS.includes(ch)) {
      return { ok: false, reason: 'AMBIGUOUS_CHARS', value: null, char: ch };
    }
  }
  if (compact.length !== CODE_LEN) {
    return { ok: false, reason: 'INVALID_CODE', value: null };
  }
  for (const ch of compact) {
    if (!ALPHABET.includes(ch)) {
      return { ok: false, reason: 'INVALID_CODE', value: null, char: ch };
    }
  }
  return { ok: true, reason: null, value: compact };
}

/**
 * 展示分组：存储与传输不带分隔符，仅展示时按 4-4 分组。
 * @param {string} code 8 位配对码（不带分隔符）
 * @returns {string} 如 'K7QX-2M9T'
 */
function formatPairCode(code) {
  if (typeof code !== 'string' || code.length !== CODE_LEN) {
    throw raise.ANSWER_INVALID(`配对码应为 ${CODE_LEN} 位，实际 ${String(code)}`);
  }
  const half = CODE_LEN / 2;
  return `${code.slice(0, half)}-${code.slice(half)}`;
}

/**
 * 生成一个在 `exists` 判定下未被占用的配对码。
 * 冲突重试上限 `CODE_RETRY_LIMIT`，超出即抛出 SERVER_ERROR（应由运维介入排查）。
 *
 * `exists` 可同步（内存 store 查 map）或异步（云库查 `_id`）；统一 `await`，
 * 两种 store 共用同一套生成逻辑。
 *
 * @param {(code:string)=>boolean|Promise<boolean>} exists 唯一性判定（通常查 pair_code 唯一索引）
 * @param {(max:number)=>number} [randomInt]
 * @returns {Promise<string>}
 */
async function generateUniquePairCode(exists, randomInt = crypto.randomInt) {
  for (let attempt = 0; attempt < CODE_RETRY_LIMIT; attempt++) {
    const code = generatePairCode(randomInt);
    if (!(await exists(code))) return code;
  }
  throw raise.SERVER_ERROR(`配对码生成连续 ${CODE_RETRY_LIMIT} 次冲突`);
}

module.exports = {
  AMBIGUOUS_CHARS,
  CODE_SPACE,
  generatePairCode,
  generateUniquePairCode,
  normalizePairCode,
  formatPairCode,
};
  };

  // ── server/lib/envelope.js
  __registry["server/lib/envelope.js"] = function (module, exports, require) {
'use strict';

/**
 * 通用响应信封（《技术资产》§6）
 *   { code: 0, msg: 'ok', data: {} }   // code === 0 为成功，非 0 见错误码表
 */

const { ERROR_CODES, ERROR_NAMES } = __req('shared/constants.js');
const { DomainError } = __req('server/lib/errors.js');

/** 成功信封。 */
function ok(data) {
  return { code: ERROR_CODES.OK, msg: 'ok', data: data === undefined ? {} : data };
}

/**
 * 失败信封。
 * @param {number} code 数值错误码
 * @param {string} [detail] 用于日志的附加说明；不面向用户
 * @param {object} [meta] 结构化附加信息，挂到 data 上供前端分支
 */
function fail(code, detail, meta) {
  const name = ERROR_NAMES[code] || 'UNKNOWN_ERROR';
  return {
    code,
    msg: detail ? `${name}: ${detail}` : name,
    data: meta === undefined ? null : meta,
  };
}

/**
 * 把任意异常收敛成失败信封。
 * 非 DomainError 一律归为 SERVER_ERROR（3001），避免把内部细节泄漏给前端。
 */
function fromError(err) {
  if (err instanceof DomainError) return fail(err.code, err.detail, err.meta);
  return fail(ERROR_CODES.SERVER_ERROR, err && err.message ? String(err.message) : undefined);
}

/** 判断信封是否成功。 */
function isOk(envelope) {
  return !!envelope && envelope.code === ERROR_CODES.OK;
}

module.exports = { ok, fail, fromError, isOk };
  };

  // ── server/lib/errors.js
  __registry["server/lib/errors.js"] = function (module, exports, require) {
'use strict';

/**
 * 领域错误
 *
 * 把常量表中的错误码包成 Error 子类，使抛错点与错误码表解耦：
 * 计算层只抛 `ANSWER_INCOMPLETE`，由 envelope.js 统一映射成响应信封。
 * `message` 保持为错误码语义名（与《技术资产》§3.1 伪代码的 `throw new Error('ANSWER_INCOMPLETE')` 一致），
 * 同时在 `err.code` 上挂数值码，供接口层使用。
 */

const { ERROR_CODES, ERROR_NAMES } = __req('shared/constants.js');

class DomainError extends Error {
  /**
   * @param {number} code 数值错误码（见 ERROR_CODES）
   * @param {string} [detail] 附加说明，用于日志定位，不面向用户
   * @param {object} [meta] 附加结构化信息（如拒绝原因），供前端分支使用
   */
  constructor(code, detail, meta) {
    const name = ERROR_NAMES[code] || 'UNKNOWN_ERROR';
    super(detail ? `${name}: ${detail}` : name);
    this.name = 'DomainError';
    this.code = code;
    this.codeName = name;
    this.detail = detail === undefined ? null : detail;
    this.meta = meta === undefined ? null : meta;
  }
}

/** 按语义名构造错误的快捷入口，避免各处硬编码数值码。 */
const raise = Object.fromEntries(
  Object.entries(ERROR_CODES).map(([name, code]) => [
    name,
    (detail, meta) => new DomainError(code, detail, meta),
  ])
);

module.exports = { DomainError, raise };
  };

  // ── server/lib/handlers.js
  __registry["server/lib/handlers.js"] = function (module, exports, require) {
'use strict';

/**
 * 接口层 —— 6 个 handler
 *
 * 每个 handler 形态为 `(params, deps) => envelope`，其中：
 *   - `deps` = `{ store, now?, randomInt? }`，全部由调用方注入（云函数入口 / 单测）
 *   - 返回统一的 `{ code, msg, data }` 信封（envelope.js）
 *   - 业务异常一律经 `fromError` 收敛，非 DomainError 归为 SERVER_ERROR(3001)，不外泄内部细节
 *
 * 对应《技术资产》§6 接口契约：computeResult / createInvite / acceptInvite /
 * getPairStatus / completePair / reportEvents。
 *
 * 关键约束（§1.2 单一权威实现）：
 *   computeResult 是唯一的计分入口。completePair **不接收答案**，只读双方已落库的 archetype_code，
 *   因此不存在第二个计分入口。
 */

const {
  QUIZ_VERSION,
  ARCHETYPES,
  EVENTS,
  EVENT_COMMON_FIELDS,
  PAGE_IDS,
  ERROR_CODES,
} = __req('shared/constants.js');
const { ok, fromError } = __req('server/lib/envelope.js');
const { raise } = __req('server/lib/errors.js');
const { scoreArchetype } = __req('server/lib/scoring.js');
const pairing = __req('server/lib/pairing.js');

/** 把业务函数包成「永不抛错」的信封函数（业务函数可为异步，统一 await）。 */
function withEnvelope(fn) {
  return async (params, deps) => {
    try {
      return ok(await fn(params || {}, deps || {}));
    } catch (err) {
      return fromError(err);
    }
  };
}

function requireStore(deps) {
  if (!deps.store) throw raise.SERVER_ERROR('缺少 store 依赖');
  return deps.store;
}

/** 组装 pairing 模块所需的上下文。 */
function pairingCtx(deps) {
  return {
    store: requireStore(deps),
    now: deps.now || Date.now,
    randomInt: deps.randomInt,
  };
}

// ─────────────────────────────────────────────────────────────
// 1. computeResult —— 唯一的计分入口
// ─────────────────────────────────────────────────────────────

/**
 * 入参：`{ session_id, user_pseudo_id, quiz_version, answers }`
 * 出参：`{ session_id, archetype_code, archetype_id, quiz_version, computed_at, cached }`
 *
 * 幂等：以 `session_id` 为幂等键。同一 session_id 重复提交一律返回首次结果，
 * 既防重复计分，也防用户来回改选后产生两个结果。
 * 隐私：**不落库原始答案**，只落库结果（archetype_code / archetype_id）。
 */
const computeResult = withEnvelope(async (params, deps) => {
  const store = requireStore(deps);
  const sessionId = params.session_id;
  const userId = params.user_pseudo_id;

  if (!sessionId || typeof sessionId !== 'string') throw raise.ANSWER_INCOMPLETE('缺少 session_id');
  if (!userId) throw raise.ANSWER_INVALID('缺少 user_pseudo_id');
  if (params.quiz_version !== QUIZ_VERSION) {
    throw raise.QUIZ_VERSION_MISMATCH(`客户端 ${params.quiz_version}，服务端 ${QUIZ_VERSION}`);
  }

  const existing = await store.getSession(sessionId);
  if (existing) {
    return {
      session_id: sessionId,
      archetype_code: existing.archetype_code,
      archetype_id: existing.archetype_id,
      quiz_version: existing.quiz_version,
      computed_at: existing.ts,
      cached: true,
    };
  }

  // 计分：可能抛 ANSWER_INCOMPLETE(1001) / ANSWER_INVALID(1002)
  const code = scoreArchetype(params.answers);
  const record = await store.insertSession({
    session_id: sessionId,
    user_pseudo_id: userId,
    quiz_version: QUIZ_VERSION,
    archetype_code: code,
    archetype_id: ARCHETYPES[code].id,
    ts: (deps.now || Date.now)(),
  });

  return {
    session_id: sessionId,
    archetype_code: record.archetype_code,
    archetype_id: record.archetype_id,
    quiz_version: record.quiz_version,
    computed_at: record.ts,
    cached: false,
  };
});

// ─────────────────────────────────────────────────────────────
// 2. createInvite
// ─────────────────────────────────────────────────────────────

/**
 * 入参：`{ user_pseudo_id, archetype_code? }`
 * 出参：`{ pair_code, formatted_pair_code, expires_at }`
 *
 * `archetype_code` 可省：省略时从该用户最近一次落库结果读取，
 * 避免前端把结果再回传一次造成第二处结果来源。
 */
const createInvite = withEnvelope(async (params, deps) => {
  const store = requireStore(deps);
  const userId = params.user_pseudo_id;
  if (!userId) throw raise.ANSWER_INVALID('缺少 user_pseudo_id');

  let code = params.archetype_code;
  if (!code) {
    const session = await store.findLatestSessionByUser(userId);
    if (!session) throw raise.ANSWER_INCOMPLETE('该用户尚未完成测试，无法发起配对');
    code = session.archetype_code;
  }
  return pairing.createInvite(pairingCtx(deps), { user_pseudo_id: userId, archetype_code: code });
});

// ─────────────────────────────────────────────────────────────
// 3. acceptInvite
// ─────────────────────────────────────────────────────────────

/**
 * 入参：`{ pair_code, user_pseudo_id }`
 * 出参：pending / completed 视图（含 initiator_code、expires_at、isFirstAccept）
 */
const acceptInvite = withEnvelope((params, deps) =>
  pairing.acceptInvite(pairingCtx(deps), {
    pair_code: params.pair_code,
    user_pseudo_id: params.user_pseudo_id,
  })
);

// ─────────────────────────────────────────────────────────────
// 4. getPairStatus
// ─────────────────────────────────────────────────────────────

/**
 * 入参：`{ pair_code, attempt? }`
 * 出参：pending（含 retry_after_ms）/ completed（含 c_count、similarity_pct、band_label）
 */
const getPairStatus = withEnvelope((params, deps) =>
  pairing.getPairStatus(pairingCtx(deps), {
    pair_code: params.pair_code,
    attempt: params.attempt,
  })
);

// ─────────────────────────────────────────────────────────────
// 5. completePair
// ─────────────────────────────────────────────────────────────

/**
 * 入参：`{ pair_code, user_pseudo_id }` —— **不含答案**
 * 出参：completed（含 isFirstCompletion）/ pending（ready:false，等待对方完成）
 */
const completePair = withEnvelope((params, deps) =>
  pairing.completePair(pairingCtx(deps), {
    pair_code: params.pair_code,
    user_pseudo_id: params.user_pseudo_id,
  })
);

// ─────────────────────────────────────────────────────────────
// 6. reportEvents
// ─────────────────────────────────────────────────────────────

/** 单条埋点的合法性与必填字段校验。返回 null 表示通过，否则返回原因。 */
function validateEvent(event) {
  if (!event || typeof event !== 'object') return 'NOT_OBJECT';
  if (!EVENTS.includes(event.event_name)) return 'UNKNOWN_EVENT';

  for (const field of EVENT_COMMON_FIELDS) {
    const value = event[field];
    if (value === undefined || value === null) return `MISSING_FIELD:${field}`;
  }
  if (typeof event.ts !== 'number' || !Number.isFinite(event.ts)) return 'INVALID_TS';
  if (typeof event.network !== 'string') return 'INVALID_NETWORK';

  // page_view 必须带合法 page_id —— P-06 按独立页面计，缺 P-06 即为漏报
  if (event.event_name === 'page_view' && !PAGE_IDS.includes(event.page_id)) {
    return 'INVALID_PAGE_ID';
  }
  return null;
}

/**
 * 入参：`{ events: [...] }`
 * 出参：`{ accepted_count, duplicated_count, rejected_count, accepted_ids, duplicated_ids, rejected }`
 *
 * 服务端按 `event_id` 去重：客户端批量队列重试重放时，同一条事件不会被重复计数。
 * 非法事件逐条拒绝并给出原因，不因个别非法条目丢弃整批。
 */
const reportEvents = withEnvelope(async (params, deps) => {
  const store = requireStore(deps);
  if (!Array.isArray(params.events)) throw raise.ANSWER_INVALID('events 必须为数组');

  const acceptedIds = [];
  const duplicatedIds = [];
  const rejected = [];

  for (const event of params.events) {
    const reason = validateEvent(event);
    if (reason) {
      rejected.push({ event_id: (event && event.event_id) || null, reason });
      continue;
    }
    if (await store.seenEvent(event.event_id)) {
      duplicatedIds.push(event.event_id);
      continue;
    }
    await store.appendEvent(event);
    acceptedIds.push(event.event_id);
  }

  return {
    accepted_count: acceptedIds.length,
    duplicated_count: duplicatedIds.length,
    rejected_count: rejected.length,
    accepted_ids: acceptedIds,
    duplicated_ids: duplicatedIds,
    rejected,
  };
});

const handlers = {
  computeResult,
  createInvite,
  acceptInvite,
  getPairStatus,
  completePair,
  reportEvents,
};

module.exports = { ...handlers, handlers, validateEvent, ERROR_CODES };
  };

  // ── server/lib/pairing.js
  __registry["server/lib/pairing.js"] = function (module, exports, require) {
'use strict';

/**
 * 好友配对状态机
 *
 * 依据：《技术资产》§3.3 迁移表 + 本计划 §4.4-③ 补的两条迁移行。
 *
 * 迁移表（状态 × 动作）：
 *   1  (无记录)            + createInvite   → 创建 pending
 *   2  pending, invitee=null + acceptInvite → 写 invitee_id，保持 pending
 *   3  pending, invitee=self + acceptInvite → 幂等，保持 pending（重复接受）
 *   4  pending, invitee=other + acceptInvite → 拒绝 PAIR_ALREADY_TAKEN(2004)   ← 补
 *   5  pending, now > expires_at → 惰性判定为 expired，后续动作一律 PAIR_EXPIRED(2002)
 *   6  pending, invitee=null + completePair（受邀者未显式 accept 直接完成）→ 写 invitee_id   ← 补
 *   7  pending, 双方 code 齐备 + completePair → completed（写 c_count / 百分比 / 标签 / completed_at）
 *   8  pending, 双方 code 未齐备 + completePair → 保持 pending，返回 ready:false（不报错，供前端继续等待）
 *   9  completed + completePair → 幂等，返回首次结果，不重算、不重复上报
 *  10  expired + 任意动作 → 拒绝（expired 记录不可复用，须重新发起）
 *
 * 约定：
 *   - 过期判定一律以**服务端时间**（注入的 `ctx.now`）为准，不接受客户端传入时间。
 *   - `completePair` 入参不含答案，只读双方**已落库**的 `archetype_code`（守住 §1.2 单一权威实现）。
 *   - 自配对默认关闭（`ALLOW_SELF_PAIR = false`），命中抛 PAIR_SELF_NOT_ALLOWED(2003)。
 */

const {
  ARCHETYPES,
  ALLOW_SELF_PAIR,
  DIM_ORDER,
  SESSION_TTL_MS,
  POLL_BACKOFF_MS,
} = __req('shared/constants.js');
const { raise } = __req('server/lib/errors.js');
const { generateUniquePairCode, normalizePairCode, formatPairCode } = __req('server/lib/codes.js');
const { similarity, formatSimilarityPct } = __req('server/lib/similarity.js');

const PENDING = 'pending';
const COMPLETED = 'completed';
const EXPIRED = 'expired';

/** 校验原型码形态（复用常量表的 16 条白名单）。 */
function assertArchetypeCode(code, label) {
  if (typeof code !== 'string' || !ARCHETYPES[code]) {
    throw raise.ANSWER_INVALID(`${label} 非法原型码：${String(code)}`);
  }
}

/** 归一化配对码；不可用时统一抛 PAIR_CODE_NOT_FOUND，并把拒绝原因放进 meta。 */
function requireNormalizedCode(input) {
  const normalized = normalizePairCode(input);
  if (!normalized.ok) {
    throw raise.PAIR_CODE_NOT_FOUND(`配对码不可用：${normalized.reason}`, {
      reason: normalized.reason,
      char: normalized.char ?? null,
    });
  }
  return normalized.value;
}

/**
 * 读取配对记录并**先落盘**惰性过期。
 * 过期写入独立于后续业务事务：即便后续动作抛错，过期状态也应保留。
 */
async function loadRecord(ctx, pairCode) {
  const record = await ctx.store.getPairing(pairCode);
  if (!record) throw raise.PAIR_CODE_NOT_FOUND(`邀请不存在：${pairCode}`);
  if (record.status === PENDING && ctx.now() > record.expires_at) {
    return ctx.store.updatePairing({ ...record, status: EXPIRED });
  }
  return record;
}

/** 等待态轮询退避：3s → 6s → 12s → 30s（末项为上限）。 */
function nextPollDelay(attempt) {
  const index = Math.max(0, Math.min(Number(attempt) || 0, POLL_BACKOFF_MS.length - 1));
  return POLL_BACKOFF_MS[index];
}

/** pending 视图。 */
function pendingView(record, extra) {
  return {
    status: PENDING,
    pair_code: record.pair_code,
    formatted_pair_code: formatPairCode(record.pair_code),
    initiator_code: record.initiator_code,
    invitee_id: record.invitee_id,
    expires_at: record.expires_at,
    ready: false,
    ...extra,
  };
}

/**
 * 逐维对照明细（P-05 完成态的 4 条对照带）。
 *
 * 只回结构化字段，不回任何面向用户的中文——对外文案集中于文案源，
 * 前端按 `dim` 取 `ui('pair.dims.<dim>.*')` 渲染维度名与两端名（技术资产 §12）。
 *
 * @returns {Array<{dim:string, comp:boolean, a:string, b:string}>}
 *   dim  = 维度标识，顺序即服务端 DIM_ORDER（前端不得自行推导维度顺序）
 *   a/b  = 发起者 / 受邀者在该维度的端点（'A' / 'B'）
 *   comp = 两端是否互补（端点不同；相同即一致）
 */
function dimensionRows(initiatorCode, inviteeCode) {
  return DIM_ORDER.map((dim, index) => {
    const a = String(initiatorCode || '')[index] || '';
    const b = String(inviteeCode || '')[index] || '';
    return { dim, comp: a !== b, a, b };
  });
}

/** completed 视图。 */
function completedView(record, isFirstCompletion) {
  return {
    status: COMPLETED,
    pair_code: record.pair_code,
    formatted_pair_code: formatPairCode(record.pair_code),
    initiator_code: record.initiator_code,
    invitee_code: record.invitee_code,
    c_count: record.c_count,
    p_count: 4 - record.c_count,
    similarity_pct: record.similarity_pct,
    similarity_label: formatSimilarityPct(record.similarity_pct),
    band_label: record.band_label,
    dimensions: dimensionRows(record.initiator_code, record.invitee_code),
    completed_at: record.completed_at,
    ready: true,
    // 仅首次完成时为 true：前端与埋点据此决定是否上报 pair_complete
    isFirstCompletion,
  };
}

/**
 * 创建邀请（P-05 发起侧）。
 * @param {{store:object, now:()=>number, randomInt?:(max:number)=>number}} ctx
 * @param {{user_pseudo_id:string, archetype_code:string}} params
 */
async function createInvite(ctx, params) {
  const userId = params.user_pseudo_id;
  if (!userId) throw raise.ANSWER_INVALID('缺少 user_pseudo_id');
  assertArchetypeCode(params.archetype_code, '发起者结果');

  const ts = ctx.now();
  const pairCode = await generateUniquePairCode((code) => ctx.store.pairCodeExists(code), ctx.randomInt);

  const record = {
    pair_code: pairCode,
    initiator_id: userId,
    invitee_id: null,
    initiator_code: params.archetype_code,
    invitee_code: null,
    status: PENDING,
    c_count: null,
    similarity_pct: null,
    band_label: null,
    created_at: ts,
    expires_at: ts + SESSION_TTL_MS,
    completed_at: null,
  };
  await ctx.store.insertPairing(record);

  return {
    pair_code: pairCode,
    formatted_pair_code: formatPairCode(pairCode),
    expires_at: record.expires_at,
  };
}

/**
 * 接受邀请（受邀者进入 P-05）。
 * @param {object} ctx
 * @param {{pair_code:string, user_pseudo_id:string}} params
 */
async function acceptInvite(ctx, params) {
  const userId = params.user_pseudo_id;
  if (!userId) throw raise.ANSWER_INVALID('缺少 user_pseudo_id');
  const pairCode = requireNormalizedCode(params.pair_code);

  const record = await loadRecord(ctx, pairCode);

  if (record.status === EXPIRED) {
    throw raise.PAIR_EXPIRED('邀请已过期，可重新发起', { status: EXPIRED, pair_code: pairCode });
  }
  if (record.status === COMPLETED) {
    return { ...completedView(record, false), isFirstAccept: false };
  }
  if (!ALLOW_SELF_PAIR && record.initiator_id === userId) {
    throw raise.PAIR_SELF_NOT_ALLOWED('不能与自己配对');
  }
  if (record.invitee_id !== null && record.invitee_id !== userId) {
    throw raise.PAIR_ALREADY_TAKEN('该邀请已被他人接受', { pair_code: pairCode });
  }

  // 首次接受用条件更新（CAS）落位，避免多实例并发下两个受邀者同时写入
  const isFirstAccept = record.invitee_id === null;
  let updated = record;
  if (isFirstAccept) {
    const won = await ctx.store.claimInvitee(pairCode, userId);
    if (!won) throw raise.PAIR_ALREADY_TAKEN('该邀请已被他人接受', { pair_code: pairCode });
    updated = { ...record, invitee_id: userId };
  }

  return { ...pendingView(updated, {}), isFirstAccept };
}

/**
 * 查询配对状态（发起者轮询）。
 * @param {object} ctx
 * @param {{pair_code:string, attempt?:number}} params
 */
async function getPairStatus(ctx, params) {
  const pairCode = requireNormalizedCode(params.pair_code);
  const record = await loadRecord(ctx, pairCode);

  if (record.status === EXPIRED) {
    throw raise.PAIR_EXPIRED('邀请已过期，可重新发起', { status: EXPIRED, pair_code: pairCode });
  }
  if (record.status === COMPLETED) {
    return completedView(record, false);
  }
  return pendingView(record, {
    has_invitee: record.invitee_id !== null,
    retry_after_ms: nextPollDelay(params.attempt),
  });
}

/**
 * 完成配对（受邀者完成本人测试后调用；也可由发起者触发收口）。
 *
 * 入参**不含答案**：双方 code 均从已落库记录读取（发起者 code 取自创建时的快照，
 * 受邀者 code 取自 sessions 集合中该用户最近一次落库结果）。因此本函数不构成第二计分入口。
 *
 * @param {object} ctx
 * @param {{pair_code:string, user_pseudo_id:string}} params
 */
async function completePair(ctx, params) {
  const userId = params.user_pseudo_id;
  if (!userId) throw raise.ANSWER_INVALID('缺少 user_pseudo_id');
  const pairCode = requireNormalizedCode(params.pair_code);

  const record = await loadRecord(ctx, pairCode);

  if (record.status === EXPIRED) {
    throw raise.PAIR_EXPIRED('邀请已过期，可重新发起', { status: EXPIRED, pair_code: pairCode });
  }
  // 幂等：已完成则直接返回首次结果，不重算、不上报
  if (record.status === COMPLETED) {
    return completedView(record, false);
  }

  const isParty =
    userId === record.initiator_id || userId === record.invitee_id || record.invitee_id === null;
  if (!isParty) {
    throw raise.PAIR_CODE_NOT_FOUND(`调用者既非发起者也非受邀者：${pairCode}`);
  }
  if (!ALLOW_SELF_PAIR && record.initiator_id === userId && record.invitee_id === null) {
    throw raise.PAIR_SELF_NOT_ALLOWED('不能与自己配对');
  }

  // 受邀者未显式 accept 即直接完成的情形：此处补齐 invitee_id（迁移表第 6 行）
  const inviteeId = record.invitee_id === null ? userId : record.invitee_id;
  const inviterCode = record.initiator_code;
  const inviteeSession = await ctx.store.findLatestSessionByUser(inviteeId);
  const inviteeCode = inviteeSession ? inviteeSession.archetype_code : null;

  // 云库无跨文档事务，transaction 为「顺序执行、不回滚」；幂等由上方 COMPLETED 分支与 CAS 保证
  return ctx.store.transaction(async (store) => {
    // 先落定受邀者归属（即使结果未齐备也要占位，避免并发被他人顶替）
    let current = record;
    if (current.invitee_id === null) {
      current = await store.updatePairing({ ...current, invitee_id: inviteeId });
    }

    // 双方结果未齐备：不报错，返回 pending 供前端继续等待（迁移表第 8 行）
    if (!inviterCode || !inviteeCode) {
      return pendingView(current, { has_invitee: true, retry_after_ms: nextPollDelay(0) });
    }

    // §3.3：同一对好友已有完成的同码配对 → 直接复用，不重复计算
    const existing = await store.findActivePairingByPair(current.initiator_id, inviteeId);
    const canReuse =
      existing &&
      existing.pair_code !== current.pair_code &&
      existing.status === COMPLETED &&
      existing.initiator_code === inviterCode &&
      existing.invitee_code === inviteeCode;

    const metrics = canReuse
      ? { c: existing.c_count, pct: existing.similarity_pct, band: existing.band_label }
      : (() => {
          const s = similarity(inviterCode, inviteeCode);
          return { c: s.c, pct: s.similarityPct, band: s.band };
        })();

    const updated = await store.updatePairing({
      ...current,
      invitee_code: inviteeCode,
      status: COMPLETED,
      c_count: metrics.c,
      similarity_pct: metrics.pct,
      band_label: metrics.band,
      completed_at: ctx.now(),
    });

    return completedView(updated, true);
  });
}

module.exports = {
  PENDING,
  COMPLETED,
  EXPIRED,
  createInvite,
  acceptInvite,
  getPairStatus,
  completePair,
  nextPollDelay,
  pendingView,
  completedView,
  loadRecord,
};
  };

  // ── server/lib/scoring.js
  __registry["server/lib/scoring.js"] = function (module, exports, require) {
'use strict';

/**
 * 计分与原型映射 —— **服务端唯一实现**
 *
 * 依据：《技术资产-研发侧技术方案预研.md》§3.1；《文案资产-10题题库与计分表.md》§1.2 / §1.3。
 *
 * 该函数不得在前端存在实现副本（技术资产 §1.2「单一权威实现」）；
 * 由 `tools/check-client-isolation.js` 自动拦截。
 */

const {
  DIM_QUESTIONS,
  DIM_ORDER,
  REQUIRED_ANSWER_COUNT,
  ARCHETYPES,
} = __req('shared/constants.js');
const { raise } = __req('server/lib/errors.js');

/** 合法的选项取值。 */
const OPTION_VALUES = ['A', 'B'];

/**
 * 由 10 题答案计算 4 位原型码。
 *
 * 规则：每题二选一，被选中的选项为其所属维度的对应端点 +1（权重恒为 1）；
 * 取各维度得分较高的一端为主导端；两端同分时取 A 端（PRD 3.5 全局唯一规则）。
 *
 * @param {Record<string, 'A'|'B'>} answers Map<题号, 'A'|'B'>，必须覆盖全部 10 题
 * @returns {string} 4 位原型码，如 'ABAB'
 * @throws {DomainError} ANSWER_INCOMPLETE（答案不完整）/ ANSWER_INVALID（选项非法）
 */
function scoreArchetype(answers) {
  if (answers === null || typeof answers !== 'object') {
    throw raise.ANSWER_INVALID('answers 必须为对象');
  }
  if (Object.keys(answers).length !== REQUIRED_ANSWER_COUNT) {
    throw raise.ANSWER_INCOMPLETE(
      `需要 ${REQUIRED_ANSWER_COUNT} 题，实际 ${Object.keys(answers).length} 题`
    );
  }

  return DIM_ORDER.map((dim) => {
    let a = 0;
    let b = 0;
    for (const q of DIM_QUESTIONS[dim]) {
      const value = answers[q];
      if (!OPTION_VALUES.includes(value)) {
        throw raise.ANSWER_INVALID(`题号 ${q} 的取值非法：${String(value)}`);
      }
      if (value === 'A') a++;
      else b++;
    }
    // 同分取 A 端：a >= b 已覆盖 a === b 的情形
    return a >= b ? 'A' : 'B';
  }).join('');
}

/**
 * 原型码 → 原型展示信息。
 * @param {string} code 4 位原型码
 * @returns {{code:string, id:string, name:string, symbolId:string}}
 * @throws {DomainError} ANSWER_INVALID（原型码非法）
 */
function resolveArchetype(code) {
  const entry = ARCHETYPES[code];
  if (!entry) throw raise.ANSWER_INVALID(`非法原型码：${String(code)}`);
  return { code, id: entry.id, name: entry.name, symbolId: entry.symbolId };
}

/**
 * 逐维度得分明细，用于自检与排查（不参与对外结果）。
 * @param {Record<string, 'A'|'B'>} answers
 * @returns {Array<{dim:string, a:number, b:number, lead:'A'|'B', tied:boolean}>}
 */
function scoreBreakdown(answers) {
  return DIM_ORDER.map((dim) => {
    let a = 0;
    let b = 0;
    for (const q of DIM_QUESTIONS[dim]) {
      if (answers[q] === 'A') a++;
      else b++;
    }
    return { dim, a, b, lead: a >= b ? 'A' : 'B', tied: a === b };
  });
}

module.exports = { scoreArchetype, resolveArchetype, scoreBreakdown, OPTION_VALUES };
  };

  // ── server/lib/similarity.js
  __registry["server/lib/similarity.js"] = function (module, exports, require) {
'use strict';

/**
 * 同频度计算 —— **服务端唯一实现**
 *
 * 依据：《技术资产》§3.2；PRD 3.5；《文案资产-5档相处模式解读.md》。
 *
 * 约束：
 *   - 展示值保留 1 位小数（11/12 = 91.666…% → 91.7%，8/12 = 66.666…% → 66.7%）
 *   - 标签**只由 C 决定**，百分比不得用于标签判定，也不得用于排序或优劣展示
 *   - 同频度计算不得在前端存在实现副本，由 `tools/check-client-isolation.js` 自动拦截
 */

const { W_SAME, W_COMP, FULL, BAND_BY_C } = __req('shared/constants.js');
const { raise } = __req('server/lib/errors.js');

const CODE_LENGTH = 4;
const VALID_ENDPOINTS = ['A', 'B'];

/** 校验原型码形态：长度 4 且每位为 A 或 B。 */
function assertCode(code, label) {
  if (typeof code !== 'string' || code.length !== CODE_LENGTH) {
    throw raise.ANSWER_INVALID(`CODE_INVALID: ${label} 应为 ${CODE_LENGTH} 位原型码，实际 ${String(code)}`);
  }
  for (const ch of code) {
    if (!VALID_ENDPOINTS.includes(ch)) {
      throw raise.ANSWER_INVALID(`CODE_INVALID: ${label} 含非法端点 ${ch}`);
    }
  }
}

/**
 * 双方原型码 → 同频度。
 *
 * @param {string} codeA 4 位原型码
 * @param {string} codeB 4 位原型码
 * @returns {{c:number, p:number, similarityPct:number, band:string, bandIndex:number}}
 *   c 一致项数、p 互补项数（恒有 c + p = 4）、similarityPct 展示值（1 位小数）、band 相处模式标签
 * @throws {DomainError} ANSWER_INVALID（原型码非法，语义名 CODE_INVALID）
 */
function similarity(codeA, codeB) {
  assertCode(codeA, 'codeA');
  assertCode(codeB, 'codeB');

  let c = 0;
  for (let i = 0; i < CODE_LENGTH; i++) {
    if (codeA[i] === codeB[i]) c++;
  }
  const p = CODE_LENGTH - c; // 恒有 C + P = 4
  const raw = ((c * W_SAME + p * W_COMP) / FULL) * 100;

  return {
    c,
    p,
    similarityPct: Math.round(raw * 10) / 10, // 保留 1 位小数
    band: BAND_BY_C[c], // 标签按 C 判定，不按百分比排名
    bandIndex: c,
  };
}

/**
 * 展示值格式化：保留 1 位小数并去掉无意义的尾零。
 * 例：100 → '100%'，91.7 → '91.7%'，75 → '75%'，66.7 → '66.7%'
 * @param {number} pct
 * @returns {string}
 */
function formatSimilarityPct(pct) {
  if (typeof pct !== 'number' || Number.isNaN(pct)) {
    throw raise.ANSWER_INVALID(`similarityPct 非法：${String(pct)}`);
  }
  const rounded = Math.round(pct * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text}%`;
}

/** 单档查询：给定一致项数 C 返回该档信息（展示值由权重推得，非写死）。 */
function bandForCount(c) {
  if (!Number.isInteger(c) || c < 0 || c > CODE_LENGTH) {
    throw raise.ANSWER_INVALID(`一致项数 C 非法：${String(c)}`);
  }
  const p = CODE_LENGTH - c;
  return {
    c,
    p,
    similarityPct: Math.round(((c * W_SAME + p * W_COMP) / FULL) * 1000) / 10,
    band: BAND_BY_C[c],
  };
}

module.exports = { similarity, formatSimilarityPct, bandForCount, CODE_LENGTH };
  };

  // ── server/lib/store-cloud.js
  __registry["server/lib/store-cloud.js"] = function (module, exports, require) {
'use strict';

/**
 * 云数据库 store —— 抖音云云数据库（文档型）实现
 *
 * 依据：《平台规则检索记录》R-8、《技术资产》§6 / §12、《待确认项台账》D-1。
 * 服务端唯一通道为官方 Node SDK：`@open-dy/node-server-sdk` → `dySDK.database()`。
 * 文档：…/cloud-database/server/sdk-collection、…/server/sdk-document。
 *
 * 与内存实现（store.js）的关系：**方法签名一一对应**，差异只在载体语义：
 *   1) 全部方法返回 Promise（云库 IO 天然异步）。上层 handler / pairing 统一 `await`，
 *      因此同一套上层逻辑对两种 store 都成立（`await 同步值` 合法）。
 *   2) 唯一索引由集合的 `_id` 承担：sessions 用 session_id、pairings 用 pair_code、
 *      events 用 event_id 作 `_id`。`add` 在 `_id` 与已有记录冲突时失败 —— 天然唯一键插入。
 *      **错误处理不依赖具体 errorCode**：catch 后回读同 `_id`，读到即判为「冲突/重复」，
 *      读不到则原样抛出（避免把真实故障误判成冲突）。
 *   3) 「先到先得」改用条件更新（CAS）：`where({pair_code, invitee_id: null}).update`
 *      返回 `updated:0|1`，`0` 即已被占用，解决多实例下并发接受的竞态。
 *   4) **服务端 SDK 无跨文档事务** → `transaction` 降级为「顺序执行、不回滚」：
 *      幂等性由业务层保证（如 pairing.completePair 的「已完成即返回首结果」分支）。
 *      **不虚构云侧事务语义。**
 *
 * 集合（首次写入即创建；需在抖音云控制台开启「云数据库」组件后生效）：
 *   - st_sessions  _id = session_id
 *   - st_pairings  _id = pair_code
 *   - st_events    _id = event_id
 */

const { raise } = __req('server/lib/errors.js');

const C_SESSIONS = 'st_sessions';
const C_PAIRINGS = 'st_pairings';
const C_EVENTS = 'st_events';
const EXPIRED = 'expired';

/** 去掉库侧 `_id`，使读出的记录字段口径与内存实现一致。 */
function stripId(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return rest;
}

/** `doc(id).get()` → 单条记录或 null。 */
async function readDoc(collection, id) {
  const res = await collection.doc(id).get();
  const rows = (res && res.data) || [];
  return rows.length > 0 ? rows[0] : null;
}

/** 唯一键冲突判定：写失败后回读同 `_id`，存在即冲突。 */
async function insertUnique(collection, id, doc, conflictMessage) {
  try {
    await collection.add({ ...doc, _id: id });
  } catch (err) {
    if (await readDoc(collection, id)) throw raise.SERVER_ERROR(conflictMessage);
    throw err;
  }
}

/**
 * @param {{database:()=>object}} dySDK 官方 SDK 的 `dySDK`（`database()` 返回数据库实例）
 */
function createCloudStore(dySDK) {
  const database = dySDK.database();
  const command = database.command;

  const api = {
    // ── sessions（_id = session_id）──

    async insertSession(record) {
      await insertUnique(
        database.collection(C_SESSIONS),
        record.session_id,
        record,
        `session_id 已存在：${record.session_id}`
      );
      return { ...record };
    },

    async getSession(sessionId) {
      return stripId(await readDoc(database.collection(C_SESSIONS), sessionId));
    },

    async findLatestSessionByUser(userPseudoId) {
      const res = await database
        .collection(C_SESSIONS)
        .where({ user_pseudo_id: userPseudoId })
        .orderBy('ts', 'desc')
        .limit(1)
        .get();
      const rows = (res && res.data) || [];
      return rows.length > 0 ? stripId(rows[0]) : null;
    },

    // ── pairings（_id = pair_code）──

    async pairCodeExists(pairCode) {
      return !!(await readDoc(database.collection(C_PAIRINGS), pairCode));
    },

    async getPairing(pairCode) {
      return stripId(await readDoc(database.collection(C_PAIRINGS), pairCode));
    },

    async insertPairing(record) {
      await insertUnique(
        database.collection(C_PAIRINGS),
        record.pair_code,
        record,
        `pair_code 已存在：${record.pair_code}`
      );
      return { ...record };
    },

    async updatePairing(record) {
      // set 为替换式写入；须剔除 `_id`（SDK 不允许更新 _id）
      await database.collection(C_PAIRINGS).doc(record.pair_code).set(stripId(record));
      return { ...record };
    },

    /**
     * 先到先得：仅当 invitee_id 仍为 null 时写入。
     * @returns {Promise<boolean>} true=本次写入生效；false=已被他人抢先（`updated:0`）
     */
    async claimInvitee(pairCode, inviteeId) {
      const res = await database
        .collection(C_PAIRINGS)
        .where({ pair_code: pairCode, invitee_id: null })
        .update({ invitee_id: inviteeId });
      return res.updated === 1;
    },

    /**
     * 按 (发起者, 受邀者) 查未失效记录。
     * 语义来源（§3.3）：同对好友重复配对 → 复用已完成记录；expired 不占索引。
     */
    async findActivePairingByPair(initiatorId, inviteeId) {
      const res = await database
        .collection(C_PAIRINGS)
        .where({ initiator_id: initiatorId, invitee_id: inviteeId, status: command.neq(EXPIRED) })
        .orderBy('created_at', 'desc')
        .limit(1)
        .get();
      const rows = (res && res.data) || [];
      return rows.length > 0 ? stripId(rows[0]) : null;
    },

    // ── events（_id = event_id，服务端去重）──

    async seenEvent(eventId) {
      return !!(await readDoc(database.collection(C_EVENTS), eventId));
    },

    async appendEvent(event) {
      await insertUnique(
        database.collection(C_EVENTS),
        event.event_id,
        event,
        `event_id 已存在：${event.event_id}`
      );
      return { ...event };
    },

    // ── 事务（降级）──

    /**
     * 云数据库无跨文档事务：只顺序执行回调、不回滚。
     * @param {(store:object)=>Promise<any>} fn
     */
    async transaction(fn) {
      return fn(api);
    },

    // ── 运维辅助 ──

    async stats() {
      const [sessions, pairings, events] = await Promise.all([
        database.collection(C_SESSIONS).count(),
        database.collection(C_PAIRINGS).count(),
        database.collection(C_EVENTS).count(),
      ]);
      return { sessions: sessions.total, pairings: pairings.total, events: events.total };
    },
  };

  return api;
}

module.exports = { createCloudStore, COLLECTIONS: { C_SESSIONS, C_PAIRINGS, C_EVENTS } };
  };

  // ── server/lib/store-provider.js
  __registry["server/lib/store-provider.js"] = function (module, exports, require) {
'use strict';

/**
 * 运行时 store 选择
 *
 * 云函数为**多实例**，必须用云数据库才能保证跨实例可见；内存实现仅用于本地与集成测试。
 * 策略（《技术资产》§12、《待确认项台账》D-1）：
 *   1) **懒加载**官方 SDK `@open-dy/node-server-sdk`：本地 / 单测环境通常未安装该依赖，
 *      顶层 `require` 会让 `npm test` 直接挂掉；改为入口首次调用时再加载。
 *   2) 云数据库可用 → 用云库（store-cloud.js）。
 *   3) 不可用 → 降级为内存 store，并**显式告警**（禁止静默降级，避免线上丢状态无从察觉）。
 */

const { createStore } = __req('server/lib/store.js');
const { createCloudStore } = __req('server/lib/store-cloud.js');

/** 默认 SDK 加载器。外部依赖，打包器不改写；由云端 package.json 声明并由平台安装。 */
function loadDefaultSDK() {
  return require('@open-dy/node-server-sdk');
}

/** 取告警输出通道：优先平台运行时的 context.warn，回落到 console.warn。 */
function pickWarn(context) {
  if (context && typeof context.warn === 'function') return context.warn.bind(context);
  if (context && typeof context.log === 'function') return context.log.bind(context);
  return console.warn.bind(console);
}

/**
 * @param {object} [context] 云函数运行时上下文（仅供告警输出）
 * @param {()=>object} [loadSDK] SDK 加载器，默认官方 SDK；单测注入以模拟「可用 / 不可用」
 * @returns {object} store 实例（云库或内存）
 */
function createRuntimeStore(context, loadSDK = loadDefaultSDK) {
  try {
    const sdk = loadSDK();
    const dySDK = sdk.dySDK || sdk.default || sdk;
    if (!dySDK || typeof dySDK.database !== 'function') {
      throw new Error('SDK 未暴露 dySDK.database()');
    }
    return createCloudStore(dySDK);
  } catch (err) {
    pickWarn(context)(
      `[store] 云数据库不可用，已降级为内存 store（多实例下不保证一致，不适用于生产）：${err && err.message}`
    );
    return createStore();
  }
}

module.exports = { createRuntimeStore };
  };

  // ── server/lib/store.js
  __registry["server/lib/store.js"] = function (module, exports, require) {
'use strict';

/**
 * 内存 store —— 承担唯一索引与事务语义
 *
 * 这是**真实实现而非 mock**：唯一索引、复合唯一约束、事务快照回滚都在这里落地，
 * `pairing.js` 与 `handlers.js` 只依赖本文件暴露的接口，不关心底层载体。
 *
 * 后续替换为云数据库时只需重写本文件（保持方法签名），上层逻辑不动。
 *
 * TODO(D-1)：云数据库（文档型）无跨文档事务。云库实现（store-cloud.js）已把 `transaction`
 *   降级为「顺序执行、不回滚」，幂等性由业务层保证。**不虚构云侧事务语义。**
 *
 * `transaction` 既接受**同步回调**（就地快照回滚），也接受**异步回调**（云库路径下
 * store 方法返回 Promise）：异步回调 reject 时同样整体回滚，故上层的 `await store.transaction(...)`
 * 对两种 store 语义一致。
 */

const { raise } = __req('server/lib/errors.js');

/** 深拷贝，避免外层对象与库内对象互相污染（事务快照依赖此语义）。 */
function clone(value) {
  return value === null || value === undefined ? value : structuredClone(value);
}

/** 复合唯一键的拼接方式（\u0000 不会出现在 user_pseudo_id 中）。 */
function compositeKey(initiatorId, inviteeId) {
  return `${initiatorId}\u0000${inviteeId}`;
}

function createStore() {
  const state = {
    sessions: new Map(), // session_id → 会话记录
    pairings: new Map(), // pair_code → 配对记录
    pairIndex: new Map(), // 复合键 → pair_code（仅登记 invitee_id 非空且非 expired 的记录）
    eventIds: new Set(), // 已接收埋点的 event_id，用于服务端去重
    events: [], // 已接收埋点（内存态，随实例生命周期结束而释放）
  };

  /**
   * 复合键索引维护（(initiator_id, invitee_id) → 最新有效 pair_code）。
   *
   * 实现说明（对 §3.3 的一处必要放宽，已在交付汇报中记录）：
   *   §3.3 要求 (initiator_id, invitee_id) 建**复合唯一**索引，但同时规定
   *   「同一用户对同一好友重复配对 → 直接复用已完成记录」「已有 expired 记录视为新配对，允许新建」。
   *   这两条与硬唯一冲突：发起时 invitee 未知，同一对好友再次发起必然产生两条有效记录
   *   （一条 completed、一条 pending），硬唯一会直接 500。
   *   因此此处把复合键实现为**查询索引**（指向最新有效记录），唯一性由 §3.3 的「复用」语义
   *   在 `pairing.completePair` 中落地（复用已完成记录的同码结果，不重复计算）。
   *   真正的库级唯一约束需云数据库支持冲突回退，随 D-1 一并确认。
   */
  function indexSet(record) {
    if (record.invitee_id === null || record.status === 'expired') return;
    state.pairIndex.set(compositeKey(record.initiator_id, record.invitee_id), record.pair_code);
  }

  function indexClear(record) {
    if (record.invitee_id === null || record.status === 'expired') return;
    const key = compositeKey(record.initiator_id, record.invitee_id);
    if (state.pairIndex.get(key) === record.pair_code) state.pairIndex.delete(key);
  }

  const api = {
    // ── sessions 集合（§5）：session_id 唯一索引 ──

    insertSession(record) {
      if (state.sessions.has(record.session_id)) {
        throw raise.SERVER_ERROR(`session_id 已存在：${record.session_id}`);
      }
      state.sessions.set(record.session_id, clone(record));
      return clone(record);
    },

    getSession(sessionId) {
      return clone(state.sessions.get(sessionId) ?? null);
    },

    /**
     * 取某用户最近一次落库的会话结果。
     * 用途：`completePair` 读取受邀者「已落库的 archetype_code」——这是「只读落库」决策
     * 在 sessions 集合上所需的最小索引（user_pseudo_id 维度）。
     */
    findLatestSessionByUser(userPseudoId) {
      let latest = null;
      for (const rec of state.sessions.values()) {
        if (rec.user_pseudo_id !== userPseudoId) continue;
        if (!latest || rec.ts >= latest.ts) latest = rec;
      }
      return clone(latest);
    },

    // ── pairings 集合：pair_code 唯一索引 + (initiator_id, invitee_id) 复合唯一 ──

    pairCodeExists(pairCode) {
      return state.pairings.has(pairCode);
    },

    getPairing(pairCode) {
      return clone(state.pairings.get(pairCode) ?? null);
    },

    insertPairing(record) {
      if (state.pairings.has(record.pair_code)) {
        throw raise.SERVER_ERROR(`pair_code 已存在：${record.pair_code}`);
      }
      indexSet(record);
      state.pairings.set(record.pair_code, clone(record));
      return clone(record);
    },

    updatePairing(record) {
      const prev = state.pairings.get(record.pair_code);
      if (!prev) throw raise.SERVER_ERROR(`pair_code 不存在：${record.pair_code}`);
      indexClear(prev);
      indexSet(record);
      state.pairings.set(record.pair_code, clone(record));
      return clone(record);
    },

    /**
     * 先到先得：仅当 `invitee_id` 仍为 null 时写入。
     * 与云库实现的 CAS（`where({pair_code, invitee_id:null}).update`）语义一致。
     * @returns {boolean} true=本次写入生效；false=已被他人抢先
     */
    claimInvitee(pairCode, inviteeId) {
      const rec = state.pairings.get(pairCode);
      if (!rec || rec.invitee_id !== null) return false;
      api.updatePairing({ ...clone(rec), invitee_id: inviteeId });
      return true;
    },

    /**
     * 按 (发起者, 受邀者) 查未失效的配对记录。
     * 语义来源（§3.3）：同一用户对同一好友重复配对 → 直接复用已完成记录；
     * 已有 expired 记录则视为新配对，允许新建（故 expired 不占复合索引）。
     */
    findActivePairingByPair(initiatorId, inviteeId) {
      const code = state.pairIndex.get(compositeKey(initiatorId, inviteeId));
      return code ? clone(state.pairings.get(code)) : null;
    },

    // ── events：按 event_id 服务端去重（客户端重试重放时防重复计数） ──

    seenEvent(eventId) {
      return state.eventIds.has(eventId);
    },

    appendEvent(event) {
      state.eventIds.add(event.event_id);
      state.events.push(clone(event));
      return clone(event);
    },

    // ── 事务 ──

    /**
     * 事务快照 + 回滚。fn 抛错时，sessions / pairings / 复合索引整体还原。
     * 同步回调就地回滚；异步回调（返回 Promise）在 reject 时回滚，两种形态语义一致。
     * @param {(store:object)=>any|Promise<any>} fn
     */
    transaction(fn) {
      const snapshot = {
        sessions: new Map([...state.sessions].map(([k, v]) => [k, clone(v)])),
        pairings: new Map([...state.pairings].map(([k, v]) => [k, clone(v)])),
        pairIndex: new Map(state.pairIndex),
        eventIds: new Set(state.eventIds),
        events: clone(state.events),
      };
      const rollback = () => {
        state.sessions = snapshot.sessions;
        state.pairings = snapshot.pairings;
        state.pairIndex = snapshot.pairIndex;
        state.eventIds = snapshot.eventIds;
        state.events = snapshot.events;
      };

      let result;
      try {
        result = fn(api);
      } catch (err) {
        rollback();
        throw err;
      }
      if (result && typeof result.then === 'function') {
        return result.then(
          (value) => value,
          (err) => {
            rollback();
            throw err;
          }
        );
      }
      return result;
    },

    // ── 测试与运维辅助 ──

    stats() {
      return {
        sessions: state.sessions.size,
        pairings: state.pairings.size,
        pairIndexEntries: state.pairIndex.size,
        events: state.events.length,
      };
    },
  };

  return api;
}

module.exports = { createStore, compositeKey };
  };

  // ── shared/constants.js
  __registry["shared/constants.js"] = function (module, exports, require) {
'use strict';

/**
 * 唯一数据源（Single Source of Truth）
 *
 * 本文件是《星语人格 · 好友同频测试》全部规则常量的唯一定义处。
 * 依据：《技术资产-研发侧技术方案预研.md》§3.1～3.5；《文案资产-10题题库与计分表.md》。
 *
 * 消费方约定（对应技术资产 §1.2「单一权威实现」）：
 *   - 服务端：直接 require 本文件，用于计算。
 *   - 前端：**不得** require 本文件。前端只消费 `tools/gen-constants.js` 生成到
 *     `miniapp/shared/` 的展示用产物（原型索引、客户端常量），且这些产物中
 *     **不含**任何计分/同频度常量。
 *   - 门禁：`tools/check-client-isolation.js` 会拦截前端对计分常量的引用。
 */

/** 冻结辅助：递归冻结，防止运行期被意外改写。 */
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

// ─────────────────────────────────────────────────────────────
// 一、题库与计分
// ─────────────────────────────────────────────────────────────

/** 题库版本。随题库变更递增，参与结果缓存键与提交幂等键。 */
const QUIZ_VERSION = 'v1';

/** 单次测试必答题目数。答案数不等于该值即拒绝计分。 */
const REQUIRED_ANSWER_COUNT = 10;

/**
 * 维度 → 题号。每题二选一：选 A 记该维度 A 端 +1，选 B 记 B 端 +1，权重恒为 1。
 * 题数分布 3 / 3 / 2 / 2：D1、D2 为奇数题（不可能同分）；D3、D4 为偶数题（可能 1:1 同分）。
 */
const DIM_QUESTIONS = {
  D1: ['Q1', 'Q5', 'Q9'], // 表达取向：外显(A) / 内隐(B)
  D2: ['Q2', 'Q6', 'Q10'], // 能量取向：炽放(A) / 静蓄(B)
  D3: ['Q3', 'Q7'], // 决策取向：理性(A) / 感性(B)
  D4: ['Q4', 'Q8'], // 关系取向：主动(A) / 随和(B)
};

/** 原型码拼接顺序：D1 → D2 → D3 → D4。 */
const DIM_ORDER = ['D1', 'D2', 'D3', 'D4'];

/** 同分时默认取的端点（PRD 3.5 全局唯一规则）。 */
const TIE_BREAK_ENDPOINT = 'A';

// ─────────────────────────────────────────────────────────────
// 二、同频度
// ─────────────────────────────────────────────────────────────

/**
 * 展示值权重。**已冻结**——变更会直接改变 5 档展示值，
 * 须同步修订 PRD 3.5 表格与《测试资产》TC-SM-05 的硬断言。
 */
const W_SAME = 3; // 一致项权重
const W_COMP = 2; // 互补项权重
const FULL = 12; // 满分 = 4 × W_SAME

/** 相处模式标签，下标即一致项数 C（0～4）。标签文案以 PRD 3.5 为唯一权威。 */
const BAND_BY_C = ['极致互补型', '差异互补型', '均衡互补型', '高默契型', '同频共振型'];

// ─────────────────────────────────────────────────────────────
// 三、配对码
// ─────────────────────────────────────────────────────────────

/**
 * 配对码字母表：去除易混字符 I / L / O / 0 / 1。
 * 实测长度 = 31（23 个字母 + 8 个数字），故空间为 31^8 ≈ 8.5e11。
 * 注意：技术资产 §3.5 注释写作「32^8 ≈ 1.1e12」，底数有误；此处以 ALPHABET.length 计算，不写死底数。
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** 配对码位数。展示时按 4-4 分组，存储与传输不带分隔符。 */
const CODE_LEN = 8;

/** 配对码生成冲突重试上限。 */
const CODE_RETRY_LIMIT = 5;

/** 是否允许用户与自己配对。默认关闭，命中返回 PAIR_SELF_NOT_ALLOWED。 */
const ALLOW_SELF_PAIR = false;

/** 配对邀请有效期：7 天（PRD 3.3）。 */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 等待态轮询退避（毫秒），最后一项为上限，页面离开即停止。 */
const POLL_BACKOFF_MS = [3000, 6000, 12000, 30000];

// ─────────────────────────────────────────────────────────────
// 四、16 原型
// ─────────────────────────────────────────────────────────────

/**
 * 原型码 → 展示信息。**禁止用字符串哈希或下标推导**，必须逐条常量声明。
 * 名称逐条取自《文案资产-16人格原型解读.md》§二；symbolId 取自各原型「主导意象」。
 */
const ARCHETYPES = {
  AAAA: { id: 'archetype-aaaa', name: '曜日型', symbolId: 'star-noon' },
  AAAB: { id: 'archetype-aaab', name: '日珥型', symbolId: 'star-prominence' },
  AABA: { id: 'archetype-aaba', name: '彗尾型', symbolId: 'comet-tail' },
  AABB: { id: 'archetype-aabb', name: '极光型', symbolId: 'aurora-curtain' },
  ABAA: { id: 'archetype-abaa', name: '晨星型', symbolId: 'star-dawn' },
  ABAB: { id: 'archetype-abab', name: '双星型', symbolId: 'star-binary' },
  ABBA: { id: 'archetype-abba', name: '潮汐型', symbolId: 'tide-surface' },
  ABBB: { id: 'archetype-abbb', name: '深海型', symbolId: 'deep-current' },
  BAAA: { id: 'archetype-baaa', name: '星芒型', symbolId: 'star-single' },
  BAAB: { id: 'archetype-baab', name: '星雾型', symbolId: 'nebula-mist' },
  BABA: { id: 'archetype-baba', name: '月晕型', symbolId: 'moon-halo' },
  BABB: { id: 'archetype-babb', name: '星砂型', symbolId: 'star-dust' },
  BBAA: { id: 'archetype-bbaa', name: '极星型', symbolId: 'star-polar' },
  BBAB: { id: 'archetype-bbab', name: '萤火型', symbolId: 'deep-glimmer' },
  BBBA: { id: 'archetype-bbba', name: '静湖型', symbolId: 'lake-mirror' },
  BBBB: { id: 'archetype-bbbb', name: '夜幕型', symbolId: 'night-dome' },
};

// ─────────────────────────────────────────────────────────────
// 五、页面、本地存储键、埋点
// ─────────────────────────────────────────────────────────────

/**
 * 页面 ID 枚举。P-06 按「独立页面」计（用户已决策）：物理实现为 components/share-popup，
 * 但组件首次可见时上报一次 page_view(page_id='P-06')，与埋点映射表对齐，避免漏报。
 */
const PAGE_IDS = ['P-01', 'P-02', 'P-03', 'P-04', 'P-05', 'P-06'];

/** 落地来源枚举。具体 k 值映射待平台侧复核（D-1）。 */
const ENTRY_SOURCES = ['scene_short_video', 'scene_share', 'scene_pair', 'direct', 'douyin_task'];

/** 本地存储键（唯一权威，禁止散落定义）。 */
const STORE = {
  SESSION: 'st_session',
  RESULT: 'st_result',
  MY_ROLES: 'st_pair_roles',
  DEVICE: 'st_device',
  PENDING_PAIR: 'st_pending_pair',
};

/** 埋点 12 事件（PRD 第 9 章已确认）。 */
const EVENTS = [
  'page_view',
  'test_start',
  'answer_submit',
  'test_complete',
  'result_view',
  'pair_invite_create',
  'pair_invite_accept',
  'pair_complete',
  'share_click',
  'ad_impression',
  'ad_reward',
  'session_end',
];

/** 埋点公共字段（每条事件必带）。 */
const EVENT_COMMON_FIELDS = [
  'event_id',
  'session_id',
  'user_pseudo_id',
  'app_version',
  'quiz_version',
  'ts',
  'network',
];

/** 埋点批量上报策略。 */
const REPORT_POLICY = {
  BATCH_SIZE: 10, // 队列满 10 条触发
  FLUSH_INTERVAL_MS: 5000, // 或间隔 5s 触发
  QUEUE_LIMIT: 200, // 本地队列上限，超出丢最旧
};

/** 构建期注入的应用版本号，用于埋点 app_version 字段。 */
const APP_VERSION = '0.1.0';

// ─────────────────────────────────────────────────────────────
// 六、错误码
// ─────────────────────────────────────────────────────────────

/**
 * 错误码。0 为成功；其余见技术资产 §6，另新增 2004（见下）。
 * 本表只定义「码 → 语义」，不定义面向用户的中文提示文案——
 * 资产未给出逐条提示语，本阶段不自行编造，文案留待第二阶段由文案侧补齐。
 */
const ERROR_CODES = {
  OK: 0,
  ANSWER_INCOMPLETE: 1001, // 答案不足 10 题 → 返回答题页补齐
  ANSWER_INVALID: 1002, // 选项非法 → 记录日志并中止本次提交
  QUIZ_VERSION_MISMATCH: 1003, // 题库版本不一致 → 提示重新开始
  PAIR_CODE_NOT_FOUND: 2001, // 邀请不存在 → 引导重新发起
  PAIR_EXPIRED: 2002, // 邀请已过期 → P-05 过期态
  PAIR_SELF_NOT_ALLOWED: 2003, // 不可与自己配对
  PAIR_ALREADY_TAKEN: 2004, // 该邀请已被他人接受（新增，补技术资产 §3.3 未定义项）
  SERVER_ERROR: 3001, // 服务端内部错误 → P-04 计算失败态 + 重试
  RATE_LIMITED: 3002, // 限流 → 退避重试，不进入失败态
};

/** 错误码 → 语义标识，便于日志与断言。 */
const ERROR_NAMES = Object.fromEntries(
  Object.entries(ERROR_CODES).map(([name, code]) => [code, name])
);

/** 配对状态机状态。 */
const PAIR_STATUS = ['pending', 'completed', 'expired'];

/** 配对码输入归一化失败原因。 */
const CODE_REJECT_REASONS = ['EMPTY', 'AMBIGUOUS_CHARS', 'INVALID_CODE'];

module.exports = deepFreeze({
  QUIZ_VERSION,
  REQUIRED_ANSWER_COUNT,
  DIM_QUESTIONS,
  DIM_ORDER,
  TIE_BREAK_ENDPOINT,
  W_SAME,
  W_COMP,
  FULL,
  BAND_BY_C,
  ALPHABET,
  CODE_LEN,
  CODE_RETRY_LIMIT,
  ALLOW_SELF_PAIR,
  SESSION_TTL_MS,
  POLL_BACKOFF_MS,
  ARCHETYPES,
  PAGE_IDS,
  ENTRY_SOURCES,
  STORE,
  EVENTS,
  EVENT_COMMON_FIELDS,
  REPORT_POLICY,
  APP_VERSION,
  ERROR_CODES,
  ERROR_NAMES,
  PAIR_STATUS,
  CODE_REJECT_REASONS,
});
  };

  // ── server/functions/acceptInvite/index.js
  __registry["server/functions/acceptInvite/index.js"] = function (module, exports, require) {
'use strict';

/**
 * 云函数入口：acceptInvite（薄壳）
 * 业务逻辑见 server/lib/handlers.js。部署形态见《技术资产》§6（产物 build/cloud-functions/star-type-api/<函数名>.js）。
 *
 * 已落地(D-1)：store 由 store-provider.js 按环境选择（云库优先，降级内存并告警）；
 *   首次接受用条件更新（CAS）落位，避免多实例并发下两人同时占位。
 */

const { createRuntimeStore } = __req('server/lib/store-provider.js');
const { acceptInvite } = __req('server/lib/handlers.js');

let store = null;

/**
 * 入口签名对齐平台契约（已与线上函数服务核对）：`params` 即 HTTP 请求体本身，
 * 返回值作为 Response Body；调用路径 = 文件名，即 `/acceptInvite`。
 */
module.exports = async function main(params, context) {
  if (!store) store = createRuntimeStore(context);
  return acceptInvite(params || {}, { store, now: Date.now });
};
  };

  module.exports = __req("server/functions/acceptInvite/index.js");
})();

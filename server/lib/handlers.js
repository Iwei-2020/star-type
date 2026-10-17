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
} = require('../../shared/constants.js');
const { ok, fromError } = require('./envelope.js');
const { raise } = require('./errors.js');
const { scoreArchetype } = require('./scoring.js');
const pairing = require('./pairing.js');

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

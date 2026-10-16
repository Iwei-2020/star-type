'use strict';

/**
 * 会话机 —— 本地答题会话 / 结果缓存 / 配对角色 / 待配对码 的唯一读写处
 *
 * 依据：《技术资产》§3.4（会话恢复与幂等）、§3.3（配对角色）；PRD 3.6；本计划 §4.4-④。
 *
 * 本地存储键（取自 client-constants.js，禁止散落定义）：
 *   - `st_session:<quiz_version>`  当前题库版本的会话记录（版本前缀，避免跨版本污染）
 *   - `st_session:version`         上次活跃的题库版本，用于识别「老会话」
 *   - `st_result`                  结果缓存（记录内带 quiz_version，跨版本即视为无缓存）
 *   - `st_pair_roles`              本人参与过的配对码 `{ initiated: [], joined: [] }`
 *   - `st_pending_pair`            受邀落地、但本人尚未出结果时挂起的配对码
 *   - `st_device`                  本地匿名标识 `{ user_pseudo_id }`
 *
 * 两条硬约束：
 *   1. 完成度判定一律由调用方传入的 `questionIds` 推导，**不得引用 REQUIRED_ANSWER_COUNT**
 *      （该常量与题库分区同属前端隔离门禁黑名单，前端拿不到）。
 *   2. 存储异常一律静默降级（storage.js 已吞掉），会话机自身也不抛错——
 *      答题中途写盘失败不应打断用户，最坏结果是本次会话不可恢复。
 */

const { STORE, QUIZ_VERSION } = require('../shared/client-constants.js');
const { newId } = require('./id.js');

/**
 * @param {object} storage createStorage() 的返回值
 * @param {object} [options]
 * @param {string} [options.quizVersion] 题库版本，默认取 client-constants 的 QUIZ_VERSION
 * @param {string[]} [options.questionIds] 本次题库的题号序列，用于推导进度与完成度
 * @param {() => number} [options.now]
 * @param {() => string} [options.uuid]
 */
function createSession(storage, options) {
  const opts = options || {};
  const quizVersion = opts.quizVersion || QUIZ_VERSION;
  const questionIds = Array.isArray(opts.questionIds) ? opts.questionIds.slice() : [];
  const now = opts.now || Date.now;
  const uuid = opts.uuid || (() => newId('sess'));

  const activeKey = `${STORE.SESSION}:${quizVersion}`;
  const markerKey = `${STORE.SESSION}:version`;
  const total = questionIds.length;

  function readMarker() {
    const marker = storage.read(markerKey, null);
    return typeof marker === 'string' && marker ? marker : null;
  }

  /** 删除非当前版本的历史会话：老会话**不迁移**，直接提示重新开始（技术资产 §3.4）。 */
  function clearStale() {
    const marker = readMarker();
    if (marker && marker !== quizVersion) storage.remove(`${STORE.SESSION}:${marker}`);
  }

  function answeredCount(answers) {
    if (total > 0) {
      let n = 0;
      for (const qid of questionIds) {
        if (Object.prototype.hasOwnProperty.call(answers, qid)) n++;
      }
      return n;
    }
    return Object.keys(answers).length;
  }

  /** 当前会话状态视图。所有页面统一读这个，不要在页面里散读存储键。 */
  function status() {
    const raw = storage.read(activeKey, null);
    const view = {
      exists: false,
      state: 'none',
      session_id: null,
      quiz_version: quizVersion,
      started_at: null,
      answers: {},
      cursor: 0,
      answered_count: 0,
      total,
      finished: false,
      canResume: false,
      restartRequired: false,
    };

    if (raw && typeof raw === 'object' && raw.quiz_version === quizVersion) {
      const answers = Object.assign({}, raw.answers);
      const answered = answeredCount(answers);
      const finished = raw.finished === true || (total > 0 && answered >= total);
      return {
        exists: true,
        state: finished ? 'finished' : 'active',
        session_id: raw.session_id || null,
        quiz_version: quizVersion,
        started_at: raw.started_at || null,
        answers,
        cursor: Math.min(Math.max(Number(raw.cursor) || 0, 0), Math.max(total, answered)),
        answered_count: answered,
        total,
        finished,
        canResume: !finished && answered > 0,
        restartRequired: false,
      };
    }

    // 当前版本无会话：若存储里存在「另一版本」的会话，则提示重新开始
    const marker = readMarker();
    if (marker && marker !== quizVersion && storage.read(`${STORE.SESSION}:${marker}`, null)) {
      view.state = 'version_mismatch';
      view.restartRequired = true;
    }
    return view;
  }

  /** 开始一次新测试：清掉老版本残留，写入新会话记录。 */
  function begin() {
    clearStale();
    const record = {
      session_id: uuid(),
      quiz_version: quizVersion,
      started_at: now(),
      answers: {},
      cursor: 0,
      finished: false,
    };
    storage.write(activeKey, record);
    storage.write(markerKey, quizVersion);
    return status();
  }

  /** 取当前会话原始记录；不存在时返回 null（不自动创建）。 */
  function raw() {
    const record = storage.read(activeKey, null);
    if (!record || typeof record !== 'object' || record.quiz_version !== quizVersion) return null;
    return record;
  }

  /**
   * 记录一题作答（**同步写盘，非节流**，保证退出后可恢复）。
   * 首次作答即自动开新会话（技术资产 §3.4：进入答题页首次作答时生成 session_id）。
   *
   * @returns {boolean} 是否成功记录；题号不合法或写盘失败返回 false，不抛错
   */
  function answer(questionId, optionId) {
    if (typeof questionId !== 'string' || !questionId) return false;
    if (optionId === undefined || optionId === null || optionId === '') return false;

    const record = raw() || beginRaw();
    if (!record) return false;
    if (total > 0 && !questionIds.includes(questionId)) return false;

    record.answers[questionId] = String(optionId);

    const index = questionIds.indexOf(questionId);
    if (index >= 0) {
      // 作答即进入下一题；回改旧题不回退进度
      record.cursor = Math.max(Number(record.cursor) || 0, index + 1);
    } else {
      record.cursor = answeredCount(record.answers);
    }
    record.finished = total > 0 && answeredCount(record.answers) >= total;

    return storage.write(activeKey, record);
  }

  /** begin() 的内部版：只产出记录，不重复计算 status（避免 answer 里多读一次盘）。 */
  function beginRaw() {
    clearStale();
    const record = {
      session_id: uuid(),
      quiz_version: quizVersion,
      started_at: now(),
      answers: {},
      cursor: 0,
      finished: false,
    };
    storage.write(activeKey, record);
    storage.write(markerKey, quizVersion);
    return record;
  }

  /** 提交用载荷：只暴露计分所需三要素（session_id / quiz_version / answers）。 */
  function payload() {
    const record = raw();
    if (!record) return null;
    return {
      session_id: record.session_id,
      quiz_version: record.quiz_version,
      answers: Object.assign({}, record.answers),
    };
  }

  /** 清空当前会话（保留结果缓存与角色）。 */
  function reset() {
    storage.remove(activeKey);
    const marker = readMarker();
    if (marker === quizVersion) storage.remove(markerKey);
  }

  // ── 结果缓存（PRD 3.6：结果页重入以首计算结果为准）────────────────

  function readResult() {
    const cached = storage.read(STORE.RESULT, null);
    if (!cached || typeof cached !== 'object') return null;
    if (cached.quiz_version !== quizVersion) return null; // 跨版本缓存作废，不迁移
    return cached;
  }

  function hasResult() {
    return readResult() !== null;
  }

  function saveResult(result) {
    if (!result || typeof result !== 'object' || !result.archetype_code) return false;
    return storage.write(STORE.RESULT, {
      session_id: result.session_id || null,
      archetype_code: result.archetype_code,
      archetype_id: result.archetype_id || null,
      quiz_version: quizVersion,
      computed_at: result.computed_at === undefined ? now() : result.computed_at,
    });
  }

  function clearResult() {
    storage.remove(STORE.RESULT);
  }

  // ── 配对角色索引 ──────────────────────────────────────────────

  function readRoles() {
    const roles = storage.read(STORE.MY_ROLES, null);
    return {
      initiated: roles && Array.isArray(roles.initiated) ? roles.initiated.slice() : [],
      joined: roles && Array.isArray(roles.joined) ? roles.joined.slice() : [],
    };
  }

  function addRole(kind, pairCode) {
    if (kind !== 'initiated' && kind !== 'joined') return false;
    if (typeof pairCode !== 'string' || !pairCode) return false;
    const roles = readRoles();
    if (!roles[kind].includes(pairCode)) roles[kind].push(pairCode);
    return storage.write(STORE.MY_ROLES, roles);
  }

  function hasRole(kind, pairCode) {
    if (kind !== 'initiated' && kind !== 'joined') return false;
    return readRoles()[kind].includes(pairCode);
  }

  // ── 待配对码（受邀落地但本人尚无结果）──────────────────────────

  function readPendingPair() {
    const code = storage.read(STORE.PENDING_PAIR, null);
    return typeof code === 'string' && code ? code : null;
  }

  function setPendingPair(pairCode) {
    if (typeof pairCode !== 'string' || !pairCode) return false;
    return storage.write(STORE.PENDING_PAIR, pairCode);
  }

  function clearPendingPair() {
    storage.remove(STORE.PENDING_PAIR);
  }

  // ── 本地匿名标识（无注册体系，PRD 3.5）─────────────────────────

  function getUserId() {
    const device = storage.read(STORE.DEVICE, null);
    if (device && typeof device === 'object' && device.user_pseudo_id) return device.user_pseudo_id;
    const id = uuid();
    storage.write(STORE.DEVICE, { user_pseudo_id: id });
    return id;
  }

  return {
    quizVersion,
    questionIds: questionIds.slice(),
    status,
    begin,
    beginRaw,
    raw,
    answer,
    payload,
    reset,
    readResult,
    hasResult,
    saveResult,
    clearResult,
    readRoles,
    addRole,
    hasRole,
    readPendingPair,
    setPendingPair,
    clearPendingPair,
    getUserId,
    keys: {
      active: activeKey,
      marker: markerKey,
      result: STORE.RESULT,
      roles: STORE.MY_ROLES,
      pendingPair: STORE.PENDING_PAIR,
      device: STORE.DEVICE,
    },
  };
}

module.exports = { createSession };

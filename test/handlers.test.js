'use strict';

/**
 * 接口层单测
 * 覆盖：6 个接口的入参/出参契约、信封格式、错误码逐条、computeResult 幂等、reportEvents 去重。
 *
 * 注意：接口层已异步化（store 可能是云库，方法返回 Promise），故 handler 调用一律 `await`，
 * `assertEnvelope` 亦接收 Promise 并返回解析后的信封。
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  QUIZ_VERSION,
  ERROR_CODES,
  EVENTS,
  EVENT_COMMON_FIELDS,
} = require('../shared/constants.js');
const { createStore } = require('../server/lib/store.js');
const handlers = require('../server/lib/handlers.js');

const T0 = 1_700_000_000_000;

function makeDeps() {
  const store = createStore();
  let t = T0;
  let counter = 0;
  return {
    store,
    now: () => t,
    randomInt: (max) => counter++ % max,
    advance: (ms) => {
      t += ms;
    },
  };
}

/** Q1…Q10 顺序的答案表。 */
function answersFrom(seq) {
  const out = {};
  for (let i = 0; i < seq.length; i++) out[`Q${i + 1}`] = seq[i];
  return out;
}

/** 通用信封结构断言；接受信封或 Promise，返回解析后的信封。 */
async function assertEnvelope(envelopeOrPromise, expectedCode) {
  const envelope = await envelopeOrPromise;
  assert.equal(typeof envelope, 'object');
  assert.equal(envelope.code, expectedCode);
  assert.equal(typeof envelope.msg, 'string');
  assert.ok('data' in envelope);
  return envelope;
}

/** 造一个 12 事件字段齐备的埋点。 */
function makeEvent(eventName, overrides) {
  return {
    event_id: overrides && overrides.event_id ? overrides.event_id : `evt-${Math.random().toString(16).slice(2)}`,
    event_name: eventName,
    session_id: 'sess-1',
    user_pseudo_id: 'userA',
    app_version: '0.1.0',
    quiz_version: QUIZ_VERSION,
    ts: T0,
    network: 'wifi',
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────
// computeResult
// ─────────────────────────────────────────────────────────────

test('computeResult：正常计分返回信封，且不落库原始答案', async () => {
  const deps = makeDeps();
  const res = await assertEnvelope(
    handlers.computeResult(
      {
        session_id: 's-1',
        user_pseudo_id: 'userA',
        quiz_version: QUIZ_VERSION,
        answers: answersFrom('ABABABABAB'),
      },
      deps
    ),
    ERROR_CODES.OK
  );
  assert.equal(res.data.archetype_code, 'ABAB');
  assert.equal(res.data.archetype_id, 'archetype-abab');
  assert.equal(res.data.computed_at, T0);
  assert.equal(res.data.cached, false);

  const stored = deps.store.getSession('s-1');
  assert.equal(stored.archetype_code, 'ABAB');
  assert.ok(!('answers' in stored), '不应把原始答案落库');
  assert.ok(!JSON.stringify(stored).includes('Q1'), '落库内容不应含题号键');
});

test('computeResult：以 session_id 幂等，重复提交返回首次结果且不重算', async () => {
  const deps = makeDeps();
  const first = await handlers.computeResult(
    { session_id: 's-1', user_pseudo_id: 'userA', quiz_version: QUIZ_VERSION, answers: answersFrom('ABABABABAB') },
    deps
  );
  deps.advance(30_000);
  // 同一 session_id 换了答案再提交 → 必须返回首次结果
  const second = await handlers.computeResult(
    { session_id: 's-1', user_pseudo_id: 'userA', quiz_version: QUIZ_VERSION, answers: answersFrom('BBBBBBBBBB') },
    deps
  );

  assert.equal(second.code, ERROR_CODES.OK);
  assert.equal(second.data.archetype_code, first.data.archetype_code, '不应被二次答案覆盖');
  assert.equal(second.data.computed_at, first.data.computed_at, 'computed_at 不应被刷新');
  assert.equal(second.data.cached, true);
  assert.equal(deps.store.stats().sessions, 1);
});

test('computeResult：题库版本不一致 → 1003', async () => {
  const deps = makeDeps();
  const res = await handlers.computeResult(
    { session_id: 's-1', user_pseudo_id: 'userA', quiz_version: 'v0', answers: answersFrom('AAAAAAAAAA') },
    deps
  );
  await assertEnvelope(res, ERROR_CODES.QUIZ_VERSION_MISMATCH);
  assert.equal(deps.store.stats().sessions, 0);
});

test('computeResult：答案不足 → 1001；选项非法 → 1002；缺 session_id → 1001', async () => {
  const deps = makeDeps();
  await assertEnvelope(
    handlers.computeResult({ session_id: 's-1', user_pseudo_id: 'u', quiz_version: QUIZ_VERSION, answers: { Q1: 'A' } }, deps),
    ERROR_CODES.ANSWER_INCOMPLETE
  );
  const bad = answersFrom('AAAAAAAAAA');
  bad.Q2 = 'X';
  await assertEnvelope(
    handlers.computeResult({ session_id: 's-2', user_pseudo_id: 'u', quiz_version: QUIZ_VERSION, answers: bad }, deps),
    ERROR_CODES.ANSWER_INVALID
  );
  await assertEnvelope(
    handlers.computeResult({ user_pseudo_id: 'u', quiz_version: QUIZ_VERSION, answers: answersFrom('AAAAAAAAAA') }, deps),
    ERROR_CODES.ANSWER_INCOMPLETE
  );
  assert.equal(deps.store.stats().sessions, 0, '异常路径不应留下会话记录');
});

// ─────────────────────────────────────────────────────────────
// createInvite / acceptInvite / getPairStatus / completePair
// ─────────────────────────────────────────────────────────────

test('createInvite：无结果时先用 computeResult 落库，再发起配对', async () => {
  const deps = makeDeps();
  await assertEnvelope(handlers.createInvite({ user_pseudo_id: 'userA' }, deps), ERROR_CODES.ANSWER_INCOMPLETE);

  await handlers.computeResult(
    { session_id: 's-a', user_pseudo_id: 'userA', quiz_version: QUIZ_VERSION, answers: answersFrom('ABABABABAB') },
    deps
  );
  const res = await assertEnvelope(handlers.createInvite({ user_pseudo_id: 'userA' }, deps), ERROR_CODES.OK);
  assert.equal(res.data.pair_code.length, 8);
  assert.equal(res.data.formatted_pair_code.length, 9);
  assert.equal(deps.store.getPairing(res.data.pair_code).initiator_code, 'ABAB');
});

test('createInvite：显式传 archetype_code 时以入参为准；非法码 → 1002', async () => {
  const deps = makeDeps();
  const res = await assertEnvelope(
    handlers.createInvite({ user_pseudo_id: 'userA', archetype_code: 'BABA' }, deps),
    ERROR_CODES.OK
  );
  assert.equal(deps.store.getPairing(res.data.pair_code).initiator_code, 'BABA');
  await assertEnvelope(handlers.createInvite({ user_pseudo_id: 'userA', archetype_code: 'ZZZZ' }, deps), ERROR_CODES.ANSWER_INVALID);
});

test('acceptInvite → getPairStatus → completePair：全链路信封与结果', async () => {
  const deps = makeDeps();

  await handlers.computeResult(
    { session_id: 's-a', user_pseudo_id: 'userA', quiz_version: QUIZ_VERSION, answers: answersFrom('ABABABABAB') },
    deps
  );
  const inv = await handlers.createInvite({ user_pseudo_id: 'userA' }, deps);
  const pairCode = inv.data.pair_code;

  // 受邀者先完成本人测试
  await handlers.computeResult(
    { session_id: 's-b', user_pseudo_id: 'userB', quiz_version: QUIZ_VERSION, answers: answersFrom('ABABABABAB') },
    deps
  );

  const acc = await assertEnvelope(handlers.acceptInvite({ pair_code: pairCode, user_pseudo_id: 'userB' }, deps), ERROR_CODES.OK);
  assert.equal(acc.data.status, 'pending');
  assert.equal(acc.data.isFirstAccept, true);

  const st = await assertEnvelope(handlers.getPairStatus({ pair_code: pairCode, attempt: 3 }, deps), ERROR_CODES.OK);
  assert.equal(st.data.status, 'pending');
  assert.equal(st.data.retry_after_ms, 30000);

  const done = await assertEnvelope(handlers.completePair({ pair_code: pairCode, user_pseudo_id: 'userB' }, deps), ERROR_CODES.OK);
  assert.equal(done.data.status, 'completed');
  assert.equal(done.data.c_count, 4);
  assert.equal(done.data.similarity_pct, 100);
  assert.equal(done.data.band_label, '同频共振型');
  assert.equal(done.data.isFirstCompletion, true);

  // 重入幂等
  const again = await handlers.completePair({ pair_code: pairCode, user_pseudo_id: 'userB' }, deps);
  assert.equal(again.data.isFirstCompletion, false);
});

test('completePair：受邀者未落库结果 → 返回 pending 且 ready:false（不是错误）', async () => {
  const deps = makeDeps();
  const inv = await handlers.createInvite({ user_pseudo_id: 'userA', archetype_code: 'ABAB' }, deps);
  const res = await assertEnvelope(
    handlers.completePair({ pair_code: inv.data.pair_code, user_pseudo_id: 'userB' }, deps),
    ERROR_CODES.OK
  );
  assert.equal(res.data.status, 'pending');
  assert.equal(res.data.ready, false);
});

test('错误码逐条：2001 邀请不存在 / 2002 已过期 / 2003 自配对 / 2004 已被他人接受', async () => {
  const deps = makeDeps();
  const inv = await handlers.createInvite({ user_pseudo_id: 'userA', archetype_code: 'ABAB' }, deps);
  const pairCode = inv.data.pair_code;

  // 注意：本用例中 createInvite 已占用 'ABCDEFGH'（确定性随机源的首个产物），
  // 故此处用一个语法合法但必定不存在的码来验证 2001。
  await assertEnvelope(handlers.acceptInvite({ pair_code: '99999999', user_pseudo_id: 'userB' }, deps), ERROR_CODES.PAIR_CODE_NOT_FOUND);
  await assertEnvelope(handlers.acceptInvite({ pair_code: pairCode, user_pseudo_id: 'userA' }, deps), ERROR_CODES.PAIR_SELF_NOT_ALLOWED);

  await handlers.acceptInvite({ pair_code: pairCode, user_pseudo_id: 'userB' }, deps);
  await assertEnvelope(handlers.acceptInvite({ pair_code: pairCode, user_pseudo_id: 'userC' }, deps), ERROR_CODES.PAIR_ALREADY_TAKEN);

  deps.advance(8 * 24 * 60 * 60 * 1000);
  await assertEnvelope(handlers.getPairStatus({ pair_code: pairCode }, deps), ERROR_CODES.PAIR_EXPIRED);
});

test('2001 的 data 携带拒绝原因，前端可区分歧义字符与格式错误', async () => {
  const deps = makeDeps();
  const ambiguous = await handlers.acceptInvite({ pair_code: 'K7QXI9T2', user_pseudo_id: 'userB' }, deps);
  await assertEnvelope(ambiguous, ERROR_CODES.PAIR_CODE_NOT_FOUND);
  assert.equal(ambiguous.data.reason, 'AMBIGUOUS_CHARS');

  const bad = await handlers.acceptInvite({ pair_code: 'K7QX2M9', user_pseudo_id: 'userB' }, deps);
  assert.equal(bad.data.reason, 'INVALID_CODE');
});

test('SERVER_ERROR：依赖缺失等非业务异常归为 3001，不泄漏内部细节', async () => {
  const res = await handlers.computeResult(
    { session_id: 's-1', user_pseudo_id: 'u', quiz_version: QUIZ_VERSION, answers: answersFrom('AAAAAAAAAA') },
    {}
  );
  await assertEnvelope(res, ERROR_CODES.SERVER_ERROR);
});

// ─────────────────────────────────────────────────────────────
// reportEvents
// ─────────────────────────────────────────────────────────────

test('reportEvents：合法事件全部接收（12 事件逐一可上报）', async () => {
  const deps = makeDeps();
  const events = EVENTS.map((name, i) =>
    makeEvent(name, {
      event_id: `evt-${i}`,
      ...(name === 'page_view' ? { page_id: 'P-01' } : {}),
    })
  );
  const res = await assertEnvelope(handlers.reportEvents({ events }, deps), ERROR_CODES.OK);
  assert.equal(res.data.accepted_count, 12);
  assert.equal(res.data.duplicated_count, 0);
  assert.equal(res.data.rejected_count, 0);
  assert.equal(deps.store.stats().events, 12);
});

test('reportEvents：按 event_id 去重，客户端重试重放不重复计数', async () => {
  const deps = makeDeps();
  const batch = [makeEvent('test_start', { event_id: 'evt-1' }), makeEvent('answer_submit', { event_id: 'evt-2' })];

  const first = await handlers.reportEvents({ events: batch }, deps);
  assert.equal(first.data.accepted_count, 2);

  const replay = await handlers.reportEvents({ events: batch }, deps);
  assert.equal(replay.data.accepted_count, 0);
  assert.equal(replay.data.duplicated_count, 2);
  assert.deepEqual(replay.data.duplicated_ids, ['evt-1', 'evt-2']);
  assert.equal(deps.store.stats().events, 2, '重放不应增加落库条数');
});

test('reportEvents：非法条目逐条拒绝并给出原因，不影响同批其余条目', async () => {
  const deps = makeDeps();
  const res = await handlers.reportEvents(
    {
      events: [
        makeEvent('test_start', { event_id: 'ok-1' }),
        makeEvent('not_an_event', { event_id: 'bad-name' }),
        makeEvent('test_start', { event_id: 'bad-field', network: undefined }),
        makeEvent('page_view', { event_id: 'bad-page', page_id: 'P-99' }),
        { event_id: 'bad-ts', event_name: 'test_start' },
        null,
      ],
    },
    deps
  );

  assert.equal(res.data.accepted_count, 1);
  assert.equal(res.data.rejected_count, 5);
  assert.deepEqual(res.data.accepted_ids, ['ok-1']);
  assert.deepEqual(
    res.data.rejected.map((r) => r.reason),
    [
      'UNKNOWN_EVENT',
      'MISSING_FIELD:network',
      'INVALID_PAGE_ID',
      'MISSING_FIELD:session_id',
      'NOT_OBJECT',
    ]
  );
});

test('reportEvents：P-06 必须能作为 page_view 的 page_id 上报（否则会漏报）', async () => {
  const deps = makeDeps();
  const res = await handlers.reportEvents({ events: [makeEvent('page_view', { event_id: 'p6-1', page_id: 'P-06' })] }, deps);
  assert.equal(res.data.accepted_count, 1, 'P-06 应按独立页面计，可正常上报 page_view');
});

test('reportEvents：events 非数组 → 1002', async () => {
  const deps = makeDeps();
  await assertEnvelope(handlers.reportEvents({ events: 'nope' }, deps), ERROR_CODES.ANSWER_INVALID);
});

test('reportEvents：公共字段清单与常量表一致（缺任一字段即被判非法）', async () => {
  assert.deepEqual(EVENT_COMMON_FIELDS, [
    'event_id',
    'session_id',
    'user_pseudo_id',
    'app_version',
    'quiz_version',
    'ts',
    'network',
  ]);
  const deps = makeDeps();
  for (const field of EVENT_COMMON_FIELDS) {
    const ev = makeEvent('test_start', { event_id: `miss-${field}` });
    delete ev[field];
    const res = await handlers.reportEvents({ events: [ev] }, deps);
    assert.equal(res.data.rejected_count, 1, `缺 ${field} 应被拒绝`);
    assert.equal(res.data.rejected[0].reason, `MISSING_FIELD:${field}`);
  }
});

test('handler 集合：恰好 6 个接口，与 §6 契约一一对应', () => {
  assert.deepEqual(Object.keys(handlers.handlers).sort(), [
    'acceptInvite',
    'completePair',
    'computeResult',
    'createInvite',
    'getPairStatus',
    'reportEvents',
  ]);
});

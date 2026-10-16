'use strict';

/**
 * 埋点 SDK 单测
 * 覆盖：12 事件与专属字段齐备、公共字段自动补齐、队列阈值触发、失败静默且保留重试、
 *      队列上限丢最旧、定时触发（注入假定时器）、provider 异常降级。
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const shared = require('../shared/constants.js');
const client = require('../miniapp/shared/client-constants.js');
const { createTracker, EVENT_SPECIFIC_FIELDS } = require('../miniapp/core/tracker.js');

const T0 = 1_700_000_000_000;

/** 每个事件的专属字段取值（逐条对应《技术资产》§7）。 */
const SPECIFIC_PAYLOAD = {
  page_view: () => ({ page_id: 'P-01', entry_source: 'direct' }),
  test_start: () => ({ entry_source: 'direct' }),
  answer_submit: () => ({ question_id: 'Q1', option_id: 'A', question_index: 0, elapsed_ms: 1200 }),
  test_complete: () => ({ archetype_id: 'archetype-abab', total_duration_ms: 180000, answer_count: 10 }),
  result_view: () => ({ archetype_id: 'archetype-abab', is_revisit: false }),
  pair_invite_create: () => ({ pair_code: 'K7QX2M9T', archetype_id: 'archetype-abab' }),
  pair_invite_accept: () => ({ pair_code: 'K7QX2M9T' }),
  pair_complete: () => ({ pair_code: 'K7QX2M9T', c_count: 4, band_label: '同频共振型', similarity_pct: 100 }),
  share_click: () => ({ scene: 'result', channel: 'wechat' }),
  ad_impression: () => ({ ad_type: 'reward_video', placement: 'result_bottom' }),
  ad_reward: () => ({ ad_type: 'reward_video', placement: 'result_bottom', ad_scene: 'after_result' }),
  session_end: () => ({ duration_ms: 200000, page_count: 5 }),
};

let idSeq = 0;
function makeTracker(overrides) {
  return createTracker(Object.assign(
    {
      now: () => T0,
      uuid: () => `evt-${++idSeq}`,
      getSessionId: () => 'sess-1',
      getUserId: () => 'userA',
      getNetwork: () => 'wifi',
      autoFlush: false,
    },
    overrides
  ));
}

/** 假定时器：记录注册的间隔，并允许手动触发。 */
function fakeTimer() {
  const calls = [];
  return {
    calls,
    setInterval(fn, ms) {
      calls.push({ fn, ms });
      return calls.length;
    },
    clearInterval() {},
  };
}

// ─────────────────────────────────────────────────────────────
// 事件定义
// ─────────────────────────────────────────────────────────────

test('12 事件与专属字段：事件名逐条取自 EVENTS，且每个事件都有专属字段定义', () => {
  assert.equal(shared.EVENTS.length, 12);
  assert.deepEqual(Object.keys(EVENT_SPECIFIC_FIELDS).sort(), shared.EVENTS.slice().sort());
  for (const name of shared.EVENTS) {
    assert.ok(Array.isArray(EVENT_SPECIFIC_FIELDS[name]), `${name} 应有专属字段定义`);
  }
});

test('12 事件逐一可入队，公共字段 7 项自动补齐', () => {
  const tracker = makeTracker();
  for (const name of shared.EVENTS) {
    assert.equal(tracker.track(name, SPECIFIC_PAYLOAD[name]()), true, `${name} 应可入队`);
  }
  assert.equal(tracker.size(), 12);

  for (const event of tracker.pending()) {
    for (const field of shared.EVENT_COMMON_FIELDS) {
      assert.ok(event[field] !== undefined && event[field] !== null, `${event.event_name} 缺公共字段 ${field}`);
    }
    assert.match(event.event_id, /^evt-\d+$/);
    assert.equal(event.app_version, client.APP_VERSION);
    assert.equal(event.quiz_version, shared.QUIZ_VERSION);
    assert.equal(event.ts, T0);
    assert.equal(event.network, 'wifi');
    assert.equal(event.session_id, 'sess-1');
    assert.equal(event.user_pseudo_id, 'userA');
  }
});

test('未知事件名与缺专属字段一律拒绝，且不抛错', () => {
  const tracker = makeTracker();
  assert.equal(tracker.track('not_an_event', {}), false);

  for (const name of shared.EVENTS) {
    const payload = SPECIFIC_PAYLOAD[name]();
    const firstField = EVENT_SPECIFIC_FIELDS[name][0];
    delete payload[firstField];
    assert.equal(tracker.track(name, payload), false, `${name} 缺 ${firstField} 应被拒绝`);
  }
  assert.equal(tracker.size(), 0);
  assert.equal(tracker.stats().rejected, 1 + shared.EVENTS.length);
});

test('page_view：page_id 必须在 PAGE_IDS 内，P-06 可按独立页面上报', () => {
  const tracker = makeTracker();
  assert.equal(tracker.track('page_view', { page_id: 'P-99', entry_source: 'direct' }), false);
  for (const pageId of shared.PAGE_IDS) {
    assert.equal(tracker.track('page_view', { page_id: pageId, entry_source: 'direct' }), true, `${pageId} 应可上报`);
  }
  assert.equal(tracker.size(), 6, 'P-01～P-06 六页均可上报 page_view');
});

// ─────────────────────────────────────────────────────────────
// 队列与上报
// ─────────────────────────────────────────────────────────────

test('队列满 10 条即触发一次批量上报', async () => {
  const batches = [];
  const tracker = makeTracker({
    transport: (events) => {
      batches.push(events);
      return { code: 0 };
    },
  });

  for (let i = 0; i < 10; i++) tracker.track('test_start', { entry_source: 'direct' });
  assert.equal(tracker.size(), 0, '第 10 条入队后应已触发上报');

  const outcome = await tracker.flushNow();
  assert.equal(outcome.flushed, 10, '第 10 条入队时已同步切出批次，等待其落定后计数为 10');
  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, client.REPORT_POLICY.BATCH_SIZE);
  assert.equal(tracker.stats().sent, 10);
});

test('不足一批时不自动上报，间隔定时器触发后一次性上报', async () => {
  const timer = fakeTimer();
  const batches = [];
  const tracker = makeTracker({
    timer,
    autoFlush: true,
    transport: (events) => {
      batches.push(events);
      return { code: 0 };
    },
  });

  tracker.track('test_start', { entry_source: 'direct' });
  tracker.track('test_start', { entry_source: 'direct' });
  assert.equal(batches.length, 0, '未达 BATCH_SIZE 不应触发');
  assert.equal(timer.calls.length, 1);
  assert.equal(timer.calls[0].ms, client.REPORT_POLICY.FLUSH_INTERVAL_MS, '间隔应取自 REPORT_POLICY');

  timer.calls[0].fn();
  await tracker.flushNow();
  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, 2);
  assert.equal(tracker.size(), 0);

  tracker.stopTimer();
  tracker.track('test_start', { entry_source: 'direct' });
  await assert.doesNotReject(() => tracker.flushNow());
});

test('上报失败：静默不抛错，批次保留在队列头部等待补传', async () => {
  const tracker = makeTracker({
    transport: () => {
      throw new Error('network down');
    },
  });
  tracker.track('test_start', { entry_source: 'direct' });
  tracker.track('answer_submit', SPECIFIC_PAYLOAD.answer_submit());

  const first = await tracker.flushNow();
  assert.equal(first.failed, true);
  assert.equal(first.flushed, 0);
  assert.equal(tracker.size(), 2, '失败批次应回到队列');
  assert.equal(tracker.pending()[0].event_name, 'test_start', '顺序不得打乱');

  // 恢复网络后补传成功
  let received = null;
  const recovering = makeTracker({
    transport: (events) => {
      received = events;
      return { code: 0 };
    },
  });
  recovering.track('test_start', { entry_source: 'direct' });
  const second = await recovering.flushNow();
  assert.equal(second.flushed, 1);
  assert.equal(received.length, 1);
});

test('上报返回非 0 信封码同样视为失败（不吞掉错误码语义）', async () => {
  const tracker = makeTracker({ transport: () => ({ code: 3001, msg: 'SERVER_ERROR', data: {} }) });
  tracker.track('test_start', { entry_source: 'direct' });
  const outcome = await tracker.flushNow();
  assert.equal(outcome.failed, true);
  assert.equal(tracker.size(), 1);
});

test('无上报通道时 flush 跳过且保留队列，不抛错', async () => {
  const tracker = makeTracker();
  tracker.track('test_start', { entry_source: 'direct' });
  const outcome = await tracker.flushNow();
  assert.equal(outcome.skipped, 'no_transport');
  assert.equal(tracker.size(), 1);
});

test('队列上限 200：超出丢最旧', () => {
  const tracker = makeTracker();
  const total = client.REPORT_POLICY.QUEUE_LIMIT + 5;

  for (let i = 0; i < total; i++) {
    tracker.track('answer_submit', Object.assign(SPECIFIC_PAYLOAD.answer_submit(), { question_index: i }));
  }
  assert.equal(tracker.size(), client.REPORT_POLICY.QUEUE_LIMIT);
  assert.equal(tracker.stats().dropped, 5);
  assert.equal(tracker.pending()[0].question_index, 5, '丢的应是最旧 5 条');
  assert.equal(tracker.pending()[client.REPORT_POLICY.QUEUE_LIMIT - 1].question_index, total - 1);
});

// ─────────────────────────────────────────────────────────────
// 降级
// ─────────────────────────────────────────────────────────────

test('公共字段 provider 抛错时降级为空值/unknown，事件仍可入队', () => {
  const tracker = makeTracker({
    getSessionId: () => {
      throw new Error('boom');
    },
    getUserId: () => {
      throw new Error('boom');
    },
    getNetwork: () => {
      throw new Error('boom');
    },
    now: () => {
      throw new Error('boom');
    },
  });

  assert.equal(tracker.track('test_start', { entry_source: 'direct' }), true);
  const [event] = tracker.pending();
  assert.equal(event.session_id, '');
  assert.equal(event.user_pseudo_id, '');
  assert.equal(event.network, 'unknown');
  assert.equal(event.ts, 0);
});

test('reset 清空队列与计数', () => {
  const tracker = makeTracker({ transport: () => ({ code: 0 }) });
  tracker.track('test_start', { entry_source: 'direct' });
  tracker.track('nope', {});
  tracker.reset();
  assert.deepEqual(tracker.stats(), { queued: 0, sent: 0, dropped: 0, rejected: 0 });
});

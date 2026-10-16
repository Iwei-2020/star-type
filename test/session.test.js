'use strict';

/**
 * 会话机 + 落地路由 单测
 * 覆盖：TC-SS-01（中途退出恢复）/ TC-SS-03（结果页重入）/ TC-SS-04（题库版本不一致不迁移）；
 *      会话写盘同步性、完成度推导、存储降级不抛错；route 分支与配对码明确拒绝。
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const shared = require('../shared/constants.js');
const client = require('../miniapp/shared/client-constants.js');
const { createStorage, createMemoryAdapter } = require('../miniapp/core/storage.js');
const { createSession } = require('../miniapp/core/session.js');
const route = require('../miniapp/core/route.js');

const T0 = 1_700_000_000_000;
const QUESTION_IDS = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9', 'Q10'];

let seq = 0;
function makeSession(adapter, overrides) {
  return createSession(createStorage(adapter), Object.assign(
    {
      quizVersion: shared.QUIZ_VERSION,
      questionIds: QUESTION_IDS,
      now: () => T0,
      uuid: () => `sess-${++seq}`,
    },
    overrides
  ));
}

function answerAll(session, values) {
  for (let i = 0; i < values.length; i++) session.answer(`Q${i + 1}`, values[i]);
}

// ─────────────────────────────────────────────────────────────
// 会话机
// ─────────────────────────────────────────────────────────────

test('TC-SS-01：答至第 5 题退出，重新进入可继续，已答答案不丢、恢复到第 5 题位', () => {
  const adapter = createMemoryAdapter();
  const before = makeSession(adapter);

  assert.equal(before.status().state, 'none');
  assert.equal(before.status().total, 10, '总题数由调用方传入的 questionIds 推导');

  answerAll(before, ['A', 'B', 'A', 'B', 'A']);
  const mid = before.status();
  assert.equal(mid.state, 'active');
  assert.equal(mid.answered_count, 5);
  assert.equal(mid.cursor, 5, 'cursor = 已答题数，即恢复到第 5 题位');
  assert.equal(mid.canResume, true);
  assert.equal(mid.restartRequired, false);

  // 模拟退出后重新进入：同一存储适配器上重建会话机
  const after = makeSession(adapter);
  const resumed = after.status();
  assert.equal(resumed.canResume, true, '应提示「继续上次答题」');
  assert.equal(resumed.cursor, 5);
  assert.equal(resumed.session_id, mid.session_id, '同一会话，session_id 不变');
  assert.deepEqual(resumed.answers, { Q1: 'A', Q2: 'B', Q3: 'A', Q4: 'B', Q5: 'A' });
});

test('答满全部题目 → finished；未答满不为 finished；回改旧题不回退进度', () => {
  const session = makeSession(createMemoryAdapter());
  answerAll(session, ['A', 'A', 'A', 'A', 'A']);
  assert.equal(session.status().finished, false);

  session.answer('Q2', 'B'); // 回改第 2 题
  assert.equal(session.status().cursor, 5, '回改旧题不得回退 cursor');
  assert.equal(session.status().answers.Q2, 'B');

  answerAll(session, ['A', 'A', 'A', 'A', 'B', 'A', 'A', 'A', 'A', 'A']); // Q1..Q10
  const done = session.status();
  assert.equal(done.finished, true);
  assert.equal(done.state, 'finished');
  assert.equal(done.canResume, false);
  assert.equal(done.answered_count, 10);
});

test('answer：题号不在本次题库内、或选项为空 → 返回 false 且不入库，不抛错', () => {
  const session = makeSession(createMemoryAdapter());
  session.answer('Q1', 'A');
  assert.equal(session.answer('Q99', 'A'), false);
  assert.equal(session.answer('Q2', ''), false);
  assert.equal(session.answer('', 'A'), false);
  assert.equal(session.answer(null, 'A'), false);
  assert.equal(session.status().answered_count, 1);
  assert.equal(session.status().cursor, 1);
});

test('每答一题同步写盘：新会话机实例立即可读到最新进度', () => {
  const adapter = createMemoryAdapter();
  const session = makeSession(adapter);
  session.answer('Q1', 'A');
  assert.notEqual(adapter.getStorageSync(session.keys.active), '', '写入必须是同步落盘，非节流');
  const other = makeSession(adapter);
  assert.equal(other.status().answered_count, 1);
});

test('payload：只暴露计分三要素；无会话时为 null', () => {
  const session = makeSession(createMemoryAdapter());
  assert.equal(session.payload(), null);
  const created = session.begin();
  const payload = session.payload();
  assert.deepEqual(Object.keys(payload).sort(), ['answers', 'quiz_version', 'session_id']);
  assert.equal(payload.session_id, created.session_id);
  assert.equal(payload.quiz_version, shared.QUIZ_VERSION);
  assert.deepEqual(payload.answers, {});
});

test('存储不可用（写盘抛错）时会话机静默降级，不抛错、不影响状态读取', () => {
  const broken = createStorage({
    getStorageSync: () => '',
    setStorageSync: () => {
      throw new Error('storage quota exceeded');
    },
    removeStorageSync: () => {},
  });
  const session = createSession(broken, {
    quizVersion: shared.QUIZ_VERSION,
    questionIds: QUESTION_IDS,
    now: () => T0,
    uuid: () => 'sess-broken',
  });
  assert.doesNotThrow(() => session.answer('Q1', 'A'));
  assert.equal(session.answer('Q1', 'A'), false, '写盘失败应返回 false');
  assert.doesNotThrow(() => session.begin());
  assert.equal(session.status().state, 'none');
});

// ─────────────────────────────────────────────────────────────
// TC-SS-03 结果页重入 / TC-SS-04 版本不一致
// ─────────────────────────────────────────────────────────────

test('TC-SS-03：结果页重入以首次缓存为准，不重新计算', () => {
  const adapter = createMemoryAdapter();
  const first = makeSession(adapter);
  first.begin();
  assert.equal(first.hasResult(), false);

  const stored = {
    session_id: first.status().session_id,
    archetype_code: 'ABAB',
    archetype_id: 'archetype-abab',
    computed_at: T0,
  };
  assert.equal(first.saveResult(stored), true);

  const revisit = makeSession(adapter);
  const cached = revisit.readResult();
  assert.equal(cached.archetype_code, 'ABAB');
  assert.equal(cached.archetype_id, 'archetype-abab');
  assert.equal(cached.computed_at, T0, '重入不得刷新计算时间');
  assert.equal(cached.quiz_version, shared.QUIZ_VERSION);
  assert.equal(revisit.hasResult(), true);
});

test('结果缓存形态非法时不入库；跨题库版本缓存作废', () => {
  const adapter = createMemoryAdapter();
  const v1 = makeSession(adapter);
  assert.equal(v1.saveResult(null), false);
  assert.equal(v1.saveResult({ archetype_id: 'archetype-abab' }), false, '缺 archetype_code 不落库');
  assert.equal(v1.hasResult(), false);

  v1.saveResult({ archetype_code: 'ABAB', archetype_id: 'archetype-abab', computed_at: T0 });
  const v2 = makeSession(adapter, { quizVersion: 'v2' });
  assert.equal(v2.readResult(), null, '题库版本变更加版本前缀后，旧结果不迁移');
  assert.equal(v2.hasResult(), false);
});

test('TC-SS-04：题库版本不一致 → 提示重新开始，旧答案不迁移且被清理', () => {
  const adapter = createMemoryAdapter();
  const v1 = makeSession(adapter);
  answerAll(v1, ['A', 'A', 'A']);

  const v2 = makeSession(adapter, { quizVersion: 'v2' });
  const mismatched = v2.status();
  assert.equal(mismatched.state, 'version_mismatch');
  assert.equal(mismatched.restartRequired, true, '应提示重新开始');
  assert.deepEqual(mismatched.answers, {}, '旧答案不得迁移');
  assert.equal(mismatched.exists, false);

  v2.begin(); // 重新开始
  assert.equal(adapter.getStorageSync('st_session:v1'), '', 'begin 后旧版本会话应被清理');
  assert.equal(v2.status().state, 'active');

  // 旧版本会话机再次进入：已无 v1 会话 → 仍为版本不一致提示
  const backToV1 = makeSession(adapter, { quizVersion: shared.QUIZ_VERSION });
  assert.equal(backToV1.status().restartRequired, true);
  assert.deepEqual(backToV1.status().answers, {});
});

// ─────────────────────────────────────────────────────────────
// 角色索引 / 待配对码 / 匿名标识
// ─────────────────────────────────────────────────────────────

test('配对角色索引：发起与加入分开记录，重复写入去重', () => {
  const adapter = createMemoryAdapter();
  const session = makeSession(adapter);
  assert.deepEqual(session.readRoles(), { initiated: [], joined: [] });

  session.addRole('initiated', 'K7QX2M9T');
  session.addRole('initiated', 'K7QX2M9T');
  session.addRole('joined', 'M3P8QR7K');
  assert.deepEqual(session.readRoles(), { initiated: ['K7QX2M9T'], joined: ['M3P8QR7K'] });
  assert.equal(session.hasRole('initiated', 'K7QX2M9T'), true);
  assert.equal(session.hasRole('joined', 'M3P8QR7K'), true);
  assert.equal(session.hasRole('joined', 'K7QX2M9T'), false);
  assert.equal(session.addRole('other', 'X'), false, '非法角色类型不写入');

  const other = makeSession(adapter);
  assert.deepEqual(other.readRoles().joined, ['M3P8QR7K'], '角色索引跨会话保留');
});

test('待配对码：受邀落地但本人尚无结果时挂起，出结果后清除', () => {
  const adapter = createMemoryAdapter();
  const session = makeSession(adapter);
  assert.equal(session.readPendingPair(), null);

  assert.equal(session.setPendingPair('K7QX2M9T'), true);
  assert.equal(session.readPendingPair(), 'K7QX2M9T');
  assert.equal(makeSession(adapter).readPendingPair(), 'K7QX2M9T', '挂起值跨会话保留');

  session.clearPendingPair();
  assert.equal(session.readPendingPair(), null);
  assert.equal(session.setPendingPair(''), false);
});

test('匿名标识：首次读取即生成并持久化，之后稳定不变', () => {
  const adapter = createMemoryAdapter();
  const session = makeSession(adapter);
  const id = session.getUserId();
  assert.equal(typeof id, 'string');
  assert.ok(id.length > 0);
  assert.equal(session.getUserId(), id, '同一会话内稳定');
  assert.equal(makeSession(adapter).getUserId(), id, '跨会话稳定（持久化）');
  assert.equal(adapter.getStorageSync(client.STORE.DEVICE), JSON.stringify({ user_pseudo_id: id }));
});

test('存储键全部由 client-constants 的 STORE 派生，不散落硬编码', () => {
  const session = makeSession(createMemoryAdapter());
  assert.equal(session.keys.active, `${client.STORE.SESSION}:${shared.QUIZ_VERSION}`);
  assert.equal(session.keys.marker, `${client.STORE.SESSION}:version`);
  assert.equal(session.keys.result, client.STORE.RESULT);
  assert.equal(session.keys.roles, client.STORE.MY_ROLES);
  assert.equal(session.keys.pendingPair, client.STORE.PENDING_PAIR);
  assert.equal(session.keys.device, client.STORE.DEVICE);
});

// ─────────────────────────────────────────────────────────────
// 落地路由
// ─────────────────────────────────────────────────────────────

test('route：页面 ID 与常量表 PAGE_IDS 一一对应', () => {
  const pages = Object.values(route.PAGES);
  assert.equal(pages.length, 6);
  for (const page of pages) assert.ok(shared.PAGE_IDS.includes(page), `${page} 应在 PAGE_IDS 内`);
  assert.equal(route.PAGES.SHARE, 'P-06', 'P-06 按独立页面计');
});

test('route：带合法配对码且有本地结果 → P-05；无结果 → P-02 并挂起配对码', () => {
  const withResult = route.resolveEntry({ query: 'scene=pair&code=K7QX2M9T', hasResult: true });
  assert.equal(withResult.page, 'P-05');
  assert.deepEqual(withResult.params, { pair_code: 'K7QX2M9T' });
  assert.equal(withResult.pendingPairCode, null, '已有结果无需挂起');
  assert.equal(withResult.entrySource, 'scene_pair');

  const withoutResult = route.resolveEntry({ query: 'scene=pair&code=K7QX2M9T', hasResult: false });
  assert.equal(withoutResult.page, 'P-02', '受邀者尚无本人结果 → 先答题');
  assert.equal(withoutResult.pendingPairCode, 'K7QX2M9T', '配对码挂起，待 computeResult 成功后进 P-05');
  assert.deepEqual(withoutResult.params, { pair_code: 'K7QX2M9T' });
});

test('route：无 code → P-01；scene 映射落地来源；显式 entry_source 优先', () => {
  const plain = route.resolveEntry({ query: {}, hasResult: false });
  assert.equal(plain.page, 'P-01');
  assert.equal(plain.pendingPairCode, null);
  assert.equal(plain.entrySource, 'direct');
  assert.equal(plain.code, null);

  const video = route.resolveEntry({ query: { scene: 'short_video' } });
  assert.equal(video.page, 'P-01');
  assert.equal(video.entrySource, 'scene_short_video');

  const task = route.resolveEntry({ query: { scene: 'douyin_task' } });
  assert.equal(task.entrySource, 'douyin_task');

  const explicit = route.resolveEntry({ query: { scene: 'short_video', entry_source: 'scene_share' } });
  assert.equal(explicit.entrySource, 'scene_share', '显式 entry_source 命中枚举时优先');

  const unknown = route.resolveEntry({ query: { entry_source: 'not_in_enum' } });
  assert.equal(unknown.entrySource, 'direct', '枚举外取值必须回落到 direct');
});

test('route：entrySource 恒在 ENTRY_SOURCES 枚举内', () => {
  const cases = [
    {},
    { scene: 'pair' },
    { scene: 'share' },
    { scene: 'video' },
    { scene: 'task' },
    { scene: 'unknown_scene' },
    { entry_source: 'douyin_task' },
    { code: 'K7QX2M9T', scene: 'share' },
  ];
  for (const query of cases) {
    const res = route.resolveEntry({ query });
    assert.ok(shared.ENTRY_SOURCES.includes(res.entrySource), `${JSON.stringify(query)} → ${res.entrySource}`);
  }
});

test('route：配对码明确拒绝 —— 歧义字符 / 长度不符 / 空值，均回首页且不挂起', () => {
  const ambiguous = route.resolveEntry({ query: { code: 'K7QXI9T2' } });
  assert.equal(ambiguous.page, 'P-01');
  assert.equal(ambiguous.code.ok, false);
  assert.equal(ambiguous.code.reason, 'AMBIGUOUS_CHARS');
  assert.equal(ambiguous.code.chars, 'I', '应回传命中的歧义字符');
  assert.equal(ambiguous.pendingPairCode, null);

  // 不做 O→0 / I→1 模糊映射：含 0/1 同样拒绝
  assert.equal(route.checkPairCode('K7QX2M0T').reason, 'AMBIGUOUS_CHARS');
  assert.equal(route.checkPairCode('K7QX2M1T').reason, 'AMBIGUOUS_CHARS');

  assert.equal(route.checkPairCode('K7QX2M9').reason, 'INVALID_CODE', '长度 ≠ 8 拒绝');
  assert.equal(route.checkPairCode('K7QX2M9TT').reason, 'INVALID_CODE');
  assert.equal(route.checkPairCode('   ').reason, 'EMPTY');
  assert.equal(route.checkPairCode('').reason, 'EMPTY');
  assert.equal(route.checkPairCode(undefined), null, '未提供 code 返回 null，而非拒绝原因');

  // 去分隔符/空白后仍非 8 位或含表外字符 → INVALID_CODE
  assert.equal(route.checkPairCode('K7 QX 2M').reason, 'INVALID_CODE');
  assert.equal(route.checkPairCode('K7QX2M9$').reason, 'INVALID_CODE');
});

test('route：配对码归一化 —— 小写与连字符被接受，返回去分隔符的大写码', () => {
  const lower = route.checkPairCode('k7qx-2m9t');
  assert.equal(lower.ok, true);
  assert.equal(lower.code, 'K7QX2M9T');

  const spaced = route.checkPairCode(' K7QX 2M9T ');
  assert.equal(spaced.ok, true);
  assert.equal(spaced.code, 'K7QX2M9T');

  const res = route.resolveEntry({ query: { code: 'k7qx-2m9t' }, hasResult: true });
  assert.equal(res.page, 'P-05');
  assert.equal(res.params.pair_code, 'K7QX2M9T');
});

test('route：归一化拒绝原因全部取自 CODE_REJECT_REASONS 枚举', () => {
  assert.deepEqual(client.CODE_REJECT_REASONS, ['EMPTY', 'AMBIGUOUS_CHARS', 'INVALID_CODE']);
  const reasons = [
    route.checkPairCode('').reason,
    route.checkPairCode('K7QXI9T2').reason,
    route.checkPairCode('K7QX2M9').reason,
  ];
  for (const reason of reasons) {
    assert.ok(client.CODE_REJECT_REASONS.includes(reason), `${reason} 应在枚举内`);
  }
});

test('route：normalizeQuery 同时支持对象与原始查询串，非法百分号编码不抛错', () => {
  assert.deepEqual(route.normalizeQuery('scene=pair&code=K7QX2M9T'), { scene: 'pair', code: 'K7QX2M9T' });
  assert.deepEqual(route.normalizeQuery('?a=1'), { a: '1' });
  assert.deepEqual(route.normalizeQuery({ scene: 'pair' }), { scene: 'pair' });
  assert.deepEqual(route.normalizeQuery(null), {});
  assert.doesNotThrow(() => route.normalizeQuery('%E0%A4%A=a'));
});

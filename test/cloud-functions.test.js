'use strict';

/**
 * 抖音云函数服务部署产物单测（build/cloud-functions/star-type-api/，由 tools/gen-cloud-functions.js 生成）
 *
 * 断言口径：① 6 个函数名与客户端路径约定一致，产物自包含（无相对 require 残留）；
 * ② 打包产物可直接按平台契约调用（`params` 即请求体），信封与错误码与源码一致。
 * 注意：只验证产物可用性与契约，业务分支的完备性由各自模块的单测覆盖。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const OUT_DIR = path.resolve(__dirname, '../build/cloud-functions/star-type-api');

/** 函数名清单：与 miniapp/core/cloud.js 的 pathOf 约定、云端平铺文件名三方一致。 */
const FUNCTIONS = [
  'computeResult',
  'createInvite',
  'acceptInvite',
  'completePair',
  'getPairStatus',
  'reportEvents',
];

function bundleOf(name) {
  return require(path.join(OUT_DIR, `${name}.js`));
}

test('产物齐备且自包含：6 个函数 + package.json，无相对 require 残留', () => {
  for (const name of FUNCTIONS) {
    const file = path.join(OUT_DIR, `${name}.js`);
    assert.ok(fs.existsSync(file), `缺少产物 ${name}.js`);
    const code = fs.readFileSync(file, 'utf8');
    assert.ok(!/require\(\s*['"]\.\.?\//.test(code), `${name}.js 仍含相对 require，非自包含`);
    assert.ok(code.includes(`/${name}`), `${name}.js 头部应写明调用路径 /${name}`);
  }
  assert.ok(fs.existsSync(path.join(OUT_DIR, 'package.json')), '缺少云端 package.json');
});

test('computeResult 产物：按平台契约调用算出原型码，且幂等缓存生效', async () => {
  const computeResult = bundleOf('computeResult');
  const answers = {};
  for (let i = 1; i <= 10; i++) answers[`Q${i}`] = 'A';

  const first = await computeResult({
    session_id: 'sess-bundle-1',
    user_pseudo_id: 'upl-bundle-1',
    quiz_version: 'v1',
    answers,
  });
  assert.strictEqual(first.code, 0, `期望成功信封，实际 ${JSON.stringify(first)}`);
  assert.strictEqual(first.msg, 'ok');
  assert.strictEqual(first.data.archetype_code, 'AAAA');
  assert.strictEqual(first.data.cached, false);

  const second = await computeResult({
    session_id: 'sess-bundle-1',
    user_pseudo_id: 'upl-bundle-1',
    quiz_version: 'v1',
    answers,
  });
  assert.strictEqual(second.code, 0);
  assert.strictEqual(second.data.cached, true, '同 session_id 重入须命中缓存');
});

test('computeResult 产物：答案不足 10 题返回 1001', async () => {
  const computeResult = bundleOf('computeResult');
  const res = await computeResult({
    session_id: 'sess-bundle-short',
    user_pseudo_id: 'upl-bundle-1',
    quiz_version: 'v1',
    answers: { Q1: 'A' },
  });
  assert.strictEqual(res.code, 1001, `期望 ANSWER_INCOMPLETE，实际 ${JSON.stringify(res)}`);
});

test('reportEvents 产物：合法事件接受、同 event_id 重放计为重复', async () => {
  const reportEvents = bundleOf('reportEvents');
  const event = {
    event_id: 'evt-bundle-1',
    event_name: 'page_view',
    page_id: 'P-04',
    session_id: 'sess-bundle-1',
    user_pseudo_id: 'upl-bundle-1',
    app_version: '0.1.0',
    quiz_version: 'v1',
    ts: 1730000000000,
    network: 'wifi',
  };

  const first = await reportEvents({ events: [event] });
  assert.strictEqual(first.code, 0);
  assert.strictEqual(first.data.accepted_count, 1);
  assert.strictEqual(first.data.duplicated_count, 0);

  const replay = await reportEvents({ events: [event] });
  assert.strictEqual(replay.data.accepted_count, 0);
  assert.strictEqual(replay.data.duplicated_count, 1);
});

test('createInvite 产物：缺 user_pseudo_id 返回 1002，显式传原型码可创建邀请', async () => {
  const createInvite = bundleOf('createInvite');

  const invalid = await createInvite({});
  assert.strictEqual(invalid.code, 1002, `期望 ANSWER_INVALID，实际 ${JSON.stringify(invalid)}`);

  const created = await createInvite({ user_pseudo_id: 'upl-bundle-1', archetype_code: 'AAAA' });
  assert.strictEqual(created.code, 0, `期望创建成功，实际 ${JSON.stringify(created)}`);
  const code = created.data.pair_code;
  assert.strictEqual(typeof code, 'string');
  assert.strictEqual(code.length, 8);
  assert.strictEqual(created.data.formatted_pair_code, `${code.slice(0, 4)}-${code.slice(4)}`);
});

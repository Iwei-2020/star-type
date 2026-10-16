'use strict';

// ─────────────────────────────────────────────────────────────
// 本文件由 tools/gen-constants.js 从 shared/constants.js 自动生成。
// 禁止手改：改动会在下一次生成时被覆盖，且 gen-constants.js --check 会失败。
// 用途：前端展示用。**不含任何计分 / 同频度逻辑**（技术资产 §1.2 单一权威实现）。
// ─────────────────────────────────────────────────────────────
module.exports = Object.freeze({
  APP_VERSION: "0.1.0",
  QUIZ_VERSION: "v1",
  PAIR_CODE_LEN: 8,
  AMBIGUOUS_CHARS: "ILO01",
  STORE: {
    "SESSION": "st_session",
    "RESULT": "st_result",
    "MY_ROLES": "st_pair_roles",
    "DEVICE": "st_device",
    "PENDING_PAIR": "st_pending_pair"
  },
  EVENTS: [
    "page_view",
    "test_start",
    "answer_submit",
    "test_complete",
    "result_view",
    "pair_invite_create",
    "pair_invite_accept",
    "pair_complete",
    "share_click",
    "ad_impression",
    "ad_reward",
    "session_end"
  ],
  EVENT_COMMON_FIELDS: [
    "event_id",
    "session_id",
    "user_pseudo_id",
    "app_version",
    "quiz_version",
    "ts",
    "network"
  ],
  REPORT_POLICY: {
    "BATCH_SIZE": 10,
    "FLUSH_INTERVAL_MS": 5000,
    "QUEUE_LIMIT": 200
  },
  PAGE_IDS: [
    "P-01",
    "P-02",
    "P-03",
    "P-04",
    "P-05",
    "P-06"
  ],
  ENTRY_SOURCES: [
    "scene_short_video",
    "scene_share",
    "scene_pair",
    "direct",
    "douyin_task"
  ],
  ERROR_CODES: {
    "OK": 0,
    "ANSWER_INCOMPLETE": 1001,
    "ANSWER_INVALID": 1002,
    "QUIZ_VERSION_MISMATCH": 1003,
    "PAIR_CODE_NOT_FOUND": 2001,
    "PAIR_EXPIRED": 2002,
    "PAIR_SELF_NOT_ALLOWED": 2003,
    "PAIR_ALREADY_TAKEN": 2004,
    "SERVER_ERROR": 3001,
    "RATE_LIMITED": 3002
  },
  PAIR_STATUS: [
    "pending",
    "completed",
    "expired"
  ],
  CODE_REJECT_REASONS: [
    "EMPTY",
    "AMBIGUOUS_CHARS",
    "INVALID_CODE"
  ],
  POLL_BACKOFF_MS: [
    3000,
    6000,
    12000,
    30000
  ],
});

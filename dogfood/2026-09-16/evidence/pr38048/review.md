Measured coverage unavailable; candidate mappings are unverified.

- server/channels/api4/post.go: scanner-heuristic (unverified; heuristic) → no candidates
- server/channels/app/content_flagging.go: scanner-heuristic (unverified; heuristic) → specs/functional/channels/content_flagging/deletion-report/deletion-report.spec.ts, specs/functional/channels/content_flagging/edge-cases/author-deletes-message-before-review.spec.ts, specs/functional/channels/content_flagging/edge-cases/author-edits-message-during-review.spec.ts, specs/functional/channels/content_flagging/flagging/flag-messages.spec.ts, specs/functional/channels/content_flagging/notifications/author-notification.spec.ts, specs/functional/channels/content_flagging/notifications/reporter-notification.spec.ts, specs/functional/channels/content_flagging/reviewer-actions/reviewer-actions.spec.ts, specs/functional/channels/content_flagging/reviewer-reports/cross-team-flag-reports-global-reviewers.spec.ts, specs/functional/channels/content_flagging/reviewer-reports/multiple-reviewers-receive-same-flag.spec.ts
- server/channels/app/content_flagging_report.go: scanner-heuristic (unverified; heuristic) → specs/functional/channels/content_flagging/deletion-report/deletion-report.spec.ts, specs/functional/channels/content_flagging/edge-cases/author-deletes-message-before-review.spec.ts, specs/functional/channels/content_flagging/edge-cases/author-edits-message-during-review.spec.ts, specs/functional/channels/content_flagging/flagging/flag-messages.spec.ts, specs/functional/channels/content_flagging/notifications/author-notification.spec.ts, specs/functional/channels/content_flagging/notifications/reporter-notification.spec.ts, specs/functional/channels/content_flagging/reviewer-actions/reviewer-actions.spec.ts, specs/functional/channels/content_flagging/reviewer-reports/cross-team-flag-reports-global-reviewers.spec.ts, specs/functional/channels/content_flagging/reviewer-reports/multiple-reviewers-receive-same-flag.spec.ts
- server/channels/app/draft.go: scanner-heuristic (unverified; heuristic) → specs/functional/channels/drafts/draft_channel_switch.spec.ts, specs/functional/channels/drafts/drafts_on_deleted_message.spec.ts, /private/tmp/impact-gate-recovery-evidence/w3/pr38048/base-inventory/e2e-tests/cypress/tests/integration/channels/messaging/draft_with_only_2_byte_characters_spec.js, /private/tmp/impact-gate-recovery-evidence/w3/pr38048/base-inventory/e2e-tests/cypress/tests/integration/channels/messaging/long_draft_spec.js, /private/tmp/impact-gate-recovery-evidence/w3/pr38048/base-inventory/e2e-tests/cypress/tests/integration/channels/messaging/message_draft_persistance_spec.js, /private/tmp/impact-gate-recovery-evidence/w3/pr38048/base-inventory/e2e-tests/cypress/tests/integration/channels/messaging/message_draft_spec.js, /private/tmp/impact-gate-recovery-evidence/w3/pr38048/base-inventory/e2e-tests/cypress/tests/integration/channels/messaging/message_draft_then_switch_channel_spec.js, /private/tmp/impact-gate-recovery-evidence/w3/pr38048/base-inventory/e2e-tests/cypress/tests/integration/channels/messaging/message_draft_with_attachment_then_switch_channel_spec.js
- server/channels/app/post.go: scanner-heuristic (unverified; heuristic) → no candidates
- server/channels/app/post_metadata.go: scanner-heuristic (unverified; heuristic) → no candidates

## ⚠️ Review Recommended

This PR impacts 6 flows with low defect risk. Review recommended before merging.

### Behavior changes

- File attachment policies active
- Permission or authorization logic changed

### Recommended tests

- **[P0] File attachment policies active** (core-flow)
  - Rationale: Behavior change in post_metadata.go
- **[P0] Users with appropriate roles can access the feature** (core-flow)
  - Rationale: Behavior change in abac_file_metadata_test.go
- **[P1] Non-admin users see appropriate access restrictions** (cross-role)
  - Rationale: Permission logic changed but no cross-role test exists
- **[P1] Changes persist after page reload** (persistence)
  - Rationale: UI + API changed but no persistence test exists
- **[P2] API returns appropriate error for invalid input** (error-case)
  - Rationale: New API behavior but no error case test

### Relevant existing tests

- specs/functional/channels/content_flagging/deletion-report/deletion-report.spec.ts (scanner-heuristic)
- specs/functional/channels/content_flagging/edge-cases/author-deletes-message-before-review.spec.ts (scanner-heuristic)
- specs/functional/channels/content_flagging/edge-cases/author-edits-message-during-review.spec.ts (scanner-heuristic)
- specs/functional/channels/content_flagging/flagging/flag-messages.spec.ts (scanner-heuristic)
- specs/functional/channels/content_flagging/notifications/author-notification.spec.ts (scanner-heuristic)
- specs/functional/channels/content_flagging/notifications/reporter-notification.spec.ts (scanner-heuristic)
- specs/functional/channels/content_flagging/reviewer-actions/reviewer-actions.spec.ts (scanner-heuristic)
- specs/functional/channels/content_flagging/reviewer-reports/cross-team-flag-reports-global-reviewers.spec.ts (scanner-heuristic)
- specs/functional/channels/content_flagging/reviewer-reports/multiple-reviewers-receive-same-flag.spec.ts (scanner-heuristic)
- specs/functional/channels/drafts/draft_channel_switch.spec.ts (scanner-heuristic)

### Impacted User Flows

| Status | Priority | Flow | Tests | Gaps |
|--------|----------|------|-------|------|
| ❌ no specs | P2 | Server/Channels/Api4/Post | none | No E2E test coverage for this flow |
| ❌ no specs | P2 | Server/Channels/App/Post | none | No E2E test coverage for this flow |
| ❌ no specs | P2 | Server/Channels/App/Post Metadata | none | No E2E test coverage for this flow |
| ✅ Playwright associated | P2 | Server/Channels/App/Content Flagging | 9 tests | - |
| ✅ Playwright associated | P2 | Server/Channels/App/Content Flagging Report | 9 tests | - |
| ✅ Playwright associated | P2 | Server/Channels/App/Draft | 8 tests | - |

**Server/Channels/Api4/Post**
- Changed: server/channels/api4/post.go
- Risk: no test coverage

**Server/Channels/App/Post**
- Changed: server/channels/app/post.go
- Risk: no test coverage

**Server/Channels/App/Post Metadata**
- Changed: server/channels/app/post_metadata.go
- Risk: no test coverage

**Server/Channels/App/Content Flagging**
- Existing test: specs/functional/channels/content_flagging/deletion-report/deletion-report.spec.ts
- Existing test: specs/functional/channels/content_flagging/edge-cases/author-deletes-message-before-review.spec.ts
- Existing test: specs/functional/channels/content_flagging/edge-cases/author-edits-message-during-review.spec.ts
- Existing test: specs/functional/channels/content_flagging/flagging/flag-messages.spec.ts
- Existing test: specs/functional/channels/content_flagging/notifications/author-notification.spec.ts
- Existing test: specs/functional/channels/content_flagging/notifications/reporter-notification.spec.ts
- Existing test: specs/functional/channels/content_flagging/reviewer-actions/reviewer-actions.spec.ts
- Existing test: specs/functional/channels/content_flagging/reviewer-reports/cross-team-flag-reports-global-reviewers.spec.ts
- Existing test: specs/functional/channels/content_flagging/reviewer-reports/multiple-reviewers-receive-same-flag.spec.ts
- Changed: server/channels/app/content_flagging.go

**Server/Channels/App/Content Flagging Report**
- Existing test: specs/functional/channels/content_flagging/deletion-report/deletion-report.spec.ts
- Existing test: specs/functional/channels/content_flagging/edge-cases/author-deletes-message-before-review.spec.ts
- Existing test: specs/functional/channels/content_flagging/edge-cases/author-edits-message-during-review.spec.ts
- Existing test: specs/functional/channels/content_flagging/flagging/flag-messages.spec.ts
- Existing test: specs/functional/channels/content_flagging/notifications/author-notification.spec.ts
- Existing test: specs/functional/channels/content_flagging/notifications/reporter-notification.spec.ts
- Existing test: specs/functional/channels/content_flagging/reviewer-actions/reviewer-actions.spec.ts
- Existing test: specs/functional/channels/content_flagging/reviewer-reports/cross-team-flag-reports-global-reviewers.spec.ts
- Existing test: specs/functional/channels/content_flagging/reviewer-reports/multiple-reviewers-receive-same-flag.spec.ts
- Changed: server/channels/app/content_flagging_report.go

**Server/Channels/App/Draft**
- Existing test: specs/functional/channels/drafts/draft_channel_switch.spec.ts
- Existing test: specs/functional/channels/drafts/drafts_on_deleted_message.spec.ts
- Existing test: /private/tmp/impact-gate-recovery-evidence/w3/pr38048/base-inventory/e2e-tests/cypress/tests/integration/channels/messaging/draft_with_only_2_byte_characters_spec.js
- Existing test: /private/tmp/impact-gate-recovery-evidence/w3/pr38048/base-inventory/e2e-tests/cypress/tests/integration/channels/messaging/long_draft_spec.js
- Existing test: /private/tmp/impact-gate-recovery-evidence/w3/pr38048/base-inventory/e2e-tests/cypress/tests/integration/channels/messaging/message_draft_persistance_spec.js
- Existing test: /private/tmp/impact-gate-recovery-evidence/w3/pr38048/base-inventory/e2e-tests/cypress/tests/integration/channels/messaging/message_draft_spec.js
- Existing test: /private/tmp/impact-gate-recovery-evidence/w3/pr38048/base-inventory/e2e-tests/cypress/tests/integration/channels/messaging/message_draft_then_switch_channel_spec.js
- Existing test: /private/tmp/impact-gate-recovery-evidence/w3/pr38048/base-inventory/e2e-tests/cypress/tests/integration/channels/messaging/message_draft_with_attachment_then_switch_channel_spec.js
- Changed: server/channels/app/draft.go

### Defect Risk: 🟢 0.19 (LOW)

- change entropy (scattered vs focused) (0.5286874763341378) (entropy: 0.5286874763341378)
- developers who touched these files (27) (ndev: 27)
- cognitive complexity increase (30) (cognitive_delta: 30)

<details><summary>Metrics</summary>

- Changed files: 14
- Impacted flows: 6 (3 Playwright associated, 0 Cypress associated, 3 without specs)
- Coverage gaps: 0
- Confidence: 95%

</details>

---
*Generated by [impact-gate](https://yasserfaraazkhan.github.io/impact-gate/) defect prediction engine*
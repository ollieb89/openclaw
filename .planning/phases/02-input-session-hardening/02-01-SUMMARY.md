---
phase: 02-input-session-hardening
plan: 01
subsystem: security
tags: [input-screening, prompt-injection, weighted-scoring, per-channel-sensitivity, zod]

# Dependency graph
requires:
  - phase: 01-foundation-repo-hygiene
    provides: "emitSecurityEvent, detectSuspiciousPatterns, security event types"
provides:
  - "screenInput() function for scored input detection with per-channel sensitivity"
  - "InputDetectionConfig type and Zod schema for security.inputDetection"
  - "Pipeline integration screening all inbound channel messages before agent processing"
affects: [02-02-PLAN, phase-03, phase-05]

# Tech tracking
tech-stack:
  added: []
  patterns: ["weighted scoring with clamped composite (0.0-1.0)", "per-channel sensitivity thresholds (lenient/moderate/strict)", "action escalation (allow/log/warn/block)"]

key-files:
  created:
    - src/security/input-screening.ts
    - src/security/input-screening.test.ts
    - src/config/types.security.ts
    - src/config/zod-schema.security.ts
  modified:
    - src/security/external-content.ts
    - src/security/external-content.test.ts
    - src/config/zod-schema.ts
    - src/config/types.ts
    - src/config/types.openclaw.ts
    - src/config/schema.hints.ts
    - src/config/schema.labels.ts
    - src/config/schema.help.ts
    - src/auto-reply/reply/get-reply.ts
    - src/cron/isolated-agent/run.ts

key-decisions:
  - "Weighted scoring: patterns assigned 0.1-0.5 weights summed and clamped to 1.0, replacing binary match/no-match"
  - "Three sensitivity levels (lenient/moderate/strict) with distinct threshold bands for log/warn/block"
  - "Screening placed after session init in getReplyFromConfig, before any directive or agent processing"
  - "Hook and cron sessions bypass screening as trusted internal messages"

patterns-established:
  - "Sensitivity-gated screening: score x sensitivity -> action, with security events only for non-allow"
  - "Config extensibility: security.inputDetection in openclaw.json with per-channel overrides"

# Metrics
duration: 9min
completed: 2026-02-15
---

# Phase 2 Plan 1: Scored Input Detection Summary

**Weighted input screening with per-channel sensitivity (lenient/moderate/strict) and pipeline integration blocking/warning before agent processing**

## Performance

- **Duration:** 9 min
- **Started:** 2026-02-15T22:31:27Z
- **Completed:** 2026-02-15T22:40:56Z
- **Tasks:** 2
- **Files modified:** 14

## Accomplishments
- Converted `detectSuspiciousPatterns` from binary matching to weighted scoring (0.0-1.0 composite score)
- Created `screenInput()` with per-channel sensitivity resolution and action escalation (allow/log/warn/block)
- Added `SecurityConfig` type and Zod schema for `security.inputDetection` with per-channel overrides
- Wired screening into `getReplyFromConfig` so every inbound channel message is screened before agent processing
- Hook/cron sessions bypass screening as trusted internal messages

## Task Commits

Each task was committed atomically:

1. **Task 1: Create scored input detection and per-channel config schema** - `456077517` (feat)
2. **Task 2: Wire input screening into inbound message pipeline** - `67cd64d22` (feat)

## Files Created/Modified
- `src/security/input-screening.ts` - screenInput function, sensitivity types, threshold config
- `src/security/input-screening.test.ts` - 15 unit tests for scored detection and screening
- `src/config/types.security.ts` - TypeScript types for security config section
- `src/config/zod-schema.security.ts` - Zod validation schema for security config
- `src/security/external-content.ts` - Updated detectSuspiciousPatterns to weighted scoring
- `src/security/external-content.test.ts` - Updated tests for new return type, added score tests
- `src/config/zod-schema.ts` - Added security schema to root config
- `src/config/types.ts` - Re-exported security types
- `src/config/types.openclaw.ts` - Added security field to OpenClawConfig
- `src/config/schema.hints.ts` - Added Security group label and order
- `src/config/schema.labels.ts` - Added security config field labels
- `src/config/schema.help.ts` - Added security config field help text
- `src/auto-reply/reply/get-reply.ts` - Wired screenInput into inbound message flow
- `src/cron/isolated-agent/run.ts` - Fixed caller for new detectSuspiciousPatterns return type

## Decisions Made
- Weighted scoring: patterns assigned 0.1-0.5 weights summed and clamped to 1.0, replacing binary match/no-match
- Three sensitivity levels (lenient/moderate/strict) with distinct threshold bands for log/warn/block
- Screening placed after session init in getReplyFromConfig, before any directive or agent processing
- Hook and cron sessions bypass screening as trusted internal messages

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed additional caller of detectSuspiciousPatterns in cron/isolated-agent**
- **Found during:** Task 1 (typecheck verification)
- **Issue:** `src/cron/isolated-agent/run.ts` called `detectSuspiciousPatterns` and expected `string[]` return, but new signature returns `{ matches, score }`
- **Fix:** Destructured return value to extract `matches` array
- **Files modified:** src/cron/isolated-agent/run.ts
- **Verification:** typecheck passes
- **Committed in:** 456077517 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary fix for breaking API change. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Input screening pipeline is active and configurable via `security.inputDetection` in openclaw.json
- Ready for Plan 02 (session hardening) which can build on the security config foundation
- Per-channel sensitivity enables different screening for owner DMs vs public channels

---
*Phase: 02-input-session-hardening*
*Completed: 2026-02-15*

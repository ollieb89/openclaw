---
phase: 01-foundation-repo-hygiene
plan: 02
subsystem: security
tags: [security-events, logging, subsystem-logger, injection-detection, auth, tool-policy]

# Dependency graph
requires:
  - phase: none
    provides: existing SubsystemLogger infrastructure in src/logging/subsystem.ts
provides:
  - SecurityEvent type and SecurityEventType/SecurityEventSeverity unions
  - emitSecurityEvent() function wrapping SubsystemLogger
  - Security event emission at auth, tool policy, and injection detection paths
affects: [audit-infra, observability, security-hardening]

# Tech tracking
tech-stack:
  added: []
  patterns: [structured-security-events, severity-based-log-routing]

key-files:
  created:
    - src/security/events.ts
    - src/security/event-logger.ts
    - src/security/event-logger.test.ts
  modified:
    - src/gateway/auth.ts
    - src/agents/tool-policy.ts
    - src/security/external-content.ts

key-decisions:
  - "Used emitAuthEvent helper pattern in auth.ts to wrap all return points without restructuring the function"
  - "Instrumented applyOwnerOnlyToolPolicy for tool deny events rather than downstream policy filtering"
  - "Added injection detection to wrapExternalContent as the primary entry point for external content processing"

patterns-established:
  - "Security event pattern: create typed event, call emitSecurityEvent() with severity routing to SubsystemLogger"
  - "Severity routing: critical -> error(), warn -> warn(), info -> info()"

# Metrics
duration: 7min
completed: 2026-02-15
---

# Phase 1 Plan 2: Security Event Logging Summary

**Typed security event system with emitSecurityEvent() routing through SubsystemLogger, instrumented at gateway auth, owner-only tool policy, and injection detection paths**

## Performance

- **Duration:** 7 min
- **Started:** 2026-02-15T22:01:22Z
- **Completed:** 2026-02-15T22:08:02Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- SecurityEvent types (events.ts) with 7 event types, 3 severity levels, and structured metadata
- emitSecurityEvent function (event-logger.ts) wrapping createSubsystemLogger("security") with severity-based routing
- 7 passing tests verifying severity routing, message formatting, and field handling
- Auth path instrumented: success/failure/rate-limited events emitted from authorizeGatewayConnect
- Tool policy path instrumented: tool.denied events emitted when owner-only tools are blocked for non-owners
- Injection detection path instrumented: injection.detected events emitted when suspicious patterns found in external content

## Task Commits

Each task was committed atomically:

1. **Task 1: Create security event types and logger** - `d2c3bcb9f` (feat)
2. **Task 2: Instrument auth, tool policy, and injection detection paths** - `629f6c469` (feat)

## Files Created/Modified
- `src/security/events.ts` - SecurityEvent type, SecurityEventType union, SecurityEventSeverity union
- `src/security/event-logger.ts` - emitSecurityEvent function wrapping SubsystemLogger
- `src/security/event-logger.test.ts` - 7 tests for security event emission
- `src/gateway/auth.ts` - Added emitSecurityEvent calls at all auth result points
- `src/agents/tool-policy.ts` - Added emitSecurityEvent calls when owner-only tools denied
- `src/security/external-content.ts` - Added emitSecurityEvent calls when injection patterns detected

## Decisions Made
- Used `emitAuthEvent` helper pattern in auth.ts to wrap all return points cleanly without restructuring the function flow
- Instrumented `applyOwnerOnlyToolPolicy` in tool-policy.ts as the clear security boundary (deny events only, not allow events, to avoid noise)
- Added injection detection emission to `wrapExternalContent` since it is the primary entry point for wrapping external content, and `detectSuspiciousPatterns` was not called from within external-content.ts itself

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- `bun run check` has pre-existing type errors in extensions/ and ui/ directories (missing third-party type declarations). These are not related to this plan's changes. All src/security, src/gateway/auth, and src/agents/tool-policy files are type-error free.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Security event types and logger are ready for use by future plans
- Additional event types can be added to SecurityEventType union as needed
- The emitSecurityEvent pattern is established for other security-relevant code paths

## Self-Check: PASSED

- All 6 files verified present on disk
- Commit d2c3bcb9f (Task 1) verified in git log
- Commit 629f6c469 (Task 2) verified in git log
- 5142 tests passing across 728 test files

---
*Phase: 01-foundation-repo-hygiene*
*Completed: 2026-02-15*

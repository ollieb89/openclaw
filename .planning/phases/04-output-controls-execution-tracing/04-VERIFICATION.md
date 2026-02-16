---
phase: 04-output-controls-execution-tracing
verified: 2026-02-16T01:09:00Z
status: passed
score: 5/5 must-haves verified
re_verification: false
---

# Phase 04: Output Controls & Execution Tracing Verification Report

**Phase Goal:** Agent responses conform to per-channel content policies and every tool execution chain is traceable end-to-end.

**Verified:** 2026-02-16T01:09:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                                                                                                                                    | Status     | Evidence                                                                                                                                                                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Per-channel Content Security Policy rules are configurable with defaultRules and per-channel overrides                                                                                                  | ✓ VERIFIED | SecurityConfig.outputPolicy in types.security.ts with OutputCspRuleId array; resolveChannelOutputRules implements case-insensitive lookup with default fallback        |
| 2   | Reply text is filtered through CSP rules before delivery (in normalizeReplyPayload, before chunking)                                                                                                    | ✓ VERIFIED | applyOutputCsp called at line 78 of normalize-reply.ts after sanitizeUserFacingText, before LINE directives and chunking; optional outputCspRules parameter           |
| 3   | Content stripped by CSP rules emits a security event with ruleId, matches, and channel                                                                                                                  | ✓ VERIFIED | Security events emitted for each stripped rule with eventType "output.csp.stripped", ruleId, matchCount, originalMatches (up to 5), channel, and sessionKey           |
| 4   | Every inbound message gets a root trace context with W3C-format trace-id (32-hex) and span-id (16-hex)                                                                                                  | ✓ VERIFIED | createRootTrace + setTraceContextForRun called in both agent-runner-execution.ts (line 90-91) and gateway/server-methods/agent.ts (line 453-455) at run initiation    |
| 5   | Full execution chain is recoverable from logs by filtering on a single traceId, including tool calls, sub-agent spawns, and their tool calls                                                            | ✓ VERIFIED | trace.tool.call events include traceId/spanId/parentSpanId; sub-agent spawns propagate traceId via sessions-spawn-tool; SubagentRunRecord.traceId persisted to disk   |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact                                    | Expected                                                                          | Status     | Details                                                                                                  |
| ------------------------------------------- | --------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------- |
| `src/security/output-policy.ts`             | CSP rule definitions, applyOutputCsp filter, resolveChannelOutputRules           | ✓ VERIFIED | 120 lines, 6 rule types (no-external-urls, no-file-paths, no-code-blocks, no-system-info, no-api-keys, no-internal-ips), detect+redact pattern |
| `src/security/output-policy.test.ts`        | Tests for output CSP filtering                                                    | ✓ VERIFIED | 24 tests passed, covering all rules, multi-rule application, channel resolution, edge cases              |
| `src/security/trace-context.ts`             | W3C Trace Context generation, propagation, run-keyed storage                      | ✓ VERIFIED | 53 lines, TraceContext type, createTraceId/createSpanId (32/16 hex), createRootTrace/createChildSpan, run-keyed storage Map |
| `src/security/trace-context.test.ts`        | Tests for trace context generation and propagation                                | ✓ VERIFIED | 9 tests passed, covering ID generation, root/child spans, storage, W3C format                            |
| `src/config/types.security.ts`              | Extended SecurityConfig with outputPolicy section                                 | ✓ VERIFIED | outputPolicy field with defaultRules and per-channel rules, imports OutputCspRuleId                      |
| `src/security/events.ts`                    | New event types for output CSP and trace context                                  | ✓ VERIFIED | "output.csp.stripped" and "trace.tool.call" event types added to SecurityEventType union                |
| `src/infra/agent-events.ts`                 | AgentRunContext extended with optional traceContext field                         | ✓ VERIFIED | traceContext field (plain object shape) added, merged in registerAgentRunContext                         |
| `src/agents/subagent-registry.ts`           | SubagentRunRecord extended with optional traceId field                            | ✓ VERIFIED | traceId field added to SubagentRunRecord type and registerSubagentRun params, persisted to disk          |
| `src/auto-reply/reply/normalize-reply.ts`   | CSP filtering in normalizeReplyPayload with security event emission               | ✓ VERIFIED | Optional outputCspRules/outputCspChannel/outputCspSessionKey fields in NormalizeReplyOptions, applyOutputCsp called before chunking, security events emitted |
| `src/auto-reply/reply/agent-runner-execution.ts` | Root trace creation at auto-reply agent run initiation                       | ✓ VERIFIED | createRootTrace + setTraceContextForRun called at line 90-91, traceContext passed to registerAgentRunContext |
| `src/gateway/server-methods/agent.ts`       | Root trace creation at gateway agent run initiation                               | ✓ VERIFIED | createRootTrace + setTraceContextForRun called at line 453-455, traceContext passed to registerAgentRunContext |
| `src/agents/pi-embedded-subscribe.handlers.tools.ts` | Child span creation and trace.tool.call security events for tool calls  | ✓ VERIFIED | getTraceContextForRun + createChildSpan at tool execution start, security event with traceId/spanId/parentSpanId emitted |
| `src/agents/tools/sessions-spawn-tool.ts`   | Trace propagation to child sub-agent runs                                         | ✓ VERIFIED | getTraceContextForRun + createChildSpan + setTraceContextForRun, traceId passed to registerSubagentRun  |

### Key Link Verification

| From                                        | To                                | Via                                                      | Status     | Details                                                                                                  |
| ------------------------------------------- | --------------------------------- | -------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------- |
| normalize-reply.ts                          | output-policy.ts                  | applyOutputCsp call in normalizeReplyPayload             | ✓ WIRED    | Import at line 4, call at line 78 with opts.outputCspRules                                               |
| normalize-reply.ts                          | event-logger.ts                   | emitSecurityEvent for CSP violations                     | ✓ WIRED    | Import at line 3, call at line 81 with output.csp.stripped event type                                    |
| types.security.ts                           | output-policy.ts                  | OutputCspRuleId type imported and used in SecurityConfig | ✓ WIRED    | Import at line 1, used in outputPolicy.defaultRules and channels rules                                   |
| agent-runner-execution.ts                   | trace-context.ts                  | createRootTrace + setTraceContextForRun at run creation  | ✓ WIRED    | Import at line 30, calls at lines 90-91                                                                  |
| gateway/server-methods/agent.ts             | trace-context.ts                  | createRootTrace + setTraceContextForRun at run creation  | ✓ WIRED    | Import at line 15, calls at lines 453-455                                                                |
| pi-embedded-subscribe.handlers.tools.ts     | trace-context.ts                  | getTraceContextForRun + createChildSpan for tool spans   | ✓ WIRED    | Import at line 9, calls at lines 102-103 in handleToolExecutionStart                                     |
| pi-embedded-subscribe.handlers.tools.ts     | event-logger.ts                   | emitSecurityEvent for trace.tool.call events             | ✓ WIRED    | Import at line 10, call at line 105 with traceId/spanId/parentSpanId in meta                            |
| sessions-spawn-tool.ts                      | trace-context.ts                  | getTraceContextForRun + createChildSpan + setTraceContextForRun for spawn propagation | ✓ WIRED | Import at lines 18-20, calls at lines 277-278, 322                                   |
| sessions-spawn-tool.ts                      | subagent-registry.ts              | registerSubagentRun with traceId parameter               | ✓ WIRED    | registerSubagentRun call at line 325 with traceId: childTrace?.traceId                                   |

### Requirements Coverage

Phase 04 Success Criteria from ROADMAP.md:

| Requirement                                                                                                                                                                                                | Status       | Supporting Truths/Artifacts                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| 1. Per-channel Content Security Policy rules are configurable in gateway config (e.g., no external URLs in public channels, no file paths in Discord) and the agent's response is filtered before delivery | ✓ SATISFIED  | Truth 1, 2: SecurityConfig.outputPolicy, resolveChannelOutputRules, applyOutputCsp in normalizeReplyPayload before chunking   |
| 2. Content stripped by output CSP rules generates a security event with the original content, the rule that triggered, and the channel                                                                     | ✓ SATISFIED  | Truth 3: output.csp.stripped events with ruleId, matchCount, originalMatches (up to 5), channel, sessionKey                   |
| 3. Every tool call carries a W3C Trace Context ID that propagates through sub-agent spawns, and the full execution chain is recoverable from security logs using a single trace ID                         | ✓ SATISFIED  | Truth 4, 5: Root trace at message ingestion, child spans at tool calls, trace propagation through sessions-spawn, trace.tool.call events with traceId/spanId/parentSpanId |
| 4. Trace IDs appear in security log entries for tool calls, enabling post-hoc reconstruction of "message received -> tool A called -> sub-agent spawned -> tool B called -> response sent"                 | ✓ SATISFIED  | Truth 5: trace.tool.call events include traceId/spanId/parentSpanId in meta, SubagentRunRecord.traceId persisted              |

### Anti-Patterns Found

**None** — All key files are production-ready implementations with no TODOs, FIXMEs, placeholders, or stub implementations.

Scanned files:
- src/security/output-policy.ts (120 lines) — ✓ Clean
- src/security/trace-context.ts (53 lines) — ✓ Clean
- src/auto-reply/reply/normalize-reply.ts — ✓ Clean integration
- src/agents/pi-embedded-subscribe.handlers.tools.ts — ✓ Clean integration
- src/agents/tools/sessions-spawn-tool.ts — ✓ Clean integration
- src/auto-reply/reply/agent-runner-execution.ts — ✓ Clean integration
- src/gateway/server-methods/agent.ts — ✓ Clean integration

### Human Verification Required

**None** — All verifications are programmatically complete.

The following aspects have been verified through code inspection and automated tests:

1. **Output CSP filtering** — 24 automated tests covering all 6 rule types, multi-rule application, channel resolution, and edge cases (localhost/RFC1918 exclusions)
2. **Trace context generation** — 9 automated tests covering W3C-format ID generation, root/child span creation, storage, and format validation
3. **Wiring verification** — Imports and function calls verified through grep pattern matching at all integration points
4. **Type safety** — No type errors in Phase 04 files (verified via tsgo)
5. **Commit verification** — All 4 task commits exist in git history

**No manual testing required** — All observable truths are verifiable through code inspection, automated tests, and security event emission patterns.

---

## Verification Details

### Plan 04-01: Output CSP

**Objective:** Add per-channel Content Security Policy (CSP) rules that filter agent reply text before delivery.

**Artifacts verified:**
- ✓ src/security/output-policy.ts — 120 lines, 6 rule types, applyOutputCsp filter, resolveChannelOutputRules
- ✓ src/security/output-policy.test.ts — 24 tests passed
- ✓ src/config/types.security.ts — SecurityConfig.outputPolicy with defaultRules and per-channel overrides
- ✓ src/security/events.ts — output.csp.stripped and trace.tool.call event types
- ✓ src/auto-reply/reply/normalize-reply.ts — applyOutputCsp called at line 78, security events emitted

**Key decisions validated:**
- ✓ CSP placed after sanitizeUserFacingText, before LINE directives and chunking (line 78)
- ✓ Fail-open delivery (redacted text sent) with fail-loud logging (security events emitted)
- ✓ Regex-based rule definitions with detect+redact pattern
- ✓ Channel resolution pattern: case-insensitive lookup with default fallback (matches input-screening)

**Test coverage:**
- ✓ All 6 rule types tested (no-external-urls, no-file-paths, no-code-blocks, no-system-info, no-api-keys, no-internal-ips)
- ✓ Multi-rule application tested
- ✓ Channel resolution with overrides and defaults tested
- ✓ Edge cases: localhost/127.0.0.1/RFC1918 exclusion for no-external-urls tested
- ✓ Unix and Windows path detection tested
- ✓ Fenced code blocks with/without language tags tested

### Plan 04-02: Execution Tracing

**Objective:** Add W3C Trace Context generation and propagation for end-to-end execution chain tracing.

**Artifacts verified:**
- ✓ src/security/trace-context.ts — 53 lines, W3C-format IDs (32-hex trace-id, 16-hex span-id), root/child span creation, run-keyed storage
- ✓ src/security/trace-context.test.ts — 9 tests passed
- ✓ src/infra/agent-events.ts — AgentRunContext.traceContext field added
- ✓ src/agents/subagent-registry.ts — SubagentRunRecord.traceId field added, persisted to disk
- ✓ Root trace creation at both initiation sites:
  - src/auto-reply/reply/agent-runner-execution.ts (line 90-91)
  - src/gateway/server-methods/agent.ts (line 453-455)
- ✓ Child span creation at tool execution (pi-embedded-subscribe.handlers.tools.ts, line 102-103)
- ✓ Trace propagation through sub-agent spawn (sessions-spawn-tool.ts, lines 277-278, 322)
- ✓ Security events for tool calls with traceId/spanId/parentSpanId (line 105)

**Key decisions validated:**
- ✓ Run-keyed trace storage in separate Map (traceByRunId) parallel to agent-events to avoid circular imports
- ✓ Plain object shape for traceContext in AgentRunContext (no type import) to avoid cross-module dependency
- ✓ RunId threaded through createOpenClawTools/createOpenClawCodingTools for spawn trace propagation (deviation auto-fixed in Task 2)

**Test coverage:**
- ✓ createTraceId returns 32-char hex string
- ✓ createSpanId returns 16-char hex string
- ✓ createRootTrace returns TraceContext with no parentSpanId
- ✓ createChildSpan preserves traceId, creates new spanId, sets parentSpanId
- ✓ formatTraceparent returns W3C format (00-{traceId}-{spanId}-01)
- ✓ Run-keyed storage round-trip (set/get/clear)
- ✓ ID randomness (two successive calls return different values)

**Deviations:**
- Auto-fixed (blocking): Threaded runId through tool creation chain (sessions-spawn-tool.ts, openclaw-tools.ts, pi-tools.ts, pi-embedded-runner/run/attempt.ts) to enable spawn-time trace context lookup without architectural changes. Added optional runId parameter to 4 function signatures. Minimal scope change, no impact on plan objectives.

---

## Summary

**Phase 04 Goal:** Agent responses conform to per-channel content policies and every tool execution chain is traceable end-to-end.

**Achievement:** ✓ COMPLETE

**Evidence:**

1. **Output CSP (Plan 04-01):** Per-channel content security policies are configurable via SecurityConfig.outputPolicy with 6 rule types. Reply text is filtered through applyOutputCsp before chunking, with security events emitted for each stripped rule. 24 automated tests pass. All key links verified (normalize-reply → output-policy → event-logger).

2. **Execution Tracing (Plan 04-02):** Root traces are created at both agent run initiation sites (auto-reply and gateway) with W3C-format IDs. Child spans are created for every tool call, with trace.tool.call security events including traceId/spanId/parentSpanId. Sub-agent spawns propagate the parent trace via sessions-spawn-tool, with traceId persisted in SubagentRunRecord. Full execution chain is recoverable from logs by filtering on a single traceId. 9 automated tests pass. All key links verified (root creation → tool span creation → sub-agent propagation → security event emission).

**Test Results:**
- src/security/output-policy.test.ts: 24/24 passed
- src/security/trace-context.test.ts: 9/9 passed
- Type check: No errors in Phase 04 files
- Anti-patterns: None found

**Commits Verified:**
- 6ac7ed355 — feat(04-01): add output CSP module with 6 rule types and channel resolution
- 0fdb7a662 — feat(04-01): integrate CSP filter into normalizeReplyPayload
- cd6d9d262 — feat(04-02): create trace context module with W3C-format IDs and run-keyed storage
- 7d8157fcb — feat(04-02): wire trace context into root creation, tool execution, sub-agent spawns, and security events

**Status:** Phase goal fully achieved. All success criteria satisfied. Ready to proceed.

---

_Verified: 2026-02-16T01:09:00Z_
_Verifier: Claude (gsd-verifier)_

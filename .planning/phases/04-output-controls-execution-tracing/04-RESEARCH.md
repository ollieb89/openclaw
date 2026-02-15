# Phase 4: Output Controls & Execution Tracing - Research

**Researched:** 2026-02-16
**Domain:** Per-channel output content security policy, W3C Trace Context propagation through agent/sub-agent tool chains
**Confidence:** HIGH

## Summary

Phase 4 has two distinct deliverables: (1) per-channel Content Security Policy (CSP) rules that filter agent responses before delivery (OUTP-01) and (2) W3C Trace Context IDs that propagate through the entire tool execution chain including sub-agent spawns (TOOL-01). Both are security infrastructure -- one restricts what leaves the system, the other enables forensic reconstruction of what happened inside it.

For output CSP, the codebase has a clean interception point in the reply delivery pipeline. Replies flow through `normalizeReplyPayload()` in `src/auto-reply/reply/normalize-reply.ts` (which already sanitizes text, strips heartbeat tokens, and handles silent replies) before reaching the channel-specific outbound adapter. The `ReplyPayload` type is minimal (`text`, `mediaUrl`, `mediaUrls`, `channelData`) and the `ReplyDispatcher` in `src/auto-reply/reply/reply-dispatcher.ts` funnels all three delivery modes (`sendToolResult`, `sendBlockReply`, `sendFinalReply`) through a single `normalizeReplyPayloadInternal()` path. This is the natural insertion point for output CSP filtering. The config system already supports per-channel settings (`security.inputDetection.channels` from Phase 2) so extending `SecurityConfig` with an `outputPolicy` section follows established patterns. The `emitSecurityEvent()` function from Phase 1 already has a `policy.violation` event type that fits CSP stripping events.

For trace context, the codebase currently has NO W3C trace context or distributed tracing infrastructure. Tool calls carry provider-assigned `toolCallId` values (sanitized in `src/agents/tool-call-id.ts`), and agent runs have `runId` values (UUID-based, visible in `AgentEventPayload`). Sub-agent spawns via `sessions_spawn` generate a `childRunId` and call the gateway, but there is no parent-child trace linking. The `SubagentRunRecord` tracks `requesterSessionKey` and `childSessionKey` but not a trace lineage. Security events carry `sessionKey` and `channel` but no trace ID. The W3C Trace Context specification defines a `traceparent` header format: `{version}-{trace-id}-{parent-id}-{trace-flags}` where trace-id is 32 hex chars and parent-id is 16 hex chars. Since this is an in-process system (not HTTP microservices), we adapt the format for internal propagation rather than HTTP headers.

The Pi agent runtime (`@mariozechner/pi-agent-core`) is an external dependency that cannot be modified. Tool calls flow through `handleToolExecutionStart()` in `src/agents/pi-embedded-subscribe.handlers.tools.ts`, which receives `toolCallId` from the runtime. The `wrapToolWithBeforeToolCallHook()` function in `src/agents/pi-tools.before-tool-call.ts` wraps tool execution, providing a hook point where trace context can be injected. Sub-agent spawns go through `sessions_spawn` tool -> `callGateway()` -> new agent run. The gateway assigns a new `runId`. Trace context needs to propagate from the parent run's context through the gateway call to the child run.

**Primary recommendation:** (1) Add a `security.outputPolicy` config section with per-channel CSP rules (arrays of rule types like `noExternalUrls`, `noFilePaths`, `noCodeBlocks`, `noSystemInfo`), implement a filtering function applied in `normalizeReplyPayload()`, and emit `policy.violation` security events with original content/rule/channel metadata. (2) Create a trace context module that generates W3C-format trace IDs per inbound message, propagates them through `runId`-keyed context maps, threads them into tool execution and sub-agent spawns via existing hook/registry infrastructure, and attaches them to security log entries.

## Standard Stack

### Core

No new external dependencies needed. All infrastructure exists in the codebase.

| Component | Location | Purpose | Why Standard |
|-----------|----------|---------|--------------|
| normalizeReplyPayload | `src/auto-reply/reply/normalize-reply.ts` | Output CSP filter insertion point | All replies pass through here before delivery |
| ReplyDispatcher | `src/auto-reply/reply/reply-dispatcher.ts` | Funnels all delivery modes | Single normalization path for tool/block/final replies |
| SecurityConfig | `src/config/types.security.ts` | Config for output policy rules | Already has `inputDetection`; extend with `outputPolicy` |
| emitSecurityEvent | `src/security/event-logger.ts` | Log CSP violations | Already has `policy.violation` event type |
| SubsystemLogger | `src/logging/subsystem.ts` | Structured logging with metadata | Standard logging pattern for trace IDs |
| AgentEventPayload | `src/infra/agent-events.ts` | Agent run events with `runId` | Natural place to attach trace context |
| SubagentRunRecord | `src/agents/subagent-registry.ts` | Sub-agent spawn tracking | Extend with trace ID to link parent-child chains |
| handleToolExecutionStart | `src/agents/pi-embedded-subscribe.handlers.tools.ts` | Tool call interception | Where trace context enters tool execution flow |
| sessions_spawn tool | `src/agents/tools/sessions-spawn-tool.ts` | Sub-agent creation | Where trace context propagates to child runs |

### Supporting

| Component | Location | Purpose | When to Use |
|-----------|----------|---------|-------------|
| tool-call-id.ts | `src/agents/tool-call-id.ts` | Tool call ID utilities | Reference for ID format conventions |
| input-screening.ts | `src/security/input-screening.ts` | Phase 2 per-channel screening | Pattern for per-channel security config |
| zod-schema.ts | `src/config/zod-schema.ts` | Config validation | Extend schema for new config sections |
| node:crypto | (builtin) | randomUUID, randomBytes | Trace ID and span ID generation |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom trace context | OpenTelemetry SDK | Full OTel SDK is heavy (~2MB), requires collector infrastructure; overkill for a local gateway with file-based logs. Custom W3C-format IDs give compatibility without the dependency |
| Regex-based content filters | AST parsing of response content | Regex is sufficient for URL/path/code-block detection; AST parsing adds complexity without proportional benefit for text filtering |
| Per-rule string matching | ML-based content classification | Too complex for v1; rule-based filters are transparent, deterministic, and auditable |
| In-process trace propagation | AsyncLocalStorage | AsyncLocalStorage is Node.js-native and could work, but the existing `runId`-keyed context map pattern (`AgentRunContext`, `runContextById`) is already established; extending it is lower risk than introducing ALS |

**Installation:** No new packages needed.

## Architecture Patterns

### Recommended Project Structure

```
src/
├── security/
│   ├── events.ts                  # MODIFY: Add output.csp.stripped event type
│   ├── event-logger.ts            # EXISTING: emitSecurityEvent()
│   ├── output-policy.ts           # NEW: CSP rule definitions, filter function
│   ├── output-policy.test.ts      # NEW: Tests for output filtering
│   ├── trace-context.ts           # NEW: W3C Trace Context generation/propagation
│   └── trace-context.test.ts      # NEW: Tests for trace context
├── config/
│   └── types.security.ts          # MODIFY: Add outputPolicy section
├── auto-reply/reply/
│   └── normalize-reply.ts         # MODIFY: Add output CSP filter call
├── agents/
│   ├── subagent-registry.ts       # MODIFY: Add traceId to SubagentRunRecord
│   ├── tools/sessions-spawn-tool.ts # MODIFY: Propagate trace context to child
│   └── pi-embedded-subscribe.handlers.tools.ts # MODIFY: Attach trace context to tool events
└── infra/
    └── agent-events.ts            # MODIFY: Add traceId/spanId to AgentEventPayload
```

### Pattern 1: Output Content Security Policy Filter

**What:** A pipeline of configurable rules applied to reply text before channel delivery. Each rule is a predicate function that detects disallowed content patterns, strips or redacts them, and emits a security event.

**When to use:** Every outbound reply, applied in `normalizeReplyPayload()`.

**Example:**
```typescript
// src/security/output-policy.ts

export type OutputCspRuleId =
  | "no-external-urls"
  | "no-file-paths"
  | "no-code-blocks"
  | "no-system-info"
  | "no-api-keys"
  | "no-internal-ips";

export type OutputCspRule = {
  id: OutputCspRuleId;
  detect: (text: string) => { matched: boolean; matches: string[] };
  redact: (text: string) => string;
};

export type OutputCspConfig = {
  defaultRules?: OutputCspRuleId[];
  channels?: Record<string, { rules?: OutputCspRuleId[] }>;
};

export type OutputCspResult = {
  text: string;
  strippedRules: Array<{ ruleId: OutputCspRuleId; matches: string[] }>;
};

export function applyOutputCsp(
  text: string,
  rules: OutputCspRuleId[],
): OutputCspResult {
  let result = text;
  const strippedRules: OutputCspResult["strippedRules"] = [];

  for (const ruleId of rules) {
    const rule = RULES.get(ruleId);
    if (!rule) continue;
    const detection = rule.detect(result);
    if (detection.matched) {
      result = rule.redact(result);
      strippedRules.push({ ruleId, matches: detection.matches });
    }
  }

  return { text: result, strippedRules };
}
```

### Pattern 2: W3C Trace Context Generation and Propagation

**What:** Generate a trace-id per inbound message, create span-ids per tool call, propagate trace context through sub-agent spawns via the existing run context and subagent registry infrastructure.

**When to use:** Every inbound message starts a trace; every tool call creates a span; sub-agent spawns create child spans with the same trace-id.

**Example:**
```typescript
// src/security/trace-context.ts
import crypto from "node:crypto";

export type TraceContext = {
  traceId: string;    // 32 hex chars
  spanId: string;     // 16 hex chars
  parentSpanId?: string; // 16 hex chars, undefined for root
};

const VERSION = "00";
const TRACE_FLAGS = "01"; // sampled

export function createTraceId(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function createSpanId(): string {
  return crypto.randomBytes(8).toString("hex");
}

export function formatTraceparent(ctx: TraceContext): string {
  return `${VERSION}-${ctx.traceId}-${ctx.spanId}-${TRACE_FLAGS}`;
}

export function createRootTrace(): TraceContext {
  return { traceId: createTraceId(), spanId: createSpanId() };
}

export function createChildSpan(parent: TraceContext): TraceContext {
  return {
    traceId: parent.traceId,
    spanId: createSpanId(),
    parentSpanId: parent.spanId,
  };
}
```

### Pattern 3: Trace Context Propagation via Existing Infrastructure

**What:** Thread trace context through the existing `AgentRunContext` map (keyed by `runId`), the `SubagentRunRecord` (child spawn registry), and security event `meta` fields. This avoids introducing `AsyncLocalStorage` or major architectural changes.

**When to use:** The trace context map is the primary propagation mechanism.

**Propagation path:**
```
1. Inbound message → createRootTrace() → store in run context by runId
2. Agent run starts → read trace from run context
3. Tool call starts → createChildSpan(parentTrace) → attach to tool event
4. Sub-agent spawn → pass parent trace as extra param in callGateway()
   → child run reads parent trace → createChildSpan() for child root
5. Security events → include traceId + spanId in meta field
6. Log queries → filter by traceId to reconstruct full chain
```

### Anti-Patterns to Avoid

- **Global mutable trace context:** Don't use a module-level singleton for "current trace". Multiple concurrent runs share the same process. Always key trace context by `runId`.
- **Modifying Pi runtime internals:** The Pi agent core is an external dependency. Don't try to patch `toolCallId` values to embed trace IDs. Instead, maintain a parallel mapping from `toolCallId` to trace span.
- **Blocking output on CSP failures:** CSP filtering should be fail-open for delivery (still send the reply, just redacted) but fail-loud for logging (always emit the security event). Never block message delivery entirely due to a CSP rule match -- the user must still receive a response.
- **Over-filtering:** CSP rules should target specific patterns, not perform broad content analysis. A rule like "no-external-urls" should detect `https?://` patterns, not try to classify whether content is "safe".

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Trace ID generation | Custom UUID-based format | W3C Trace Context format (`{version}-{trace-id}-{parent-id}-{flags}`) | Standard format enables future OTel integration; `crypto.randomBytes(16).toString("hex")` matches the 32-char trace-id spec |
| URL detection in output | Custom regex from scratch | Well-tested URL regex patterns (RFC 3986 reference) | URL parsing has many edge cases (IDN, punycode, port numbers, query strings) |
| Distributed tracing SDK | Full OpenTelemetry integration | Lightweight custom W3C-format IDs with in-process propagation | OTel SDK would add ~2MB, require a collector, and change the logging architecture |
| Per-channel config resolution | Custom channel matching logic | Existing `resolveChannelSensitivity()` pattern from Phase 2 | Reuse the established per-channel config resolution with case-insensitive lookup and default fallback |

**Key insight:** The trace context system is intentionally minimal -- it only needs to generate IDs in a standard format and propagate them through existing data structures. The logging infrastructure (`SubsystemLogger`, `emitSecurityEvent()`) already supports arbitrary `meta` fields, so attaching trace IDs to log entries requires no log infrastructure changes.

## Common Pitfalls

### Pitfall 1: Output CSP Applied Too Late (After Chunking)

**What goes wrong:** If CSP filtering runs after the reply is chunked for channel delivery (e.g., after the 2000-char Discord split), a URL could span a chunk boundary and escape detection.
**Why it happens:** The chunking pipeline in `BlockReplyPipeline` splits text before final delivery.
**How to avoid:** Apply CSP in `normalizeReplyPayload()`, which runs BEFORE chunking. The normalize step is the first transformation applied to reply text.
**Warning signs:** CSP tests pass on short text but fail on text longer than channel chunk limits.

### Pitfall 2: Trace Context Lost at Gateway Boundary

**What goes wrong:** Sub-agent spawns call `callGateway()` which sends an RPC to the gateway process. If trace context is only stored in-process (Map keyed by runId), the child run on the gateway side won't have it.
**Why it happens:** `callGateway()` is an inter-process boundary. The child run gets a new `runId`.
**How to avoid:** Pass trace context as an explicit parameter in the `callGateway()` params object (`params.traceContext`). The gateway run handler reads it and stores it in the child's run context. The `sessions_spawn` tool already passes `spawnedBy` through this boundary, so the pattern is established.
**Warning signs:** Trace chains show the root message and tool calls but sub-agent spans are disconnected.

### Pitfall 3: Regex-Based URL Detection Producing False Positives

**What goes wrong:** Overly broad URL patterns match things like `http://localhost` or code examples the agent legitimately needs to share.
**Why it happens:** "No external URLs" is ambiguous -- does `localhost` count? Does a URL in a code block count?
**How to avoid:** Define "external" precisely (not loopback, not RFC 1918, not link-local). Consider whether code-block-wrapped URLs should be exempt (configurable).
**Warning signs:** Users report useful responses being redacted in development/debugging channels.

### Pitfall 4: Security Event Spam from High-Frequency Rules

**What goes wrong:** If every chunked block reply triggers CSP evaluation and logging, high-traffic channels generate massive event volumes.
**Why it happens:** Block replies arrive in rapid succession during streaming; each triggers independent normalization.
**How to avoid:** Deduplicate CSP events within a single run (key by `runId + ruleId`). Log once per rule per run, with an aggregate count if the same rule fires multiple times.
**Warning signs:** Security log file grows at >10MB/hour during normal operation.

### Pitfall 5: Trace Context Not Reaching Security Events

**What goes wrong:** Security events (`emitSecurityEvent()`) don't include trace IDs because the calling code doesn't have access to the trace context.
**Why it happens:** `emitSecurityEvent()` is called from many places (Phase 1 security module, Phase 2 input screening, Phase 3 plugin consent). Not all callers have a `runId` to look up trace context.
**How to avoid:** Add an optional `traceId` field to the `SecurityEvent` type. When callers have a `runId`, they resolve the trace context and pass it. When they don't (e.g., config-time checks), the field is omitted. Don't require trace IDs on all security events -- only execution-time events need them.
**Warning signs:** Security events have `traceId` for tool calls but not for input screening or policy violations.

## Code Examples

### Output CSP Rule: No External URLs

```typescript
// Source: Custom pattern based on RFC 3986
const EXTERNAL_URL_RE = /https?:\/\/(?!(?:localhost|127\.0\.0\.1|::1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})(?:[:/]|$))[^\s)>\]"']+/gi;

const noExternalUrlsRule: OutputCspRule = {
  id: "no-external-urls",
  detect: (text) => {
    const matches = text.match(EXTERNAL_URL_RE) ?? [];
    return { matched: matches.length > 0, matches };
  },
  redact: (text) => text.replace(EXTERNAL_URL_RE, "[URL redacted]"),
};
```

### Output CSP Rule: No File Paths

```typescript
const FILE_PATH_RE = /(?:\/(?:home|Users|tmp|var|etc|opt|usr|root|mnt|media|srv)\/[^\s)>\]"']+|[A-Z]:\\[^\s)>\]"']+)/g;

const noFilePathsRule: OutputCspRule = {
  id: "no-file-paths",
  detect: (text) => {
    const matches = text.match(FILE_PATH_RE) ?? [];
    return { matched: matches.length > 0, matches };
  },
  redact: (text) => text.replace(FILE_PATH_RE, "[path redacted]"),
};
```

### Integrating CSP into normalizeReplyPayload

```typescript
// In src/auto-reply/reply/normalize-reply.ts
import { applyOutputCsp, resolveChannelOutputRules } from "../../security/output-policy.js";
import { emitSecurityEvent } from "../../security/event-logger.js";

// Inside normalizeReplyPayload(), after sanitizeUserFacingText():
if (text && outputPolicyConfig) {
  const rules = resolveChannelOutputRules(channel, outputPolicyConfig);
  if (rules.length > 0) {
    const cspResult = applyOutputCsp(text, rules);
    if (cspResult.strippedRules.length > 0) {
      for (const stripped of cspResult.strippedRules) {
        emitSecurityEvent({
          eventType: "output.csp.stripped",
          severity: "warn",
          channel,
          sessionKey,
          action: "redacted",
          detail: `Rule ${stripped.ruleId} matched ${stripped.matches.length} pattern(s)`,
          meta: {
            ruleId: stripped.ruleId,
            matchCount: stripped.matches.length,
            originalMatches: stripped.matches.slice(0, 5), // limit logged matches
          },
        });
      }
      text = cspResult.text;
    }
  }
}
```

### Trace Context Propagation Through Sub-Agent Spawn

```typescript
// In sessions-spawn-tool.ts, inside execute():
import { getTraceContextForRun, createChildSpan } from "../../security/trace-context.js";

// Before callGateway():
const parentTrace = getTraceContextForRun(currentRunId);
const childTrace = parentTrace ? createChildSpan(parentTrace) : undefined;

const response = await callGateway<{ runId: string }>({
  method: "agent",
  params: {
    // ...existing params...
    traceContext: childTrace ? {
      traceId: childTrace.traceId,
      spanId: childTrace.spanId,
      parentSpanId: childTrace.parentSpanId,
    } : undefined,
  },
  timeoutMs: 10_000,
});
```

### Attaching Trace Context to Security Events

```typescript
// In handleToolExecutionStart():
import { getTraceContextForRun, createChildSpan } from "../../security/trace-context.js";

const runTrace = getTraceContextForRun(ctx.params.runId);
const toolSpan = runTrace ? createChildSpan(runTrace) : undefined;

emitSecurityEvent({
  eventType: "tool.call",
  severity: "info",
  sessionKey: ctx.params.sessionKey,
  channel: ctx.params.channel,
  action: "executed",
  detail: `Tool ${toolName} called`,
  meta: {
    toolName,
    toolCallId,
    ...(toolSpan && {
      traceId: toolSpan.traceId,
      spanId: toolSpan.spanId,
      parentSpanId: toolSpan.parentSpanId,
    }),
  },
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Custom correlation IDs | W3C Trace Context (traceparent/tracestate) | W3C Rec 2020, Level 2 2024 | Standard format enables interop with any OTel-compatible tool |
| Per-service trace generation | Propagated trace-id across service boundaries | Standard since OTel GA (2021) | Single trace-id links entire distributed operation |
| Blocklist-only output filtering | Content Security Policy (rule-based + audit logging) | Adopted from browser CSP concepts | Configurable, auditable, per-context rules |
| OpenTelemetry SDK for all tracing | Lightweight W3C format IDs for local systems | Pragmatic pattern for non-distributed apps | Avoid SDK weight while maintaining format compatibility |

**Deprecated/outdated:**
- OpenTracing / OpenCensus: Merged into OpenTelemetry (2019). Don't reference these APIs.
- X-Request-Id / X-Correlation-Id headers: Superseded by W3C Trace Context `traceparent` header.

## Open Questions

1. **Should output CSP rules apply to media URLs as well as text?**
   - What we know: `ReplyPayload` has `mediaUrl` and `mediaUrls` fields. CSP rules like `no-external-urls` could also filter media.
   - What's unclear: Whether media URLs should follow the same rules or have separate policies (e.g., allow image URLs but block text URLs).
   - Recommendation: Start with text-only filtering in v1. Media URLs typically come from controlled sources (local file paths, media pipeline). Add media URL CSP as a follow-up if needed.

2. **How should trace context survive gateway restarts?**
   - What we know: `SubagentRunRecord` is persisted to disk via `saveSubagentRegistryToDisk()`. Trace context stored only in-memory (Map by runId) would be lost on restart.
   - What's unclear: Whether post-restart trace reconstruction is a Phase 4 requirement or a Phase 5 (Audit Infrastructure) concern.
   - Recommendation: Persist trace context alongside `SubagentRunRecord` for sub-agent traces. For in-flight run traces, accept that restart breaks the chain (log the restart event with the last known trace state). Phase 5 audit infrastructure can build on this.

3. **Should `normalizeReplyPayload()` receive channel context for CSP?**
   - What we know: Currently `normalizeReplyPayload()` does not receive channel or session context. It only gets the payload and display options.
   - What's unclear: The cleanest way to pass channel/session context without changing the function signature broadly.
   - Recommendation: Add an optional `outputPolicy` parameter to `NormalizeReplyOptions` containing the resolved rules for this channel. The caller (which knows the channel) resolves the rules and passes them in. This keeps the channel resolution logic in the caller (reply dispatcher) and the filtering logic in normalize.

4. **What is the right granularity for trace spans?**
   - What we know: The requirement says "every tool call carries a W3C Trace Context ID." Sub-agent spawns must propagate.
   - What's unclear: Should individual LLM API calls (to Anthropic, OpenAI, etc.) also get span IDs? What about retry attempts within the failover logic?
   - Recommendation: Phase 4 scope: spans for (a) inbound message (root), (b) each tool call, (c) sub-agent spawn (child root). LLM API call spans can be added in Phase 5 alongside the audit log infrastructure. Keep the span tree shallow for now.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `src/auto-reply/reply/normalize-reply.ts` - reply normalization pipeline
- Codebase analysis: `src/auto-reply/reply/reply-dispatcher.ts` - reply dispatch architecture
- Codebase analysis: `src/agents/pi-embedded-subscribe.handlers.tools.ts` - tool execution hooks
- Codebase analysis: `src/agents/tools/sessions-spawn-tool.ts` - sub-agent spawn flow
- Codebase analysis: `src/agents/subagent-registry.ts` - sub-agent run tracking
- Codebase analysis: `src/infra/agent-events.ts` - agent event system with runId
- Codebase analysis: `src/security/events.ts` - existing security event types
- Codebase analysis: `src/security/input-screening.ts` - Phase 2 per-channel security config pattern
- Codebase analysis: `src/config/types.security.ts` - security config structure

### Secondary (MEDIUM confidence)
- W3C Trace Context specification: https://www.w3.org/TR/trace-context/ - traceparent format (version-traceId-parentId-flags)
- W3C Trace Context Level 2: https://www.w3.org/TR/trace-context-2/ - tracestate header extensions

### Tertiary (LOW confidence)
- None. All findings are from codebase analysis and W3C specs.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new dependencies; all insertion points identified from direct codebase analysis
- Architecture (Output CSP): HIGH - clear interception point in normalizeReplyPayload, established per-channel config pattern from Phase 2
- Architecture (Trace Context): HIGH - propagation path identified through existing runId/AgentRunContext/SubagentRunRecord infrastructure; gateway boundary crossing uses established callGateway params pattern
- Pitfalls: HIGH - identified from direct analysis of the reply pipeline, chunking flow, and gateway boundary

**Research date:** 2026-02-16
**Valid until:** 2026-03-16 (stable domain; W3C spec is a Recommendation)

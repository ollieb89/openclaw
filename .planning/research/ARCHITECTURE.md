# Architecture Patterns: Security Hardening for OpenClaw AI Gateway

**Domain:** AI gateway security hardening (retrofit to existing system)
**Researched:** 2026-02-15

## Existing Message Flow (Baseline)

Understanding where security layers must integrate requires mapping the current pipeline:

```
External Message
    |
    v
Channel Adapter (Telegram, Discord, WhatsApp, Signal, etc.)
    |
    v
ChatEnvelope / MsgContext (normalized inbound message)
    |
    v
Gateway Routing (resolve-route.ts -> agent + session key)
    |
    v
Auto-Reply Dispatch (dispatch.ts -> dispatchReplyFromConfig)
    |
    v
Tool Policy Pipeline (tool-policy-pipeline.ts -> filter available tools)
    |
    v
Pi Embedded Runner (pi-embedded-runner/run.ts -> LLM call)
    |                       |
    v                       v
Response Streaming     Tool Execution (sandbox, exec approval)
    |
    v
Reply Dispatcher (buffered chunking -> channel delivery)
    |
    v
Channel Adapter (outbound)
```

## Recommended Security Architecture

Security hardening layers sit at **five interception points** in the existing pipeline. The key design principle: **each layer is independent and fail-closed** -- if a security check cannot determine safety, it blocks the message.

### Security Layer Placement

```
External Message
    |
    v
[LAYER 1] Channel Auth & Rate Limiting        <-- EXISTS (auth.ts, auth-rate-limit.ts, origin-check.ts)
    |
    v
Channel Adapter
    |
    v
[LAYER 2] Input Sanitization & Filtering      <-- PARTIAL (chat-sanitize.ts strips envelopes only)
    |       - Prompt injection detection         NEW: expand to full input scanning
    |       - PII detection/redaction            NEW
    |       - Content length/complexity limits    NEW
    |       - Unicode normalization & folding     EXISTS (external-content.ts has marker folding)
    |
    v
ChatEnvelope / MsgContext
    |
    v
Gateway Routing
    |
    v
[LAYER 3] Session Security Context            <-- PARTIAL (session-key, allowlists exist)
    |       - Per-session threat scoring          NEW
    |       - Session isolation enforcement       EXISTS (sandbox scope per session)
    |       - Conversation history sanitization   EXISTS (stripEnvelopeFromMessages)
    |       - External content boundary markers   EXISTS (external-content.ts wrapExternalContent)
    |
    v
Auto-Reply Dispatch
    |
    v
Tool Policy Pipeline
    |
    v
[LAYER 4] Agent Execution Guardrails          <-- PARTIAL (tool-policy.ts, dangerous-tools.ts)
    |       - Tool allowlist/denylist enforcement  EXISTS
    |       - Exec approval gates                  EXISTS (exec-approval-manager.ts)
    |       - Sandbox isolation                    EXISTS (Docker sandboxing)
    |       - Command policy enforcement           EXISTS (node-command-policy.ts)
    |       - System prompt hardening              NEW: injection-resistant prompt construction
    |       - Tool result sanitization             NEW: scan tool outputs before feeding back to LLM
    |
    v
Pi Embedded Runner
    |
    v
[LAYER 5] Output Filtering & Audit            <-- NEW (mostly)
    |       - Response content scanning            NEW
    |       - PII leak detection in output         NEW
    |       - Sensitive data exfiltration checks   NEW
    |       - Audit logging                        PARTIAL (security/audit.ts covers config, not runtime)
    |       - Anomaly detection                    NEW
    |
    v
Reply Dispatcher -> Channel Delivery
```

## Component Boundaries

| Component | Responsibility | Communicates With | Status |
|-----------|---------------|-------------------|--------|
| **InputFilter** | Scans inbound messages for injection patterns, PII, malicious content | Channel adapters (before MsgContext creation), SecurityAuditLog | NEW -- extends existing `external-content.ts` patterns |
| **ExternalContentWrapper** | Wraps untrusted external content with boundary markers and warnings | Auto-reply dispatch, hooks system | EXISTS (`security/external-content.ts`) |
| **SessionSecurityContext** | Tracks per-session threat score, enforces isolation policy | Gateway routing, Pi runner, audit log | NEW |
| **ToolPolicyPipeline** | Filters available tools based on profile/agent/group policies | Pi runner | EXISTS (`agents/tool-policy-pipeline.ts`) |
| **ExecApprovalManager** | Gates dangerous tool executions behind user approval | Gateway server, sandbox runtime | EXISTS (`gateway/exec-approval-manager.ts`) |
| **SandboxRuntime** | Docker-based process isolation for tool execution | Pi runner, tool execution | EXISTS (`agents/sandbox/`) |
| **OutputFilter** | Scans LLM responses before channel delivery | Reply dispatcher, audit log | NEW |
| **SecurityAuditLog** | Centralized security event logging and anomaly tracking | All security components | EXTEND (exists as config audit, needs runtime audit) |
| **NodeCommandPolicy** | Controls which device commands agents can invoke | Gateway server, node events | EXISTS (`gateway/node-command-policy.ts`) |
| **AuthRateLimiter** | Rate-limits auth attempts by IP/scope | Gateway auth | EXISTS (`gateway/auth-rate-limit.ts`) |

### Data Flow

**Inbound path (message arrives):**
1. Channel adapter receives raw message
2. **InputFilter** scans raw text: runs injection detection (`detectSuspiciousPatterns` from `external-content.ts`), checks content limits, optionally redacts PII
3. If flagged HIGH risk: block message, log to **SecurityAuditLog**, return safe error
4. If flagged MEDIUM risk: annotate MsgContext with threat metadata, continue
5. Message enters normal routing pipeline
6. **SessionSecurityContext** checks accumulated threat score for session; if threshold exceeded, restrict tool availability or require approval for all tool calls
7. **ToolPolicyPipeline** applies tool filtering (already exists, may be tightened based on threat score)
8. Pi runner executes with sandbox constraints

**Outbound path (response generated):**
1. Pi runner streams response blocks
2. **OutputFilter** scans each block before delivery: checks for PII leaks, credential exposure, unexpected tool invocation patterns
3. If output contains flagged content: redact or block, log to **SecurityAuditLog**
4. Clean response delivered via reply dispatcher to channel adapter

**Tool execution path (agent invokes tool):**
1. Tool call arrives from Pi runner
2. **ToolPolicyPipeline** checks allow/deny (exists)
3. If dangerous tool: **ExecApprovalManager** gates execution (exists)
4. **SandboxRuntime** enforces isolation (exists)
5. Tool result returned to Pi runner
6. **NEW:** Tool result passes through sanitization before being fed back to LLM context (prevents indirect injection via tool results)

## Patterns to Follow

### Pattern 1: Middleware Chain for Security Filters

**What:** Security filters as composable middleware functions that each receive message context and can annotate, modify, or reject. This mirrors the existing tool-policy-pipeline pattern.

**When:** All input/output filtering. Each filter is independent, testable, and orderable.

**Why:** OpenClaw already uses this pattern for tool policy (`ToolPolicyPipelineStep[]`). Extending it to security filtering keeps the architecture consistent.

**Example:**
```typescript
export type SecurityFilterResult = {
  action: "pass" | "annotate" | "block";
  annotations?: SecurityAnnotation[];
  blockReason?: string;
  threatScore?: number;
};

export type SecurityFilter = {
  name: string;
  phase: "input" | "output" | "tool-result";
  run: (content: string, context: SecurityContext) => SecurityFilterResult;
};

export type SecurityPipeline = {
  filters: SecurityFilter[];
  run: (content: string, context: SecurityContext) => AggregatedFilterResult;
};
```

### Pattern 2: Threat Score Accumulation Per Session

**What:** Each session accumulates a numeric threat score based on security filter findings. Score decays over time. High scores trigger progressive restrictions.

**When:** Any session receiving messages from external/untrusted sources (channels, hooks, webhooks).

**Why:** Prompt injection is rarely a single message -- attackers probe incrementally. A session-level score catches escalation patterns that per-message scanning misses.

**Example:**
```typescript
export type SessionThreatState = {
  score: number;           // 0-100, decays over time
  lastUpdatedMs: number;
  flags: Set<string>;      // e.g., "injection_attempt", "pii_probe"
  restrictionLevel: "none" | "elevated" | "restricted";
};

// Threshold mapping
// score < 25:  "none" -- normal operation
// score 25-60: "elevated" -- all tool calls require approval
// score > 60:  "restricted" -- read-only tools only, no exec
```

### Pattern 3: Content Boundary Markers (Already Exists)

**What:** External content is wrapped in unique boundary markers with security warnings, preventing the LLM from treating external content as instructions.

**When:** Any content from untrusted sources: emails, webhooks, web fetch results, channel metadata.

**Why:** This is the primary defense against indirect prompt injection. OpenClaw already implements this well in `security/external-content.ts`. The pattern should be extended to tool results from external-facing tools.

### Pattern 4: Fail-Closed Security Checks

**What:** If a security filter encounters an error (crash, timeout, unexpected input), it defaults to blocking rather than allowing.

**When:** All security filters.

**Why:** A crashed filter that silently passes content defeats the purpose. This is standard security practice.

```typescript
function runFilterSafe(filter: SecurityFilter, content: string, ctx: SecurityContext): SecurityFilterResult {
  try {
    return filter.run(content, ctx);
  } catch (err) {
    auditLog.warn({ filter: filter.name, error: err, action: "fail-closed" });
    return { action: "block", blockReason: `Security filter "${filter.name}" failed` };
  }
}
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Security Checks Only at the Perimeter

**What:** Putting all security scanning at the channel adapter entry point and trusting everything downstream.

**Why bad:** Indirect prompt injection arrives via tool results, not user messages. A web_fetch tool returning malicious content bypasses perimeter-only checks. The existing `wrapWebContent` function addresses this partially, but tool result scanning is still needed.

**Instead:** Defense-in-depth with checks at input, tool results, and output.

### Anti-Pattern 2: Blocking on False Positives Silently

**What:** Security filters that block content and return a generic error with no logging or user feedback.

**Why bad:** Users get confused, developers cannot debug, and legitimate use cases break without explanation. Overly aggressive regex-based injection detection (like the existing `SUSPICIOUS_PATTERNS`) will produce false positives.

**Instead:** Log all blocks to audit with full context. Return actionable error messages to the user. Allow configurable sensitivity levels.

### Anti-Pattern 3: Modifying the Pi Agent Runtime

**What:** Trying to patch prompt injection defenses into the Pi embedded agent framework itself.

**Why bad:** Per project context, the Pi agent framework cannot be modified. Security must wrap around it, not within it.

**Instead:** All security controls operate on inputs to and outputs from the Pi runner via the existing pipeline hooks.

### Anti-Pattern 4: Synchronous Heavy Scanning in the Hot Path

**What:** Running expensive ML-based content classifiers synchronously in the message processing pipeline.

**Why bad:** Adds 100-500ms latency per message. For a personal assistant gateway, responsiveness matters.

**Instead:** Fast regex/heuristic checks synchronously (like the existing `detectSuspiciousPatterns`). Expensive ML classifiers run asynchronously with results feeding into the threat score. Only block synchronously on high-confidence fast checks.

### Anti-Pattern 5: Single Regex List for Injection Detection

**What:** Relying solely on pattern matching (like the current `SUSPICIOUS_PATTERNS` array) for prompt injection detection.

**Why bad:** Trivially bypassed with Unicode tricks, language variations, encoding. The existing `foldMarkerText` function handles some Unicode folding for boundary markers but not for injection detection patterns.

**Instead:** Layer multiple detection approaches: regex for known patterns (fast, low latency), structural analysis (checking for role/system/user markers in unexpected positions), and optionally a classifier model for high-value sessions.

## Component Dependency Graph (Build Order)

```
Phase 1 (Foundation):
  SecurityAuditLog (runtime extension)  <-- No dependencies, enables all other components
  SecurityFilterTypes                    <-- Type definitions for the filter pipeline
  InputFilter (basic)                    <-- Extends existing detectSuspiciousPatterns

Phase 2 (Input Pipeline):
  InputFilter (full)                     <-- Depends on: SecurityFilterTypes, SecurityAuditLog
  SessionSecurityContext                 <-- Depends on: SecurityAuditLog, InputFilter annotations
  SystemPromptHardening                  <-- Depends on: SecurityFilterTypes (for threat annotations)

Phase 3 (Execution Hardening):
  ToolResultSanitizer                    <-- Depends on: SecurityFilterTypes, SecurityAuditLog
  Enhanced ExecApproval integration      <-- Depends on: SessionSecurityContext (threat-score-based gating)
  Sandbox policy tightening              <-- Depends on: SessionSecurityContext

Phase 4 (Output & Monitoring):
  OutputFilter                           <-- Depends on: SecurityFilterTypes, SecurityAuditLog
  Anomaly Detection                      <-- Depends on: SecurityAuditLog (needs historical data)
  Security Dashboard (Control UI)        <-- Depends on: SecurityAuditLog, all filters operational
```

**Build order rationale:**
- Phase 1 first because the audit log is the backbone -- every other component writes to it
- Phase 2 before Phase 3 because input filtering catches the majority of threats and is the highest-value hardening
- Phase 3 before Phase 4 because execution hardening prevents damage even if detection fails
- Phase 4 last because output filtering catches leaks but is lower priority than preventing bad inputs/execution

## Integration Points with Existing Code

| New Component | Integrates At | Existing File(s) | Integration Method |
|---------------|--------------|-------------------|-------------------|
| InputFilter | Before MsgContext creation | `auto-reply/dispatch.ts`, `gateway/server-methods/chat.ts` | Wrap `dispatchInboundMessage` with filter pipeline |
| SessionSecurityContext | After routing, before agent run | `gateway/session-utils.ts`, `routing/resolve-route.ts` | Extend session state with threat metadata |
| SystemPromptHardening | System prompt construction | `agents/system-prompt.ts` | Add defensive instructions to prompt builder |
| ToolResultSanitizer | After tool execution, before LLM re-ingestion | `agents/pi-embedded-subscribe.handlers.tools.ts` | Filter in tool result handler chain |
| OutputFilter | Before reply dispatch | `auto-reply/reply/reply-dispatcher.ts` | Wrap dispatcher send with output filter |
| SecurityAuditLog (runtime) | Global singleton | `security/audit.ts` (extend) | Add runtime event logging alongside existing config audit |

## Scalability Considerations

| Concern | Single User | 10 Concurrent Sessions | 100+ Sessions |
|---------|-------------|----------------------|---------------|
| Input scanning latency | <5ms regex, negligible | Same per-message | Same per-message |
| Threat score storage | In-memory Map | In-memory Map | In-memory Map with TTL eviction |
| Audit log storage | Append-only file | Append-only file + rotation | Structured log with indexing |
| Output scanning | <5ms per chunk | Same per-chunk | Same per-chunk |
| ML classifier (optional) | Async, ~200ms | Queue with concurrency limit | Queue with backpressure |

OpenClaw is a personal gateway (typically single-user, handful of concurrent sessions). Scalability concerns are minimal. The primary performance constraint is keeping synchronous security checks under 10ms to avoid degrading chat responsiveness.

## Sources

- OpenClaw codebase analysis: `src/security/external-content.ts` (existing injection detection, content wrapping) -- HIGH confidence
- OpenClaw codebase analysis: `src/agents/tool-policy-pipeline.ts` (existing tool filtering pattern) -- HIGH confidence
- OpenClaw codebase analysis: `src/gateway/exec-approval-manager.ts` (existing execution gating) -- HIGH confidence
- OpenClaw codebase analysis: `src/security/audit.ts` (existing security audit framework) -- HIGH confidence
- OpenClaw codebase analysis: `src/security/dangerous-tools.ts` (existing tool risk classification) -- HIGH confidence
- [OWASP LLM01:2025 Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/) -- MEDIUM confidence (established framework, but mitigations are guidance not guarantees)
- [OWASP Prompt Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html) -- MEDIUM confidence
- [OpenAI: Understanding Prompt Injections](https://openai.com/index/prompt-injections/) -- MEDIUM confidence (vendor perspective)
- [NVIDIA: Practical Security Guidance for Sandboxing Agentic Workflows](https://developer.nvidia.com/blog/practical-security-guidance-for-sandboxing-agentic-workflows-and-managing-execution-risk/) -- MEDIUM confidence
- [hai-guardrails TypeScript library](https://github.com/presidio-oss/hai-guardrails) -- LOW confidence (not verified in production use with this architecture)
- [Northflank: How to Sandbox AI Agents 2026](https://northflank.com/blog/how-to-sandbox-ai-agents) -- LOW confidence (general guidance)

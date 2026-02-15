# Phase 1: Foundation & Repo Hygiene - Research

**Researched:** 2026-02-15
**Domain:** Security event logging, secret detection, API key masking in TypeScript/Node.js
**Confidence:** HIGH

## Summary

Phase 1 has three distinct deliverables: (1) structured security event logging (SLOG-01), (2) repo-level secret detection and prevention (REPO-01), and (3) fixing the `session_status` tool's API key display format (TOOL-02). The codebase already has significant infrastructure in place for each area, which means this phase is primarily about extending and hardening existing patterns rather than building from scratch.

The existing logging system uses `tslog` v4 with a `SubsystemLogger` abstraction that supports structured metadata, file output (JSON lines), and console output with subsystem routing. Security events should be implemented as a new subsystem logger (e.g., `security`) using the existing `createSubsystemLogger` pattern. The existing `src/security/` directory contains audit infrastructure (static config analysis) but no runtime security event emission, so this is a new capability built on existing logging infrastructure.

For secret detection, the project already uses `detect-secrets` v1.5.0 via pre-commit hooks (`.pre-commit-config.yaml`) with a 2191-line baseline file. The pre-commit hook is already configured and functional. The main work is: (a) verifying no existing secrets in committed files, (b) ensuring the baseline is current, and (c) potentially adding a CI pipeline step that mirrors the pre-commit check. For API key masking, the current `formatApiKeySnippet` function shows both head AND tail of keys (e.g., `sk-pro...abcdef`), which violates TOOL-02's requirement to show only the first 4 chars plus length.

**Primary recommendation:** Build security event logging as a thin layer on top of the existing `SubsystemLogger` with typed event interfaces; fix the three duplicate `formatApiKeySnippet` / `maskApiKey` implementations to use a single shared function with the correct `prefix... (N chars)` format; verify and update the existing `detect-secrets` baseline.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| tslog | ^4.10.2 | Structured logging (already in use) | Already the project's logging foundation; supports JSON transport, child loggers, custom transports |
| detect-secrets (Yelp) | v1.5.0 | Secret detection in pre-commit | Already configured in `.pre-commit-config.yaml`; Python-based, mature, supports baselines |
| pre-commit | (system) | Git hook management | Already in use, manages detect-secrets + shellcheck + actionlint + oxlint + oxfmt |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @sinclair/typebox | (already in use) | Schema definitions for typed events | Use for defining SecurityEvent type schemas if runtime validation is needed |
| vitest | (already in use) | Testing | All new code needs colocated test files |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| tslog subsystem logger | pino / winston | Project already uses tslog; adding another logger creates confusion |
| detect-secrets | gitleaks / truffleHog | detect-secrets already configured with baseline; switching adds risk |
| Custom event types | OpenTelemetry events | OTel is a v2 concern (diagnostics-otel extension exists); keep Phase 1 simple |

**Installation:**
No new packages needed. All required libraries are already installed.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── security/
│   ├── events.ts              # NEW: SecurityEvent type definitions
│   ├── events.test.ts         # NEW: Tests for event emission
│   ├── event-logger.ts        # NEW: Security event logger (wraps SubsystemLogger)
│   ├── event-logger.test.ts   # NEW: Tests for logger
│   ├── audit.ts               # EXISTING: Static security audit
│   ├── external-content.ts    # EXISTING: Injection detection patterns
│   └── ...                    # EXISTING: Other security files
├── logging/
│   ├── redact.ts              # EXISTING: Token redaction patterns (already has maskToken)
│   └── ...
├── agents/tools/
│   └── session-status-tool.ts # MODIFY: Fix formatApiKeySnippet
├── auto-reply/reply/
│   └── commands-status.ts     # MODIFY: Fix formatApiKeySnippet
│   └── directive-handling.auth.ts # MODIFY: Fix maskApiKey
├── commands/models/
│   └── list.format.ts         # MODIFY: Fix maskApiKey
```

### Pattern 1: Security Event Logger (SubsystemLogger wrapper)
**What:** A typed wrapper around the existing `createSubsystemLogger("security")` that enforces structured event fields.
**When to use:** Whenever a security-relevant action occurs at runtime.
**Example:**
```typescript
// src/security/events.ts
export type SecurityEventType =
  | "auth.attempt"
  | "auth.success"
  | "auth.failure"
  | "tool.call"
  | "tool.denied"
  | "injection.detected"
  | "policy.violation";

export type SecurityEventSeverity = "info" | "warn" | "critical";

export type SecurityEvent = {
  eventType: SecurityEventType;
  timestamp: string;       // ISO 8601
  sessionKey?: string;
  channel?: string;
  severity: SecurityEventSeverity;
  action: string;          // What was done: "allowed", "blocked", "logged"
  detail?: string;         // Human-readable context
  meta?: Record<string, unknown>; // Additional structured data
};
```

```typescript
// src/security/event-logger.ts
import { createSubsystemLogger } from "../logging/subsystem.js";
import type { SecurityEvent, SecurityEventType, SecurityEventSeverity } from "./events.js";

const securityLogger = createSubsystemLogger("security");

export function emitSecurityEvent(event: SecurityEvent): void {
  const { severity, eventType, ...meta } = event;
  const message = `[${eventType}] ${event.action}${event.detail ? `: ${event.detail}` : ""}`;

  // Route to appropriate log level based on severity
  if (severity === "critical") {
    securityLogger.error(message, meta);
  } else if (severity === "warn") {
    securityLogger.warn(message, meta);
  } else {
    securityLogger.info(message, meta);
  }
}
```

### Pattern 2: Unified API Key Masking
**What:** A single shared function for masking API keys that shows only prefix + length.
**When to use:** Anywhere an API key is displayed to users or agents.
**Example:**
```typescript
// src/utils/mask-api-key.ts (or add to existing utils)
/**
 * Masks an API key showing only the first 4 characters and total length.
 * Output format: "sk-pr... (52 chars)"
 *
 * This is the ONLY function that should be used for masking API keys
 * in user-visible output (session_status, /status, models list, etc.).
 */
export function maskApiKey(apiKey: string): string {
  const compact = apiKey.replace(/\s+/g, "").trim();
  if (!compact) {
    return "unknown";
  }
  const prefix = compact.slice(0, 4);
  return `${prefix}... (${compact.length} chars)`;
}
```

### Pattern 3: Emitting Events at Integration Points
**What:** Adding `emitSecurityEvent()` calls at existing security-relevant code paths.
**When to use:** At authentication checks, tool policy enforcement, injection detection.
**Key integration points in existing code:**
- `src/gateway/auth.ts` -- auth attempts
- `src/agents/tool-policy.ts` -- tool allow/deny decisions
- `src/security/external-content.ts` -- `detectSuspiciousPatterns()` already returns matches
- `src/agents/bash-tools.exec.ts` -- exec approval flow
- `src/agents/tool-mutation.ts` -- tool mutation/interception

### Anti-Patterns to Avoid
- **Duplicating masking logic:** There are currently 4+ separate implementations of API key masking (`formatApiKeySnippet` in 2 files, `maskApiKey` in 2 files). Consolidate to ONE shared function.
- **Logging sensitive data in security events:** The session key in events should use the existing `redactIdentifier` (sha256 prefix) for non-owner-visible logs. For tool output visible to the agent, use the actual session key.
- **Blocking on security logging:** The existing logging infra uses `try/catch` around writes and never throws. Security event logging must follow this pattern -- never block the main flow.
- **Creating a separate logging system:** Use the existing `SubsystemLogger` infrastructure, not a parallel system.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Secret detection in commits | Custom regex scanner | `detect-secrets` (already configured) | Hundreds of detector plugins, handles baselines, false positive management |
| Structured logging | Custom JSON file writer | `tslog` + `SubsystemLogger` (already in use) | Handles rotation, levels, transports, child loggers |
| Token/key pattern matching | New regex set for redaction | `src/logging/redact.ts` patterns (already exist) | 15+ patterns for common token formats already maintained |
| Pre-commit hook management | Custom git hooks | `pre-commit` framework (already configured) | Manages hook installation, versioning, parallel execution |

**Key insight:** The codebase already has most of the infrastructure needed. Phase 1 is about connecting existing pieces and fixing specific issues, not building new systems.

## Common Pitfalls

### Pitfall 1: API Key Masking Shows Trailing Characters
**What goes wrong:** The current `formatApiKeySnippet` shows both head AND tail of API keys (e.g., `sk-pro...xyzabc`). The TOOL-02 requirement explicitly prohibits trailing characters.
**Why it happens:** The original implementation was designed for developer convenience (identifying which key is in use) rather than security.
**How to avoid:** Replace all instances with a single function that shows only prefix + length: `sk-pr... (52 chars)`.
**Warning signs:** Any masking output containing characters from the end of the key. There are currently **4 separate masking functions** across the codebase:
  1. `formatApiKeySnippet` in `src/agents/tools/session-status-tool.ts` (lines 56-65)
  2. `formatApiKeySnippet` in `src/auto-reply/reply/commands-status.ts` (lines 35-44)
  3. `maskApiKey` in `src/auto-reply/reply/directive-handling.auth.ts` (lines 18-27)
  4. `maskApiKey` in `src/commands/models/list.format.ts` (lines 59-68)

### Pitfall 2: Inconsistent Masking Behavior for Short Keys
**What goes wrong:** Current implementations have different behavior for short keys: `formatApiKeySnippet` uses 4 chars for keys < 12, `maskApiKey` returns the FULL key for keys <= 16 chars.
**Why it happens:** Each implementation was written independently.
**How to avoid:** The unified function should always mask, even short keys. For keys < 4 chars, show the full key + length (they're too short to be real secrets anyway).

### Pitfall 3: detect-secrets Baseline Drift
**What goes wrong:** The `.secrets.baseline` file gets out of date, causing false positives or missed detections.
**Why it happens:** New code introduces patterns that look like secrets (test fixtures, config schemas) and the baseline isn't updated.
**How to avoid:** Run `detect-secrets scan --baseline .secrets.baseline` to regenerate, then audit the results. The pre-commit config already has `--exclude-lines` for known false positives.

### Pitfall 4: Security Events Missing Context
**What goes wrong:** Security events are emitted but lack enough context for investigation (e.g., missing session key, channel, or triggering input).
**Why it happens:** Callers pass minimal info to keep the event emission simple.
**How to avoid:** Make the `SecurityEvent` type require `timestamp` and `eventType` as mandatory, make `sessionKey` and `channel` strongly encouraged (but optional since some events like startup don't have them). Provide helper constructors for common event types.

### Pitfall 5: Forgetting the Logging Redaction Layer
**What goes wrong:** Security events themselves log sensitive data (full API keys, user tokens, etc.).
**Why it happens:** The event detail field accepts free-form strings.
**How to avoid:** Route security events through the existing `redactSensitiveText` function (in `src/logging/redact.ts`) before writing. The existing redaction patterns already cover common token formats (sk-*, ghp_*, xox*, etc.).

## Code Examples

### Current formatApiKeySnippet (BROKEN -- shows tail)
```typescript
// Source: src/agents/tools/session-status-tool.ts:56-65
function formatApiKeySnippet(apiKey: string): string {
  const compact = apiKey.replace(/\s+/g, "");
  if (!compact) {
    return "unknown";
  }
  const edge = compact.length >= 12 ? 6 : 4;
  const head = compact.slice(0, edge);
  const tail = compact.slice(-edge);     // <-- VIOLATION: shows trailing chars
  return `${head}...${tail}`;
}
```

### Required Format (TOOL-02 compliant)
```typescript
// New unified function
function maskApiKey(apiKey: string): string {
  const compact = apiKey.replace(/\s+/g, "").trim();
  if (!compact) {
    return "unknown";
  }
  const prefix = compact.slice(0, 4);
  return `${prefix}... (${compact.length} chars)`;
}
// "sk-proj-abc123..." -> "sk-p... (52 chars)"
```

### Existing SubsystemLogger Usage Pattern
```typescript
// Source: src/logging/subsystem.ts -- this is how subsystem loggers work
import { createSubsystemLogger } from "../logging/subsystem.js";

const logger = createSubsystemLogger("security");

// Logs to both file (JSON) and console (with colored subsystem prefix)
logger.info("auth attempt", { sessionKey: "agent:main:telegram:123", channel: "telegram" });
// File output: {"subsystem":"security","0":"auth attempt","sessionKey":"agent:main:telegram:123","channel":"telegram","time":"2026-02-15T..."}
// Console: [security] auth attempt
```

### Existing Injection Detection
```typescript
// Source: src/security/external-content.ts:33-41
// Already returns matched patterns -- just needs event emission added
export function detectSuspiciousPatterns(content: string): string[] {
  const matches: string[] = [];
  for (const pattern of SUSPICIOUS_PATTERNS) {
    if (pattern.test(content)) {
      matches.push(pattern.source);
    }
  }
  return matches;
}
```

### Existing Redaction Infrastructure
```typescript
// Source: src/logging/redact.ts
// Already handles sk-*, ghp_*, xox*, Bearer tokens, PEM blocks, etc.
// 15+ patterns for common secret formats
import { redactSensitiveText } from "../logging/redact.js";

const safe = redactSensitiveText("key is sk-proj-abc123xyz789...");
// Output: "key is sk-pro...z789" (uses head+tail -- may need config for events)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Show head+tail of keys | Show only prefix + length | TOOL-02 requirement | Must update 4 functions across codebase |
| Static security audit only | Runtime security events | SLOG-01 requirement | New capability; existing audit stays |
| No secret scanning baseline | detect-secrets baseline (2191 lines) | Already in place | Needs audit/refresh, not creation |

**Existing infrastructure that Phase 1 extends:**
- `detect-secrets` v1.5.0 pre-commit hook with baseline -- already blocks secrets in new commits
- `SubsystemLogger` with JSON file transport -- foundation for security events
- `redactSensitiveText` with 15+ token patterns -- available for event content sanitization
- `detectSuspiciousPatterns` in external-content.ts -- injection detection already exists, just needs event emission
- `SecurityAuditFinding` type system -- existing audit model to align with for event types

## Open Questions

1. **Where should the unified `maskApiKey` function live?**
   - What we know: There are 4 duplicate implementations. Need one shared location.
   - What's unclear: Should it go in `src/utils/`, `src/logging/`, or `src/security/`?
   - Recommendation: Put it in `src/utils/mask-api-key.ts` since it's used across agents, auto-reply, and commands modules. It's a formatting utility, not a security or logging concern.

2. **Should security events use the existing log transport or a separate file?**
   - What we know: The existing logger writes all levels to a single rolling JSON file per day. Security events mixed with general logs could make forensic review harder.
   - What's unclear: Whether a separate security log file is needed for Phase 1 or can wait until Phase 5 (hash-chained audit log).
   - Recommendation: Use the existing log transport for Phase 1 (security events tagged with `subsystem: "security"` are filterable). Phase 5 adds the separate tamper-evident log. Keep Phase 1 simple.

3. **How many integration points for SLOG-01 in Phase 1?**
   - What we know: The requirement lists auth attempts, tool calls, injection detections, and policy violations. The codebase has clear integration points for each.
   - What's unclear: Whether Phase 1 should instrument ALL points or a representative subset.
   - Recommendation: Instrument the core paths (gateway auth, tool policy enforcement, injection detection in external-content.ts) and establish the pattern. Additional integration points can be added incrementally.

4. **Should the repo secret scan be a one-time cleanup or ongoing CI job?**
   - What we know: `detect-secrets` pre-commit hook already prevents new secrets. The success criterion says "No committed source file contains hardcoded secrets."
   - What's unclear: Whether a full-repo scan has been run recently.
   - Recommendation: Run `detect-secrets scan` across the entire repo, audit results, update baseline. This is a one-time task. The pre-commit hook handles ongoing prevention.

## Sources

### Primary (HIGH confidence)
- **Codebase inspection** -- direct reading of source files:
  - `src/logging/logger.ts` -- tslog v4 configuration, JSON transport, rolling logs
  - `src/logging/subsystem.ts` -- SubsystemLogger pattern with file + console output
  - `src/logging/redact.ts` -- 15+ token redaction patterns, maskToken function
  - `src/logging/redact-identifier.ts` -- SHA256-based identifier redaction
  - `src/security/audit.ts` -- SecurityAuditFinding types, existing audit infrastructure
  - `src/security/external-content.ts` -- injection detection patterns, wrapExternalContent
  - `src/agents/tools/session-status-tool.ts` -- formatApiKeySnippet (broken), session_status tool
  - `src/auto-reply/reply/commands-status.ts` -- duplicate formatApiKeySnippet
  - `src/auto-reply/reply/directive-handling.auth.ts` -- maskApiKey variant
  - `src/commands/models/list.format.ts` -- maskApiKey variant
  - `src/agents/tool-policy.ts` -- tool profiles and allow/deny policy
  - `.pre-commit-config.yaml` -- detect-secrets v1.5.0, shellcheck, actionlint, oxlint, oxfmt
  - `.secrets.baseline` -- 2191-line detect-secrets baseline
  - `package.json` -- tslog ^4.10.2 dependency confirmed

### Secondary (MEDIUM confidence)
- **tslog v4 documentation** -- structured logging, custom transports, child loggers (verified via codebase usage patterns)
- **detect-secrets documentation** -- baseline management, plugin configuration (verified via .pre-commit-config.yaml)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in the project, versions confirmed from package.json and lock file
- Architecture: HIGH -- patterns derived directly from existing codebase (SubsystemLogger, security audit types)
- Pitfalls: HIGH -- identified from direct code reading (4 duplicate masking functions, specific line numbers)
- Integration points: MEDIUM -- auth/tool/injection paths identified from grep, but exact instrumentation locations need verification during implementation

**Research date:** 2026-02-15
**Valid until:** 2026-03-15 (stable domain; existing codebase patterns unlikely to change significantly)

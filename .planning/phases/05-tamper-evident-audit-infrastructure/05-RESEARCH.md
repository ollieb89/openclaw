# Phase 5: Tamper-Evident Audit Infrastructure - Research

**Researched:** 2026-02-16
**Domain:** Cryptographic hash-chaining for append-only security event logs
**Confidence:** HIGH

## Summary

Phase 5 adds tamper-evidence to the existing security event logging system. Currently, `emitSecurityEvent()` in `src/security/event-logger.ts` routes events through `SubsystemLogger` which writes JSON lines to rolling log files via `tslog`. The goal is to create a dedicated, append-only security event log where each entry includes a cryptographic hash of the previous entry, forming a verifiable chain.

The implementation requires three components: (1) a hash-chained audit log writer that intercepts security events and persists them to a dedicated JSONL file with chaining metadata, (2) a CLI command `openclaw security verify-log` that reads the log and validates the full chain, and (3) a startup hook in the gateway that verifies chain integrity and emits a warning if tampering is detected.

**Primary recommendation:** Use Node.js built-in `crypto.createHash('sha256')` for hash chaining on a dedicated JSONL file at `~/.openclaw/security/audit.jsonl`. Keep the implementation simple -- no external dependencies needed. The existing `emitSecurityEvent()` function is the single interception point.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:crypto` | built-in | SHA-256 hashing for chain integrity | Already used extensively in codebase (trace-context, config io, cache-trace) |
| `node:fs` | built-in | Append-only file writes | Matches existing patterns (cron/run-log.ts, config/io.ts audit log) |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:readline` | built-in | Streaming line-by-line verification of large logs | For the verify-log CLI command to avoid loading entire file into memory |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| SHA-256 | HMAC-SHA256 with a key | Adds key management complexity; SHA-256 chain is sufficient for tamper detection (not authentication) |
| JSONL flat file | SQLite | Over-engineered for append-only log; JSONL matches existing patterns (cron run-log, config audit log) |
| Custom verification | Merkle tree | Merkle trees optimize partial verification but add complexity; linear chain is appropriate for sequential log |

## Architecture Patterns

### Recommended Project Structure
```
src/security/
  audit-log.ts           # Hash-chained audit log writer (new)
  audit-log.test.ts      # Tests for writer + verification (new)
  audit-log-verify.ts    # Chain verification logic (new)
  audit-log-verify.test.ts
  event-logger.ts        # Modified: also calls audit log writer
  events.ts              # Unchanged: SecurityEvent type
```

### Pattern 1: Hash-Chained JSONL Entry
**What:** Each log entry is a JSON line containing the event data plus chaining metadata
**When to use:** Every security event written to the audit log
**Example:**
```typescript
// Each line in audit.jsonl looks like:
type AuditLogEntry = {
  seq: number;              // Monotonically increasing sequence number
  timestamp: string;        // ISO 8601
  prevHash: string;         // SHA-256 hex of previous entry's JSON (or "GENESIS" for first)
  event: SecurityEvent;     // The actual security event
  hash: string;             // SHA-256 hex of this entry (computed over seq + timestamp + prevHash + event)
};

// Hash computation: hash everything EXCEPT the hash field itself
function computeEntryHash(entry: Omit<AuditLogEntry, 'hash'>): string {
  const payload = JSON.stringify({
    seq: entry.seq,
    timestamp: entry.timestamp,
    prevHash: entry.prevHash,
    event: entry.event,
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}
```

### Pattern 2: Singleton Writer with Serialized Writes
**What:** A module-level writer that serializes concurrent append operations
**When to use:** The audit log writer must handle concurrent `emitSecurityEvent()` calls safely
**Example:**
```typescript
// Follow the pattern from src/cron/run-log.ts (writesByPath map for serialization)
let writeChain = Promise.resolve();
let lastHash = 'GENESIS';
let lastSeq = 0;

export function appendAuditEntry(event: SecurityEvent): void {
  // Synchronous queue -- fire-and-forget but serialized
  writeChain = writeChain.catch(() => undefined).then(async () => {
    const entry = buildEntry(event, lastHash, lastSeq + 1);
    lastHash = entry.hash;
    lastSeq = entry.seq;
    await fs.appendFile(auditLogPath, JSON.stringify(entry) + '\n', 'utf-8');
  });
}
```

### Pattern 3: Startup Verification Hook
**What:** On gateway startup, verify the audit log chain before accepting connections
**When to use:** Early in `startGatewayServer()` or `startGatewaySidecars()`
**Example:**
```typescript
// In gateway startup flow, after config loading but before channel startup
const auditResult = await verifyAuditLogChain(resolveAuditLogPath());
if (!auditResult.valid) {
  securityLogger.error(
    `Security audit log tamper detected: ${auditResult.error} at entry ${auditResult.failedAtSeq}`,
  );
  emitSecurityEvent({
    eventType: 'policy.violation',
    timestamp: new Date().toISOString(),
    severity: 'critical',
    action: 'detected',
    detail: `Audit log integrity check failed: ${auditResult.error}`,
  });
}
```

### Pattern 4: CLI Command Registration
**What:** Register `openclaw security verify-log` under the existing security CLI
**When to use:** The security CLI already exists at `src/cli/security-cli.ts` with `registerSecurityCli()`
**Example:**
```typescript
// Add to src/cli/security-cli.ts alongside the existing "audit" subcommand
security
  .command("verify-log")
  .description("Verify integrity of the security audit log hash chain")
  .option("--json", "Print JSON output", false)
  .action(async (opts) => {
    const result = await verifyAuditLogChain(resolveAuditLogPath());
    // Format and display result
  });
```

### Anti-Patterns to Avoid
- **Storing hash state in a separate file:** The chain must be self-verifiable from the JSONL alone. Never store "last hash" in a separate state file that could become out of sync.
- **Modifying existing log files:** The security audit log is append-only. Never truncate, rotate, or prune it (unlike cron run-log which prunes). For v1, accept unbounded growth; rotation can be a future enhancement.
- **Blocking on audit log writes:** `emitSecurityEvent()` is called in hot paths (auth, tool calls). The audit log append must be fire-and-forget (async, serialized, but never blocking the caller).
- **Using `appendFileSync`:** The existing logger uses `appendFileSync` but that blocks the event loop. Use async `appendFile` with serialization chain instead.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SHA-256 hashing | Custom hash function | `crypto.createHash('sha256')` | Proven, fast, already used throughout codebase |
| JSON serialization for hashing | Custom serializer | `JSON.stringify()` with deterministic key ordering | JSON.stringify with explicit object construction ensures deterministic output |
| File path resolution | Hardcoded paths | `resolveStateDir()` from `src/config/paths.ts` | Respects OPENCLAW_STATE_DIR override, matches existing state file patterns |

**Key insight:** The hash chain concept is simple enough that no external library is needed. The complexity is in the integration points (event interception, startup hook, CLI command), not the cryptographic primitives.

## Common Pitfalls

### Pitfall 1: Non-Deterministic JSON Serialization
**What goes wrong:** `JSON.stringify()` object key order can vary across V8 versions or when objects are constructed differently, causing hash mismatches on verification.
**Why it happens:** JavaScript object property enumeration order is insertion-order but this can break if events are constructed with different property orders.
**How to avoid:** Always construct the hash input from an explicitly-ordered object literal, not from the raw event. Use a dedicated `canonicalize()` function that produces deterministic output.
**Warning signs:** Verification failures that appear non-deterministically or after Node.js version upgrades.

### Pitfall 2: Writer State Recovery After Process Crash
**What goes wrong:** If the process crashes mid-write, the last line may be truncated/corrupt, and the in-memory `lastHash`/`lastSeq` state is lost.
**Why it happens:** `appendFile` is not atomic. Process restart loses in-memory state.
**How to avoid:** On startup (or first write), read the last valid line of the log file to recover `lastHash` and `lastSeq`. Handle truncated last lines gracefully by ignoring them during recovery (but flagging during verification).
**Warning signs:** Hash chain breaks at process restart boundaries.

### Pitfall 3: Race Conditions in Concurrent Writes
**What goes wrong:** Two concurrent `emitSecurityEvent()` calls could compute hashes against the same `lastHash`, creating a fork in the chain.
**Why it happens:** Without serialization, the read-compute-write cycle is not atomic.
**How to avoid:** Use a promise chain (as shown in Pattern 2) to serialize all writes. The `emitSecurityEvent()` function is synchronous today, so the audit append must be queued and fire-and-forget.
**Warning signs:** Duplicate sequence numbers or hash mismatches between adjacent entries.

### Pitfall 4: Genesis Entry Ambiguity
**What goes wrong:** If the log file doesn't exist yet, the first entry needs a well-defined `prevHash`. If verification logic doesn't handle this the same way as the writer, the chain appears broken.
**Why it happens:** Edge case in initial state.
**How to avoid:** Use a sentinel value `"GENESIS"` for the first entry's `prevHash`. Document this clearly. Both writer and verifier must agree on this convention.
**Warning signs:** Verification always fails on the first entry.

### Pitfall 5: Audit Log Path Mismatch Between Writer and Verifier
**What goes wrong:** The writer uses one path resolution and the CLI verifier uses another, so verification reads a different (or empty) file.
**Why it happens:** Path resolution depends on environment variables (`OPENCLAW_STATE_DIR`). Gateway and CLI may have different environments.
**How to avoid:** Extract path resolution into a single shared function (`resolveAuditLogPath()`) used by both writer and verifier. Follow the pattern of `resolveStateDir()` from `src/config/paths.ts`.
**Warning signs:** CLI reports "no audit log found" when events have been written.

## Code Examples

### Hash Chain Computation
```typescript
import crypto from "node:crypto";

const GENESIS_HASH = "GENESIS";

function canonicalize(entry: { seq: number; timestamp: string; prevHash: string; event: SecurityEvent }): string {
  // Explicit key ordering for deterministic serialization
  return JSON.stringify({
    seq: entry.seq,
    timestamp: entry.timestamp,
    prevHash: entry.prevHash,
    event: {
      eventType: entry.event.eventType,
      timestamp: entry.event.timestamp,
      severity: entry.event.severity,
      action: entry.event.action,
      ...(entry.event.sessionKey !== undefined && { sessionKey: entry.event.sessionKey }),
      ...(entry.event.channel !== undefined && { channel: entry.event.channel }),
      ...(entry.event.detail !== undefined && { detail: entry.event.detail }),
      ...(entry.event.meta !== undefined && { meta: entry.event.meta }),
    },
  });
}

function computeHash(canonicalized: string): string {
  return crypto.createHash("sha256").update(canonicalized, "utf-8").digest("hex");
}
```

### Verification Loop
```typescript
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

type VerifyResult =
  | { valid: true; entryCount: number }
  | { valid: false; entryCount: number; failedAtSeq: number; error: string };

async function verifyAuditLogChain(logPath: string): Promise<VerifyResult> {
  const rl = createInterface({ input: createReadStream(logPath, "utf-8"), crlfDelay: Infinity });
  let expectedPrevHash = GENESIS_HASH;
  let entryCount = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line) as AuditLogEntry;
    entryCount++;

    // Check sequence continuity
    if (entry.seq !== entryCount) {
      return { valid: false, entryCount, failedAtSeq: entry.seq, error: "sequence gap or duplicate" };
    }
    // Check prevHash linkage
    if (entry.prevHash !== expectedPrevHash) {
      return { valid: false, entryCount, failedAtSeq: entry.seq, error: "prevHash mismatch" };
    }
    // Recompute and verify hash
    const recomputed = computeHash(canonicalize({ seq: entry.seq, timestamp: entry.timestamp, prevHash: entry.prevHash, event: entry.event }));
    if (entry.hash !== recomputed) {
      return { valid: false, entryCount, failedAtSeq: entry.seq, error: "hash mismatch (entry tampered)" };
    }
    expectedPrevHash = entry.hash;
  }

  return { valid: true, entryCount };
}
```

### Integration Point: emitSecurityEvent Modification
```typescript
// src/security/event-logger.ts -- add audit log call
import { appendAuditEntry } from "./audit-log.js";

export function emitSecurityEvent(event: SecurityEvent): void {
  const { severity, eventType, ...meta } = event;
  const message = `[${eventType}] ${event.action}${event.detail ? `: ${event.detail}` : ""}`;

  // Existing logging (unchanged)
  if (severity === "critical") {
    securityLogger.error(message, meta);
  } else if (severity === "warn") {
    securityLogger.warn(message, meta);
  } else {
    securityLogger.info(message, meta);
  }

  // NEW: Append to tamper-evident audit log (fire-and-forget)
  appendAuditEntry(event);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Plain text logs | Structured JSONL with hash chains | Industry standard for audit trails | Tamper detection without external infrastructure |
| HMAC-based log authentication | Hash chains (no shared secret needed) | N/A | Simpler for local tamper detection; HMAC needed only for multi-party trust |

**Note on scope:** This phase implements local tamper detection (detect if log file was edited after the fact). It does NOT implement:
- Remote attestation (proving to a third party the log is authentic)
- Encryption of log entries
- Log rotation with chain continuity across files
These are potential future enhancements but out of scope for INFR-01.

## Key Integration Points

### 1. Event Interception
- **File:** `src/security/event-logger.ts`
- **Change:** Add `appendAuditEntry(event)` call in `emitSecurityEvent()`
- **Risk:** LOW -- single function, clean insertion point

### 2. Gateway Startup Hook
- **File:** `src/gateway/server.impl.ts` (in `startGatewayServer()`) or `src/gateway/server-startup.ts`
- **Change:** Call `verifyAuditLogChain()` early in startup, emit warning via `securityLogger` if invalid
- **Consideration:** Should be non-blocking -- a tampered log should warn but not prevent gateway startup. Use the existing `log.warn()` / `log.error()` patterns from `server-startup.ts`.

### 3. CLI Command
- **File:** `src/cli/security-cli.ts`
- **Change:** Add `verify-log` subcommand under existing `security` command
- **Pattern:** Follow the existing `audit` subcommand pattern (JSON output option, themed output)

### 4. Audit Log File Location
- **Path:** `resolveStateDir() + '/security/audit.jsonl'`
- **Permissions:** `0o600` (owner read/write only), directory `0o700`
- **Follows:** Same patterns as config audit log (`src/config/io.ts` line 382)

## Open Questions

1. **Log rotation strategy**
   - What we know: The cron run-log prunes when exceeding size limits. The main logger uses daily rolling files.
   - What's unclear: Should the security audit log ever be pruned? Pruning breaks the chain from genesis.
   - Recommendation: For v1, no rotation. Accept unbounded growth. Add a "entries" count to `verify-log` output so users can monitor size. Log rotation with chain continuity (storing chain checkpoints) can be a future enhancement.

2. **Handling corrupt last line on crash**
   - What we know: Async appendFile can leave truncated lines if process crashes mid-write.
   - What's unclear: Should the writer silently skip corrupt last lines during state recovery, or should verification flag them?
   - Recommendation: Writer recovery: skip truncated last line and re-chain from the last valid entry. Verification: report truncated trailing line as a warning (not a failure), since it indicates crash rather than tampering.

## Sources

### Primary (HIGH confidence)
- `src/security/event-logger.ts` -- current security event emission, single interception point
- `src/security/events.ts` -- SecurityEvent type definition
- `src/logging/logger.ts` -- file logging patterns (tslog transport, appendFileSync, rolling logs)
- `src/cron/run-log.ts` -- JSONL append pattern with write serialization
- `src/config/io.ts` -- config audit log append pattern (appendFile, 0o600 permissions)
- `src/config/paths.ts` -- `resolveStateDir()` for state file path resolution
- `src/cli/security-cli.ts` -- existing security CLI command structure
- `src/gateway/server-startup.ts` -- gateway startup sidecar pattern
- `src/gateway/server.impl.ts` -- main gateway server entry point
- `src/security/trace-context.ts` -- crypto usage patterns (createHash, randomBytes)
- Node.js `crypto` module documentation -- `createHash('sha256')` is stable API

### Secondary (MEDIUM confidence)
- Hash chain / blockchain-style append-only log design -- well-established pattern in security logging (Certificate Transparency, blockchain, git object model)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all Node.js built-ins, no external deps, patterns already in codebase
- Architecture: HIGH -- single interception point (`emitSecurityEvent`), clear integration points for CLI and startup
- Pitfalls: HIGH -- well-understood domain (deterministic serialization, crash recovery, write serialization)

**Research date:** 2026-02-16
**Valid until:** 2026-03-16 (stable domain, no fast-moving dependencies)

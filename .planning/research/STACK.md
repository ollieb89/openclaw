# Stack Research: AI Gateway Security Hardening

**Domain:** AI agent gateway security (prompt injection, tool abuse, data exfiltration, session isolation)
**Researched:** 2026-02-15
**Confidence:** MEDIUM -- this domain is rapidly evolving; most libraries are under 2 years old

## Existing Security in OpenClaw

Before recommending additions, here is what the codebase already has:

| Capability | Location | Status |
|------------|----------|--------|
| SSRF guards on media fetch | `src/infra/net/fetch-guard.ts`, `src/media/fetch.ts` | Implemented |
| Tool policy (allow/deny lists) | `src/security/audit-tool-policy.ts` | Implemented |
| Dangerous tool classification | `src/security/dangerous-tools.ts` | Implemented |
| External content wrapping | `src/security/external-content.ts` | Implemented (regex-based injection detection) |
| Filesystem audit | `src/security/audit-fs.ts` | Implemented |
| Channel access control | `src/web/inbound/access-control.ts` | Implemented |
| Skill scanning | `src/security/skill-scanner.ts` | Implemented |
| Secret comparison (timing-safe) | `src/security/secret-equal.ts` | Implemented |

The gap: detection is regex-based only, no output sanitization, no PII redaction, no token-budget rate limiting, no structured guardrails pipeline, no exfiltration-via-rendered-content prevention.

## Recommended Stack

### Core: Prompt Injection Detection

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| `@presidio-dev/hai-guardrails` | ^1.12.0 | Multi-threat guardrails (injection, leakage, PII, secrets, toxicity) | Most comprehensive TypeScript-native guardrails library. 10 guard types. Actively maintained (16 releases, last published Feb 2026). Supports heuristic + LLM-based detection with configurable thresholds. Does not require external API calls for basic detection. | MEDIUM |
| `@andersmyrmel/vard` | latest | Lightweight pattern-based injection detection | Zod-inspired API, <0.5ms detection, 90-95% accuracy on known patterns. Good first-pass filter before heavier guards. Zero external dependencies. Use as the fast pre-filter layer. | LOW -- new library, small community |

**Rationale for hai-guardrails over alternatives:**
- `@openai/guardrails` requires paid OpenAI API calls for every check -- unacceptable for a personal gateway that processes high message volume locally
- NeMo Guardrails is Python-only -- would require a sidecar process
- Guardrails AI is Python-only
- LLM Guard by Protect AI is Python-only
- Lakera Guard requires a container (4GB RAM, 2 CPU) or SaaS subscription -- overkill for a personal gateway

### Core: Output Sanitization and PII Redaction

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| `@arcjet/redact` | latest | PII detection and redaction (email, phone, credit card, IP) | Runs entirely locally in WASM sandbox. No cloud dependency. Supports redact + unredact (reversible). Works independently of main Arcjet SDK. ESM-only (matches OpenClaw). | MEDIUM |

**Rationale:** `@redactpii/node` is simpler but regex-only. `@arcjet/redact` uses WASM-based detection which catches more patterns while staying local. The unredact capability is useful for logging context without exposing PII.

### Core: Output Content Security (Anti-Exfiltration)

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| Custom implementation | N/A | Strip/neutralize markdown image tags, external links, and HTML in LLM output | No library exists for this specific problem. Build a focused module that strips `![](url)`, `<img>`, and suspicious `[text](url)` patterns from agent output before rendering. NVIDIA and OWASP both recommend output sanitization as primary exfiltration defense. | HIGH (pattern is well-documented) |

**Why custom, not a library:** Data exfiltration via rendered markdown/HTML is an LLM-specific attack vector (embedding user data in image URLs). The fix is straightforward string processing -- sanitize agent output before it reaches any rendering surface. No general-purpose library addresses this because the attack surface depends on your rendering context. The existing `src/security/external-content.ts` already has the pattern; extend it to cover output as well as input.

### Supporting: Rate Limiting and Token Budgets

| Library | Version | Purpose | When to Use | Confidence |
|---------|---------|---------|-------------|------------|
| `bottleneck` | ^2.19.5 | Token-budget rate limiting per user/channel/session | Limit LLM API token consumption per channel/user. Reservoir-based (maps naturally to token budgets). Zero dependencies. 8M+ weekly downloads. Supports Redis clustering if needed later. | HIGH |

**Why bottleneck over alternatives:**
- `express-rate-limit` is HTTP middleware -- OpenClaw routes messages through WebSocket and channel adapters, not Express request/response
- `limiter` is simpler but lacks the reservoir/interval model needed for token budgets
- Bottleneck's reservoir pattern maps directly to "X tokens per hour per user" -- set reservoir to token budget, decrement by actual token usage per request

### Supporting: Security Headers and CSP

| Library | Version | Purpose | When to Use | Confidence |
|---------|---------|---------|-------------|------------|
| `helmet` | ^8.x | HTTP security headers for Control UI | Apply to the Express/gateway HTTP server serving the Control UI. Prevents XSS, clickjacking, and content injection in the web surface. Default CSP blocks external image loading (anti-exfiltration). | HIGH |

**Note:** OpenClaw already serves a web Control UI. Helmet's default CSP (`default-src 'self'`) would block the rendered-markdown exfiltration vector in the web UI layer. This is defense-in-depth alongside output sanitization.

### Supporting: Schema Validation (Already in Stack)

| Library | Version | Purpose | When to Use | Confidence |
|---------|---------|---------|-------------|------------|
| `zod` | (existing) | Strict validation of tool call arguments from LLM | Already used in OpenClaw. Ensure ALL tool input schemas use `.strict()` to reject unexpected properties. LLM-generated tool calls must be parsed, never trusted. | HIGH |

**Action:** Audit existing tool schemas to ensure `.strict()` mode is used consistently. LLMs can hallucinate extra parameters that bypass intended restrictions if schemas are permissive.

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `prompt-injector` (BlueprintLab) | Red-team testing for prompt injection | Use in test suite to validate injection defenses. Research-informed attack library. Install as devDependency only. |
| Vitest (existing) | Security test suite | Add dedicated `*.security.test.ts` files colocated with security modules |

## Installation

```bash
# Core security libraries
bun add @presidio-dev/hai-guardrails @arcjet/redact bottleneck helmet

# Optional: lightweight fast-path injection detection
bun add @andersmyrmel/vard

# Dev dependencies for security testing
bun add -D prompt-injector
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `@presidio-dev/hai-guardrails` | `@openai/guardrails` | Only if you already pay for OpenAI API and want their moderation models. Adds per-request API cost. |
| `@presidio-dev/hai-guardrails` | Lakera Guard (self-hosted) | Enterprise deployments with dedicated infrastructure. Requires 4GB RAM container. |
| `@arcjet/redact` | `@redactpii/node` | If you want zero dependencies and only need basic PII types (email, SSN, credit card). Regex-only, less accurate. |
| `bottleneck` | `limiter` | Simpler token bucket without reservoir scheduling. Use if you only need requests-per-second, not token budgets. |
| Custom output sanitizer | None available | No alternatives exist -- this is a custom concern. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| NeMo Guardrails | Python-only. Would require running a Python sidecar alongside Node.js. Adds operational complexity for a personal gateway. | `@presidio-dev/hai-guardrails` (TypeScript-native) |
| Guardrails AI | Python-only, same problem as NeMo. | `@presidio-dev/hai-guardrails` |
| `@openai/guardrails` | Makes paid API calls for every guardrail check. Unacceptable latency and cost for a personal gateway processing high message volume. | `@presidio-dev/hai-guardrails` (local detection) |
| Lakera Guard SaaS | Sends all prompts to external service. Privacy concern for a personal assistant gateway. | Local detection with hai-guardrails |
| Generic WAF (ModSecurity, etc.) | Not LLM-aware. Cannot detect prompt injection, only traditional web attacks. | Combine helmet (web layer) + hai-guardrails (LLM layer) |
| `express-rate-limit` | HTTP middleware pattern. OpenClaw messages flow through WebSocket and channel adapters, not Express request handlers. Wrong abstraction level. | `bottleneck` (function-level rate limiting) |

## Stack Patterns by Security Layer

**Layer 1 -- Input pre-filter (fast, <1ms):**
- Use `vard` or the existing regex patterns in `external-content.ts` for fast rejection of obvious injection attempts
- This catches 90%+ of known attack patterns with near-zero latency

**Layer 2 -- Deep input analysis (5-50ms):**
- Use `hai-guardrails` injection guard, leakage guard, and PII guard on messages that pass Layer 1
- Configurable thresholds: strict for untrusted channels (webhooks, email), lenient for authenticated direct messages

**Layer 3 -- Tool call validation (existing, enhance):**
- Zod `.strict()` on all tool input schemas
- Existing tool policy allow/deny lists
- Add token budget enforcement via `bottleneck` before tool execution

**Layer 4 -- Output sanitization (before rendering):**
- Strip markdown image injection patterns from agent output
- PII redaction via `@arcjet/redact` on outbound messages
- CSP headers via `helmet` on web UI

**If the gateway becomes multi-tenant:**
- Upgrade bottleneck to Redis-backed clustering mode
- Add per-tenant session isolation at the agent runtime level
- Consider Lakera Guard container for centralized policy

**If real-time detection latency is critical:**
- Drop hai-guardrails LLM-based detection mode (keep heuristic only)
- Rely on vard + regex for sub-millisecond checks
- Run deeper analysis asynchronously and flag retroactively

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `@presidio-dev/hai-guardrails@^1.12` | Node >= 18 | TypeScript 5.x, ESM |
| `@arcjet/redact@latest` | Node >= 18, ESM only | No CommonJS support (matches OpenClaw) |
| `bottleneck@^2.19` | Node >= 12 | Zero dependencies, stable API |
| `helmet@^8` | Express 4.x/5.x | Middleware pattern |
| `@andersmyrmel/vard@latest` | Node >= 18 | TypeScript-first, ESM |

## Sources

- [hai-guardrails GitHub](https://github.com/presidio-oss/hai-guardrails) -- v1.12.0, 10 guard types, actively maintained (MEDIUM confidence)
- [vard GitHub](https://github.com/andersmyrmel/vard) -- Zod-inspired injection detection (LOW confidence -- new project)
- [Arcjet redact docs](https://docs.arcjet.com/redact/quick-start/) -- local WASM-based PII redaction (MEDIUM confidence)
- [OWASP LLM Top 10 2025](https://genai.owasp.org/resource/owasp-top-10-for-llm-applications-2025/) -- prompt injection #1, tool abuse, data exfiltration (HIGH confidence)
- [NVIDIA AI Red Team blog](https://developer.nvidia.com/blog/practical-llm-security-advice-from-the-nvidia-ai-red-team/) -- output sanitization, CSP, link display recommendations (HIGH confidence)
- [Microsoft indirect prompt injection defense](https://www.microsoft.com/en-us/msrc/blog/2025/07/how-microsoft-defends-against-indirect-prompt-injection-attacks) -- markdown image exfiltration patterns (HIGH confidence)
- [bottleneck npm](https://www.npmjs.com/package/bottleneck) -- 8M+ weekly downloads, reservoir-based rate limiting (HIGH confidence)
- [helmet.js](https://helmetjs.github.io/) -- HTTP security headers, CSP defaults (HIGH confidence)
- [Arcjet blog on sensitive info detection](https://blog.arcjet.com/introducing-sensitive-information-detection-redaction-the-arcjet-langchain-integration/) -- local WASM detection (MEDIUM confidence)
- [@openai/guardrails](https://github.com/openai/openai-guardrails-js) -- requires paid API, dismissed for personal gateway (MEDIUM confidence)
- [Lakera Guard self-hosting docs](https://platform.lakera.ai/docs/selfhosting) -- container-based, 4GB RAM minimum (MEDIUM confidence)

---
*Stack research for: OpenClaw AI Gateway Security Hardening*
*Researched: 2026-02-15*

# Feature Research: AI Gateway Security Hardening

**Domain:** AI assistant gateway security (personal/self-hosted)
**Researched:** 2026-02-15
**Confidence:** MEDIUM-HIGH

## Existing Security Posture

Before defining what to build, here is what OpenClaw already has:

| Existing Feature | Location | Status |
|------------------|----------|--------|
| SSRF guards (DNS pinning, redirect tracking) | `src/infra/net/fetch-guard.ts`, `src/infra/net/ssrf.ts` | Solid |
| Tool policy allowlists/blocklists | `src/security/audit-tool-policy.ts`, `src/security/dangerous-tools.ts` | Solid |
| External content wrapping (prompt injection boundary markers) | `src/security/external-content.ts` | Good foundation |
| Suspicious pattern detection (regex-based injection detection) | `src/security/external-content.ts` | Basic, log-only |
| Unicode homoglyph folding for boundary marker evasion | `src/security/external-content.ts` | Solid |
| Gateway auth (token, password, trusted-proxy, Tailscale) | `src/security/audit.ts`, `src/gateway/auth.ts` | Comprehensive |
| Security audit CLI (`openclaw security audit`) | `src/security/audit.ts` | Comprehensive |
| Skill/plugin code scanning (shell exec, exfiltration, obfuscation) | `src/security/skill-scanner.ts` | Good |
| Filesystem permission checks | `src/security/audit-fs.ts` | Solid |
| Tool result size capping | `src/agents/session-tool-result-guard.ts` | Solid |
| Session key isolation (agent:channel:peer scoping) | `src/routing/session-key.ts` | Structural |
| Gateway HTTP tool deny list | `src/security/dangerous-tools.ts` | Good |
| Elevated exec allowlist per channel | `src/security/audit.ts` | Good |
| Logging redaction config | `src/security/audit.ts` | Basic |
| Rate limiting config (gateway auth) | `src/security/audit.ts` | Config-level |
| Browser control auth | `src/security/audit.ts` | Good |

## Feature Landscape

### Table Stakes (Users Expect These)

Features that any security-conscious AI gateway must have. OpenClaw's multi-channel architecture (WhatsApp, Telegram, Discord, Slack, Signal, iMessage) and tool execution capabilities make these non-negotiable.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Input sanitization pipeline** | OWASP LLM01 (Prompt Injection) is the #1 risk. Every inbound message from every channel must be validated before reaching the agent. Zero-width characters, base64-encoded payloads, emoji-encoded instructions, and Unicode confusables are proven attack vectors. | MEDIUM | OpenClaw already has `detectSuspiciousPatterns` and `wrapExternalContent` but these are opt-in per call site. Needs a centralized pipeline that every channel adapter routes through, not just hooks/webhooks. |
| **Tool call parameter validation** | OWASP LLM08 (Excessive Agency). When an agent calls tools like `exec`, `fs_write`, or `sessions_spawn`, the parameters must be validated against the session's permission scope before execution, not just at registration time. | MEDIUM | `dangerous-tools.ts` defines deny lists but runtime parameter validation (e.g., blocking path traversal in `fs_write`, command injection in `exec` args) needs strengthening. |
| **Cross-session isolation enforcement** | Multi-channel gateways that share agent state across channels risk data leakage. A Telegram contact should not be able to extract information from a Discord session's context. Session keys exist but enforcement at the data access layer is what matters. | HIGH | Session key structure (`agent:channel:peer`) provides namespace isolation but needs enforcement at the transcript/memory access layer. Cross-session tool calls (`sessions_send`, `sessions_spawn`) need scoped authorization, not just deny lists. |
| **Output filtering (PII/secret detection)** | OWASP LLM02 (Sensitive Information Disclosure). Agent responses can leak API keys, tokens, file paths, IP addresses, or PII from system context. Must detect and redact before delivery to channel. | MEDIUM | `logging.redactSensitive` exists for logs but agent responses to users are not filtered. Need regex + heuristic detection for common secret patterns (AWS keys, JWT tokens, connection strings) and PII (emails, phone numbers, SSNs). |
| **Structured security audit logging** | Every security-relevant event (tool invocations, auth attempts, policy violations, injection detections) must produce structured, queryable log entries. Essential for incident response and compliance. | MEDIUM | Security audit exists as a point-in-time scan (`runSecurityAudit`). Needs continuous event emission with structured fields: timestamp, event type, session key, channel, severity, action taken. |
| **Rate limiting per session/channel/peer** | Without rate limiting at the session level, a single peer can exhaust LLM quota, flood tool execution, or brute-force prompt injection variations. | LOW | Gateway auth rate limiting is configurable. Extend to per-session/per-peer message rate and tool invocation rate. |
| **Secret scanning in agent context** | Agent system prompts, skills, and included files can accidentally contain secrets. Pre-flight scanning before these reach the LLM prevents leakage. | LOW | `collectSecretsInConfigFindings` exists in audit. Extend to runtime pre-flight scanning of system prompts and skill content before LLM submission. |

### Differentiators (Competitive Advantage)

Features that go beyond baseline. For a personal AI gateway, these create meaningful trust.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Layered prompt injection defense (detect + classify + respond)** | Move beyond regex pattern matching to a multi-layer system: (1) regex fast-path for known patterns, (2) heuristic scoring for suspicious structure, (3) optional external classifier (Lakera Guard API or local model). Log detections, wrap content with stronger isolation, or reject outright based on confidence. Most gateways only do layer 1. | HIGH | OpenClaw's `detectSuspiciousPatterns` is layer 1. Adding layers 2-3 with configurable response policies (log/warn/wrap/reject) would be genuinely differentiated. Lakera Guard offers a REST API for real-time classification but adds a network dependency. |
| **Tool invocation audit trail with trace IDs** | Every tool call gets a trace ID that propagates through sub-agent spawns, linking the full execution chain. Enables post-hoc analysis of "what happened and why" across multi-step agent workflows. | MEDIUM | W3C Trace Context format is the standard. Each inbound message generates a trace ID, and every tool call, sub-agent spawn, and outbound message references it. Store as structured JSON alongside session transcripts. |
| **Data exfiltration canaries** | Inject synthetic canary tokens into agent context (fake API keys, fake internal URLs). If these appear in outbound messages or tool call parameters, flag as exfiltration attempt. Zero false positives because canaries are never legitimate. | MEDIUM | Unique to self-hosted gateways where you control the full pipeline. Canaries are injected at system prompt assembly time and checked at output + tool parameter validation. Simple, elegant, low false positive rate. |
| **Per-channel security policy profiles** | Different channels have different trust levels. WhatsApp DMs from the owner are high-trust; a public Discord server is low-trust. Allow per-channel security profiles that adjust: tool access, output filtering strictness, injection detection sensitivity, rate limits. | MEDIUM | OpenClaw already has per-channel config and `dmScope` settings. Extending this to security profiles (trust tiers: owner/trusted/untrusted/public) with cascading policy defaults is natural. |
| **Content Security Policy for agent responses** | Define what the agent is allowed to include in responses: no URLs to external domains, no code blocks in certain channels, no file paths, no system information. Like browser CSP but for LLM output. | MEDIUM | Configurable per channel. Regex/pattern-based output rules that strip or reject responses containing disallowed content classes. |
| **Immutable security event log** | Append-only, tamper-evident log of all security events. Hash-chained entries prevent retroactive deletion. Essential for forensic analysis after a suspected compromise. | HIGH | Separate from application logs. Write to a dedicated file (or SQLite WAL) with hash chain. Each entry includes hash of previous entry. Verify chain integrity on startup and via CLI command. |
| **Automated security regression testing** | Built-in prompt injection test suite that operators can run against their configuration. Ships with known attack payloads and expected defense responses. Validates that security controls are actually working. | MEDIUM | `openclaw security test` command that runs a battery of injection payloads through the full pipeline and reports which ones were caught vs missed. Like a built-in red team. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems. Deliberately NOT building these.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **LLM-based prompt injection classification (local model)** | "Use AI to detect AI attacks" seems elegant. | Running a classification model adds 100-500ms latency per message, requires GPU/memory, creates a second attack surface (the classifier itself can be injected), and produces false positives that block legitimate messages. For a personal gateway, the cost/benefit is terrible. | Use regex fast-path + heuristic scoring + optional external API (Lakera Guard) for high-risk channels only. Keep the hot path fast. |
| **Full message content encryption at rest** | "Encrypt everything" sounds secure. | Session transcripts need to be readable by the agent runtime for context. Encryption at rest adds key management complexity, breaks search/debugging, and provides minimal benefit for a single-user local system where disk access = full compromise anyway. | Use filesystem permissions (already audited), full-disk encryption at the OS level, and `logging.redactSensitive` for log output. |
| **Allowlisting specific LLM response content** | "Only allow responses matching a whitelist." | Overly restrictive output filtering kills agent usefulness. You end up in a never-ending game of adding exceptions. | Use blocklist-based output filtering (block secrets, PII patterns, disallowed domains) rather than allowlisting. Blocklists are less likely to break legitimate functionality. |
| **Real-time content moderation (toxicity/harm scoring)** | "Filter harmful AI responses." | For a personal assistant, the owner decides what is appropriate. Adding toxicity scoring creates false positives on legitimate content (medical, legal, security discussions) and adds latency. Enterprise products need this; personal gateways do not. | Provide as optional plugin for operators who want it, not as core security feature. |
| **Mutual TLS for every channel connection** | "Zero trust networking." | Most channel APIs (Telegram, Discord, WhatsApp) are client-initiated with their own auth. mTLS adds certificate management burden with no security benefit for channels that already authenticate via tokens/webhooks. | Use Tailscale Serve (already supported) for gateway exposure. Keep channel auth as-is. mTLS only if self-hosting webhook receivers behind a reverse proxy. |
| **Sandboxed LLM inference** | "Run the model in a sandbox." | OpenClaw connects to external LLM APIs (Anthropic, OpenAI, etc.), not local models. Sandboxing the API client adds no security value. Tool execution is already sandboxed (Docker/PTY). | Keep tool sandbox (Docker) strong. Focus security on the data flowing to/from LLMs, not the API call itself. |

## Feature Dependencies

```
Input Sanitization Pipeline
    |
    +--requires--> Structured Security Event Logging (to log detections)
    |
    +--enhances--> Layered Prompt Injection Defense (sanitization feeds classifier)

Tool Call Parameter Validation
    |
    +--requires--> Structured Security Event Logging (to log violations)
    |
    +--enhances--> Cross-Session Isolation (validates cross-session tool params)

Cross-Session Isolation Enforcement
    |
    +--requires--> Per-Channel Security Policy Profiles (trust tiers determine access)
    |
    +--requires--> Structured Security Event Logging (to log isolation breaches)

Output Filtering (PII/Secret Detection)
    |
    +--enhances--> Data Exfiltration Canaries (canary check is an output filter)
    |
    +--enhances--> Content Security Policy (CSP rules are output filters)
    |
    +--requires--> Structured Security Event Logging (to log redactions)

Per-Channel Security Policy Profiles
    |
    +--enhances--> Rate Limiting (rates vary by trust tier)
    |
    +--enhances--> Input Sanitization (strictness varies by trust tier)
    |
    +--enhances--> Tool Call Parameter Validation (tool access varies by trust tier)

Structured Security Event Logging
    |
    +--enhances--> Immutable Security Event Log (structured events feed the append-only log)
    |
    +--enhances--> Tool Invocation Audit Trail (trace IDs are event metadata)
```

### Dependency Notes

- **Structured Security Event Logging is the foundation:** Nearly every other feature depends on emitting structured events. Build this first.
- **Input Sanitization Pipeline requires a centralized entry point:** Currently external content wrapping is called per-site. Centralizing it is prerequisite for consistent protection.
- **Per-Channel Security Policy Profiles unlock graduated security:** Once trust tiers exist, every other feature can adjust its behavior based on channel context.
- **Output Filtering and Exfiltration Canaries are complementary:** Canaries are a special case of output filtering with zero false positives.
- **Immutable Log depends on Structured Logging:** You cannot hash-chain events that are not structured. Build structured logging first, then add immutability.

## MVP Definition

### Launch With (v1 -- Security Hardening Milestone)

Minimum viable security hardening -- address the OWASP LLM Top 10 gaps.

- [ ] **Structured security event logging** -- Foundation for all other features. Emit typed events for auth, tool calls, injection detections, policy violations.
- [ ] **Centralized input sanitization pipeline** -- Single entry point for all inbound messages. Consolidate `detectSuspiciousPatterns` + `wrapExternalContent` into a pipeline every channel adapter calls.
- [ ] **Tool call parameter validation** -- Runtime validation of tool arguments against session policy. Block path traversal, command injection, cross-session access in parameters.
- [ ] **Output filtering (secret/PII detection)** -- Regex-based detection of API keys, tokens, credentials, and common PII patterns in agent responses. Redact before delivery.
- [ ] **Rate limiting per session/peer** -- Extend gateway auth rate limiting to per-session message and tool invocation rates.
- [ ] **Secret scanning in agent context** -- Pre-flight scan of system prompts and skill content before LLM submission.

### Add After Validation (v1.x)

Features to add once core security pipeline is validated and stable.

- [ ] **Cross-session isolation enforcement** -- Add authorization checks at transcript/memory access layer. Scope cross-session tool calls.
- [ ] **Per-channel security policy profiles** -- Trust tiers (owner/trusted/untrusted/public) with cascading defaults for all security controls.
- [ ] **Layered prompt injection defense** -- Add heuristic scoring (layer 2) and optional Lakera Guard integration (layer 3) on top of regex detection.
- [ ] **Data exfiltration canaries** -- Inject synthetic tokens into agent context, check outbound content.
- [ ] **Tool invocation audit trail with trace IDs** -- W3C Trace Context propagation through tool calls and sub-agent spawns.

### Future Consideration (v2+)

Features to defer until the core hardening is battle-tested.

- [ ] **Immutable security event log** -- Hash-chained append-only log for forensic analysis. Depends on structured logging being stable.
- [ ] **Content Security Policy for agent responses** -- Per-channel output content rules.
- [ ] **Automated security regression testing** -- Built-in `openclaw security test` red team suite.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Structured security event logging | HIGH | LOW | P1 |
| Centralized input sanitization pipeline | HIGH | MEDIUM | P1 |
| Tool call parameter validation | HIGH | MEDIUM | P1 |
| Output filtering (secret/PII detection) | HIGH | MEDIUM | P1 |
| Rate limiting per session/peer | MEDIUM | LOW | P1 |
| Secret scanning in agent context | MEDIUM | LOW | P1 |
| Cross-session isolation enforcement | HIGH | HIGH | P2 |
| Per-channel security policy profiles | HIGH | MEDIUM | P2 |
| Layered prompt injection defense | MEDIUM | HIGH | P2 |
| Data exfiltration canaries | MEDIUM | MEDIUM | P2 |
| Tool invocation audit trail (trace IDs) | MEDIUM | MEDIUM | P2 |
| Immutable security event log | LOW | HIGH | P3 |
| Content Security Policy for responses | LOW | MEDIUM | P3 |
| Automated security regression testing | MEDIUM | MEDIUM | P3 |

**Priority key:**
- P1: Must have for security hardening milestone
- P2: Should have, add in subsequent iteration
- P3: Nice to have, future consideration

## Competitor Feature Analysis

| Feature | Lakera Guard | Portkey AI Gateway | LiteLLM Proxy | OpenClaw (Current) | OpenClaw (Target) |
|---------|-------------|-------------------|---------------|-------------------|-------------------|
| Prompt injection detection | ML classifier, 100+ languages | Basic keyword filtering | None | Regex patterns, log-only | Layered: regex + heuristic + optional API |
| Output filtering | PII detection, content moderation | Token/cost limits only | None | Log redaction only | Secret/PII detection + redaction |
| Tool call validation | N/A (API-only) | N/A | N/A | Deny lists | Runtime parameter validation |
| Audit logging | Dashboard + API | Request/response logging | Request logging | Point-in-time scan | Continuous structured events |
| Session isolation | N/A (stateless) | Per-virtual-key isolation | Per-key isolation | Session key namespacing | Enforced data isolation |
| Rate limiting | Per-API-key | Per-virtual-key, per-model | Per-key, per-model | Gateway auth only | Per-session, per-peer, per-channel |
| Security testing | N/A | N/A | N/A | Security audit CLI | Audit CLI + red team suite |

Note: Lakera Guard and Portkey are SaaS products. LiteLLM is the closest self-hosted comparison but focuses on LLM proxy, not agent gateway. OpenClaw's differentiator is that it controls the full pipeline from channel ingest to tool execution to response delivery, enabling defenses at every layer.

## Sources

- [OWASP Top 10 for LLM Applications 2025](https://owasp.org/www-project-top-10-for-large-language-model-applications/) -- MEDIUM confidence (official standards body)
- [OWASP LLM01:2025 Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/) -- MEDIUM confidence (official reference)
- [OpenAI: Hardening Atlas Against Prompt Injection](https://openai.com/index/hardening-atlas-against-prompt-injection/) -- MEDIUM confidence (vendor-specific but illustrative of defense patterns)
- [OpenAI: Understanding Prompt Injections](https://openai.com/index/prompt-injections/) -- MEDIUM confidence (foundational research)
- [Lakera Guard Documentation](https://docs.lakera.ai/guard) -- MEDIUM confidence (product docs, verified API availability)
- [Giskard: Cross Session Leak](https://www.giskard.ai/knowledge/cross-session-leak-when-your-ai-assistant-becomes-a-data-breach) -- LOW confidence (single source)
- [MCP Security for Multi-Tenant AI Agents](https://prefactor.tech/blog/mcp-security-multi-tenant-ai-agents-explained) -- LOW confidence (single source)
- [Unit42: AI Agent Attacks Q4 2025](https://www.esecurityplanet.com/artificial-intelligence/ai-agent-attacks-in-q4-2025-signal-new-risks-for-2026/) -- LOW confidence (threat landscape overview)
- [MintMCP: AI Agent Security Guide 2026](https://www.mintmcp.com/blog/ai-agent-security) -- LOW confidence (vendor content)
- [Airia: AI Security 2026](https://airia.com/ai-security-in-2026-prompt-injection-the-lethal-trifecta-and-how-to-defend/) -- LOW confidence (vendor content)
- [Tetrate: MCP Audit Logging](https://tetrate.io/learn/ai/mcp/mcp-audit-logging) -- LOW confidence (single source, but W3C Trace Context is a well-known standard)
- [Kong: PII Sanitization for LLMs](https://konghq.com/blog/enterprise/building-pii-sanitization-for-llms-and-agentic-ai) -- LOW confidence (vendor content)
- OpenClaw codebase analysis: `src/security/`, `src/routing/session-key.ts`, `src/agents/` -- HIGH confidence (direct source inspection)

---
*Feature research for: AI gateway security hardening*
*Researched: 2026-02-15*

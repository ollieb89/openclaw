# Project Research Summary

**Project:** OpenClaw AI Gateway Security Hardening
**Domain:** Personal AI assistant gateway security (multi-channel, tool-using agent)
**Researched:** 2026-02-15
**Confidence:** MEDIUM-HIGH

## Executive Summary

OpenClaw is a personal AI gateway connecting messaging channels (WhatsApp, Telegram, Discord, Signal, etc.) to an AI agent runtime with tool execution capabilities. Security hardening for this type of system requires defense-in-depth across five critical layers: channel authentication, input sanitization, session isolation, tool execution guardrails, and output filtering. Research shows that prompt injection — the #1 LLM security risk per OWASP — cannot be fully prevented through filtering alone; instead, defenses must assume injection will succeed and contain the blast radius through independent authorization at the tool execution layer.

The recommended approach layers TypeScript-native security libraries (hai-guardrails for injection detection, Arcjet redact for PII, bottleneck for rate limiting) around OpenClaw's existing security foundations. The codebase already has SSRF guards, tool deny-lists, boundary markers for external content, and session isolation primitives, but critical gaps remain: regex-based injection detection provides monitoring but not enforcement, tool policies use deny-lists (allowing new tools by default), and output filtering is limited to log redaction. The hardening roadmap must address these gaps while avoiding common pitfalls like trusting the LLM to enforce security policies or treating session isolation as complete when shared resources (memory, file system) lack enforcement.

Key risks include data exfiltration through legitimate tool channels (agent using web_fetch to send data to attacker URLs), cross-session contamination via shared agent memory, and memory poisoning where injected instructions persist across sessions. Mitigation relies on fail-closed security filters at each pipeline stage, threat score accumulation per session to detect escalation patterns, and enforcing all security-critical decisions in application code rather than LLM prompts. The architecture must treat the Pi agent runtime as an unmodifiable black box and enforce all security policies at the gateway layer before and after runtime interaction.

## Key Findings

### Recommended Stack

The security hardening stack focuses on TypeScript-native libraries that run locally without external API dependencies, matching OpenClaw's ESM-only architecture and single-user deployment model.

**Core technologies:**
- **@presidio-dev/hai-guardrails (^1.12.0)**: Multi-threat guardrails covering injection, leakage, PII, secrets, and toxicity — most comprehensive TypeScript-native library with 10 guard types and configurable thresholds for heuristic + LLM-based detection without external API calls
- **@arcjet/redact (latest)**: WASM-based PII detection and reversible redaction running entirely locally — no cloud dependency, catches email, phone, credit card, IP patterns beyond simple regex
- **bottleneck (^2.19.5)**: Token-budget rate limiting with reservoir model — naturally maps to "X tokens per hour per user" constraints and supports Redis clustering if multi-tenant expansion is needed
- **helmet (^8.x)**: HTTP security headers for Control UI with default CSP blocking external image loading — defense-in-depth against markdown exfiltration attacks in the web surface
- **Custom output sanitizer**: No library exists for stripping markdown image injection patterns (`![](url)`, `<img>`) from LLM output; build a focused module extending the existing `external-content.ts` pattern

**Critical version requirements:**
- All libraries must support Node >= 18 and ESM (matches OpenClaw requirements)
- @arcjet/redact is ESM-only (no CommonJS support)

### Expected Features

Research reveals six P1 (must-have) features for security hardening milestone, five P2 (should-have) features for subsequent iterations, and three P3 (nice-to-have) deferrals.

**Must have (table stakes — P1):**
- **Structured security event logging**: Foundation for all other features; emit typed events for auth, tool calls, injection detections, policy violations with timestamp, event type, session key, channel, severity
- **Centralized input sanitization pipeline**: Single entry point consolidating `detectSuspiciousPatterns` + `wrapExternalContent` that every channel adapter routes through before MsgContext creation
- **Tool call parameter validation**: Runtime validation of tool arguments (block path traversal, command injection, cross-session access) independent of LLM cooperation
- **Output filtering (secret/PII detection)**: Regex-based detection of API keys, tokens, credentials, common PII patterns in agent responses with redaction before channel delivery
- **Rate limiting per session/peer**: Extend gateway auth rate limiting to per-session message rate and tool invocation rate
- **Secret scanning in agent context**: Pre-flight scan of system prompts and skill content before LLM submission

**Should have (competitive — P2):**
- **Cross-session isolation enforcement**: Authorization checks at transcript/memory access layer; scope cross-session tool calls (`sessions_send`, `sessions_spawn`)
- **Per-channel security policy profiles**: Trust tiers (owner/trusted/untrusted/public) with cascading defaults for all security controls based on channel context
- **Layered prompt injection defense**: Add heuristic scoring (layer 2) and optional Lakera Guard integration (layer 3) on top of regex detection (layer 1)
- **Data exfiltration canaries**: Inject synthetic tokens into agent context (fake API keys, internal URLs); flag if they appear in outbound messages or tool parameters
- **Tool invocation audit trail with trace IDs**: W3C Trace Context propagation through tool calls and sub-agent spawns for post-hoc "what happened and why" analysis

**Defer (v2+ — P3):**
- **Immutable security event log**: Hash-chained append-only log for forensic analysis (depends on structured logging being stable)
- **Content Security Policy for agent responses**: Per-channel output content rules (no URLs to external domains, no code blocks, no file paths)
- **Automated security regression testing**: Built-in `openclaw security test` command running injection payloads through the pipeline

**Anti-features (deliberately NOT building):**
- LLM-based local classification model (100-500ms latency, GPU/memory overhead, secondary attack surface)
- Full message content encryption at rest (breaks search/debugging, minimal benefit for single-user local system)
- Allowlisting specific LLM response content (overly restrictive, breaks legitimate functionality)
- Real-time toxicity/harm scoring (false positives on medical/legal/security content)
- Mutual TLS for every channel connection (certificate management burden with no security benefit)

### Architecture Approach

Security hardening integrates at five interception points in the existing message pipeline, following a middleware chain pattern already used in tool-policy-pipeline. Each layer is independent, fail-closed (errors block rather than allow), and testable.

**Major components:**
1. **InputFilter** — Scans inbound messages before MsgContext creation using composable middleware (injection detection, PII check, content limits); extends existing `external-content.ts` patterns
2. **SessionSecurityContext** — Tracks per-session threat score (0-100, decays over time) and enforces progressive restrictions (elevated = all tool calls require approval; restricted = read-only tools only)
3. **ToolPolicyPipeline (enhanced)** — Extends existing `tool-policy-pipeline.ts` from deny-list to allow-list posture; validates tool call parameters at runtime independent of LLM decision
4. **OutputFilter** — Scans LLM response blocks before channel delivery (PII leaks, credential exposure, exfiltration patterns); integrates with reply dispatcher
5. **SecurityAuditLog (extended)** — Extends existing config audit (`security/audit.ts`) to continuous runtime event logging; centralized sink for all security components

**Data flow pattern:**
- Inbound: Channel adapter → InputFilter (fast regex + heuristic) → MsgContext annotation → SessionSecurityContext (accumulate threat score) → ToolPolicyPipeline → Pi runner
- Tool execution: Pi runner tool call → ToolPolicyPipeline (allow/deny check) → ExecApprovalManager (if dangerous) → SandboxRuntime → NEW: Tool result sanitization before LLM re-ingestion
- Outbound: Pi runner response stream → OutputFilter (PII/credential scan, redaction) → Reply dispatcher → Channel adapter

**Key patterns:**
- **Middleware chain for security filters**: Each filter receives context, can annotate/modify/reject; mirrors existing tool-policy pattern
- **Threat score accumulation**: Session-level score catches escalation patterns that per-message scanning misses (prompt injection is rarely a single message)
- **Fail-closed checks**: Filter errors default to blocking rather than allowing; prevents crashed filters from silently passing malicious content
- **Content boundary markers**: Extend existing `wrapExternalContent` to tool results and memory retrieval

### Critical Pitfalls

Research identified seven critical pitfalls and their prevention strategies, with mapping to roadmap phases.

1. **Treating Prompt Injection as a Solvable Filter Problem** — Attackers bypass regex/keyword filters with encoding tricks, multilingual payloads, Unicode homoglyphs. OpenAI explicitly stated (Dec 2025) that prompt injection "is unlikely to ever be fully solved." Prevention: Accept that defense is mitigation, not prevention; design for "what happens when injection succeeds" rather than "how do I stop all injection"; enforce authorization at tool execution layer independent of LLM cooperation. **Phase to address: Phase 1 (Foundation)**

2. **Session Isolation Only at Application Layer** — Sessions appear isolated (separate session keys) but share underlying resources: agent runtime memory, file system sandbox, cron delivery targets. Attackers on one channel access another channel's conversation through shared agent context. Prevention: Map every shared resource (memory, file system, tool state, conversation history, cron contexts) and verify session-scoped access controls; treat Pi agent runtime as untrusted black box; test cross-session contamination explicitly. **Phase to address: Phase 2 (Session Hardening)**

3. **Tool Policy Deny-Lists Instead of Allow-Lists** — OpenClaw's current deny-list approach (`DEFAULT_GATEWAY_HTTP_TOOL_DENY`) means new tools are automatically permitted unless someone remembers to add them. Prevention: Invert to default-deny with explicit allow-lists; require explicit opt-in per tool; make plugin/skill tools go through mandatory security gate on install. **Phase to address: Phase 1 (Foundation)**

4. **Trusting the LLM to Enforce Security Policies** — System prompts like `EXTERNAL_CONTENT_WARNING` tell the LLM to ignore injected instructions, but research shows inter-agent trust exploitation has 84.6% success rate vs 46.2% for direct injection. Prevention: Every security-critical decision must be enforced in application code, not LLM prompts; tool authorization checks at execution layer regardless of LLM decision; rate limiting on sensitive operations; output validation before tool execution. **Phase to address: Phase 1 (Foundation)**

5. **Data Exfiltration Through Legitimate Tool Channels** — Agent uses `web_fetch` to send sensitive data to attacker URLs or messaging tools to forward to unauthorized recipients. Tools are "allowed" but intent is malicious. Prevention: Implement data flow policies (data from session A must not flow to different user/channel); domain allowlist for web fetch/browser tools; scope outbound messages to originating session's channel; monitor large context windows passed to URL-fetch tools. **Phase to address: Phase 3 (Data Flow Controls)**

6. **Security Audit Does Not Cover Plugin/Extension Surface** — Core gateway hardened but 36+ extensions and user-installable skills bypass hardened code paths; plugins run with same privileges and access shared state. Prevention: Treat plugin code as untrusted by default; make deep code safety scan mandatory on install; plugin-registered tools go through same authorization flow as core tools; audit plugin dependencies separately (supply chain risk). **Phase to address: Phase 2 (Session Hardening) + Phase 4 (Supply Chain)**

7. **Memory/Context Poisoning Via Persistent State** — Attacker injects malicious instructions into agent's long-term memory (via `src/memory/` subsystem); poisoned memories persist across sessions and affect all future interactions. Prevention: Apply sanitization on memory write; tag memories with provenance (session, channel, user); filter memories by trust level on retrieval; implement memory versioning and rollback; periodic memory integrity audits. **Phase to address: Phase 3 (Data Flow Controls)**

## Implications for Roadmap

Based on combined research, suggested four-phase structure with clear dependencies and progressive hardening:

### Phase 1: Foundation (Security Architecture & Event Logging)
**Rationale:** All other security features depend on structured event logging and establishing architectural principles. This phase sets the mental model (prompt injection is mitigated, not prevented; enforcement happens in code, not prompts) and builds the audit log backbone that every subsequent component writes to.

**Delivers:**
- Structured security event logging (SecurityAuditLog extension with runtime events)
- SecurityFilterTypes (middleware chain type definitions)
- Basic InputFilter (extends existing `detectSuspiciousPatterns` to centralized pipeline)
- Tool policy posture shift (deny-list → allow-list for new tools)
- Architectural decision: all security policies enforced at gateway layer, not in Pi runtime

**Addresses features:**
- Structured security event logging (P1)
- Centralized input sanitization pipeline (P1) — basic version
- Tool call parameter validation (P1) — posture change

**Avoids pitfalls:**
- Pitfall 1 (treating injection as solvable filter problem) — establishes mitigation mindset
- Pitfall 3 (deny-lists) — inverts to allow-list posture
- Pitfall 4 (trusting LLM to enforce policies) — establishes code-enforcement principle

**Research flag:** Standard patterns (security event logging, middleware pipelines well-documented); skip `/gsd:research-phase`

### Phase 2: Input & Session Hardening
**Rationale:** After foundation is established, build the first line of defense (input scanning) and critical isolation enforcement (session boundaries). Input filtering catches majority of threats; session isolation prevents damage when filtering fails.

**Delivers:**
- Full InputFilter implementation (regex fast-path + heuristic scoring + PII detection)
- SessionSecurityContext (threat score accumulation, progressive restrictions)
- Cross-session isolation enforcement (transcript/memory access authorization)
- Enhanced ExecApproval integration (threat-score-based gating)
- Plugin security gates (mandatory code scan on install)

**Addresses features:**
- Centralized input sanitization pipeline (P1) — full implementation
- Rate limiting per session/peer (P1)
- Secret scanning in agent context (P1)
- Cross-session isolation enforcement (P2)
- Per-channel security policy profiles (P2) — basic trust tiers

**Uses stack:**
- @presidio-dev/hai-guardrails (injection + PII guards)
- @arcjet/redact (PII detection)
- bottleneck (rate limiting)

**Implements architecture:**
- InputFilter component
- SessionSecurityContext component
- Enhanced ToolPolicyPipeline

**Avoids pitfalls:**
- Pitfall 2 (session isolation only at application layer) — enforces isolation at data access layer
- Pitfall 6 (plugin surface not covered) — gates plugin installation

**Research flag:** Needs research — hai-guardrails integration patterns, threshold tuning for different channel trust levels. Recommend `/gsd:research-phase` for library integration.

### Phase 3: Execution & Output Hardening
**Rationale:** With input and session layers secured, harden the execution pipeline (tool call validation, sandbox policies) and output layer (leak detection, exfiltration prevention). This phase closes the data flow loop.

**Delivers:**
- Tool call parameter validation (runtime checks for path traversal, command injection, cross-session access)
- ToolResultSanitizer (scan tool outputs before LLM re-ingestion)
- OutputFilter (secret/PII detection in responses, exfiltration pattern detection)
- Data exfiltration canaries (synthetic tokens in context, outbound checking)
- Memory poisoning defenses (provenance tagging, trust-based filtering)

**Addresses features:**
- Tool call parameter validation (P1) — full implementation
- Output filtering (P1) — full implementation
- Data exfiltration canaries (P2)
- Layered prompt injection defense (P2) — optional Lakera Guard layer 3

**Uses stack:**
- @arcjet/redact (output PII redaction)
- Custom output sanitizer (markdown image stripping)
- helmet (CSP headers for Control UI)

**Implements architecture:**
- ToolResultSanitizer component
- OutputFilter component
- Enhanced sandbox policies

**Avoids pitfalls:**
- Pitfall 5 (data exfiltration through legitimate tools) — domain allowlists, data flow policies
- Pitfall 7 (memory poisoning) — provenance tagging, sanitization on write

**Research flag:** Standard patterns (output filtering, parameter validation well-documented); skip `/gsd:research-phase`

### Phase 4: Monitoring & Advanced Controls
**Rationale:** After core hardening is operational, add advanced monitoring (audit trail with trace IDs, immutable logs) and optional enhancements (CSP for responses, regression testing). These are force multipliers on existing defenses.

**Delivers:**
- Tool invocation audit trail with W3C Trace Context IDs
- Immutable security event log (hash-chained, tamper-evident)
- Security dashboard in Control UI (Lit components, audit log queries)
- Automated security regression testing (`openclaw security test`)
- Content Security Policy for agent responses (per-channel output rules)

**Addresses features:**
- Tool invocation audit trail (P2)
- Immutable security event log (P3)
- Automated security regression testing (P3)
- Content Security Policy for responses (P3)

**Uses stack:**
- W3C Trace Context standard
- Custom hash-chain implementation for immutable log

**Implements architecture:**
- Security Dashboard (Control UI)
- Anomaly Detection component
- Test suite harness

**Avoids pitfalls:**
- Provides forensic capabilities for post-incident analysis
- Continuous validation that defenses remain effective

**Research flag:** Needs research — W3C Trace Context propagation through Pi runtime (black box), hash-chain design for tamper-evident logs. Recommend `/gsd:research-phase` for trace context integration.

### Phase Ordering Rationale

- **Foundation first**: Event logging is the backbone; every other component depends on it. Architectural principles (mitigation not prevention, code-enforced not prompt-enforced) must be established before building controls.
- **Input before execution**: Catching threats at the perimeter is cheaper than containing them after tool execution. Input sanitization has highest ROI.
- **Session isolation before data flow**: Can't enforce data flow policies without session boundaries being solid. Cross-session contamination must be prevented before worrying about cross-channel exfiltration.
- **Output filtering after tool validation**: Output filtering catches leaks but is lower priority than preventing bad tool execution in the first place. It's the last line of defense, not the first.
- **Monitoring last**: Audit trails and regression testing are force multipliers on existing defenses. Build them after core hardening is operational and stable.

### Research Flags

**Phases likely needing deeper research during planning:**
- **Phase 2 (Input & Session Hardening):** hai-guardrails integration patterns, threshold tuning for different channel trust levels, session isolation enforcement at memory/file system layer (Pi runtime is black box)
- **Phase 4 (Monitoring & Advanced Controls):** W3C Trace Context propagation through unmodifiable Pi runtime, hash-chain design for immutable logs, Control UI security dashboard design

**Phases with standard patterns (skip research-phase):**
- **Phase 1 (Foundation):** Security event logging, middleware pipelines, allow-list patterns well-documented
- **Phase 3 (Execution & Output Hardening):** Output filtering, parameter validation, PII redaction well-documented

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM | hai-guardrails is actively maintained (16 releases, last Feb 2026) but only 10 guard types; Arcjet redact is well-documented but WASM-based detection accuracy not verified in production; bottleneck is battle-tested (8M+ weekly downloads); custom output sanitizer has clear patterns from NVIDIA/OWASP but no library exists |
| Features | MEDIUM-HIGH | OWASP LLM Top 10 2025 and Agentic Top 10 2026 provide authoritative threat model; feature priorities validated against competitor analysis (Lakera Guard, Portkey, LiteLLM); OpenClaw codebase inspection reveals existing foundation is solid; gap analysis is clear |
| Architecture | HIGH | OpenClaw codebase already has middleware pattern (`tool-policy-pipeline.ts`), external content wrapping, exec approval gating, sandbox isolation; security layers integrate naturally at existing pipeline stages; fail-closed pattern is standard security practice |
| Pitfalls | HIGH | OWASP, NCSC, OpenAI sources corroborate that prompt injection is unsolvable; ICLR 2025 research shows 84.6% inter-agent exploitation success rate; codebase inspection confirms current gaps (regex-only detection, deny-lists, application-layer isolation); recovery strategies are standard incident response |

**Overall confidence:** MEDIUM-HIGH

Domain is well-documented (OWASP frameworks, vendor research, government warnings), codebase has solid security foundations to build on, and recommended stack matches OpenClaw's architecture (ESM, TypeScript, local-first). Primary uncertainty is hai-guardrails production performance (threshold tuning, false positive rates) and Pi runtime black-box integration (session isolation enforcement, trace context propagation).

### Gaps to Address

Areas where research was inconclusive or needs validation during implementation:

- **hai-guardrails production tuning**: Library documentation covers API but not threshold recommendations per trust level. Will need experimentation during Phase 2 to determine optimal sensitivity for owner DM (lenient) vs public Discord server (strict) vs webhook (very strict). LOW RISK — can start with defaults and tune based on false positive telemetry.

- **Pi agent runtime session isolation**: Runtime is proprietary and unmodifiable. Research confirms isolation must happen at gateway layer, but actual enforcement points for memory/file system/tool state need discovery during Phase 2 implementation. MEDIUM RISK — may discover shared resources that are harder to scope than expected. Mitigation: comprehensive cross-session contamination test suite.

- **Output sanitizer markdown injection patterns**: NVIDIA and Microsoft sources document the attack vector (embedding data in image URLs) but not comprehensive regex patterns. Will need to build pattern library incrementally and test against adversarial examples. LOW RISK — pattern is straightforward, can start with basic `![](url)` and `<img>` stripping and expand based on pen testing.

- **W3C Trace Context through Pi runtime**: Standard is well-documented but integrating with an unmodifiable runtime may require workarounds (trace IDs in metadata, separate correlation in gateway layer). MEDIUM RISK — may not get true end-to-end traces through agent execution. Mitigation: defer to Phase 4, non-critical for core hardening.

- **Plugin/extension supply chain audit**: OpenClaw has 36+ extensions with independent `node_modules`. Research confirms supply chain risk but tooling for automated dependency scanning at scale needs investigation. LOW-MEDIUM RISK — can start with manual code scanning (existing `skill-scanner.ts` pattern) and add automated dependency audit later. Mitigation: Phase 2 gates plugin installation, Phase 4 adds continuous monitoring.

## Sources

### Primary (HIGH confidence)
- OpenClaw codebase analysis: `src/security/` module, `src/agents/tool-policy-pipeline.ts`, `src/gateway/exec-approval-manager.ts`, `src/security/external-content.ts`, `src/security/audit.ts` — directly inspected existing security foundations
- [OWASP Top 10 for LLM Applications 2025](https://owasp.org/www-project-top-10-for-large-language-model-applications/) — authoritative framework for LLM security risks
- [OWASP LLM01:2025 Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/) — definitive reference on prompt injection taxonomy and defenses
- [OWASP Prompt Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html) — defense-in-depth patterns
- [NVIDIA AI Red Team blog](https://developer.nvidia.com/blog/practical-llm-security-advice-from-the-nvidia-ai-red-team/) — output sanitization, CSP, markdown exfiltration patterns
- [Microsoft indirect prompt injection defense](https://www.microsoft.com/en-us/msrc/blog/2025/07/how-microsoft-defends-against-indirect-prompt-injection-attacks) — markdown image exfiltration attack vectors
- [OpenAI: Understanding Prompt Injections](https://openai.com/index/prompt-injections/) — foundational research on injection permanence
- [UK NCSC warning on prompt injection (Dec 2025)](https://www.malwarebytes.com/blog/news/2025/12/prompt-injection-is-a-problem-that-may-never-be-fixed-warns-ncsc) — government assessment that injection is unsolvable

### Secondary (MEDIUM confidence)
- [hai-guardrails GitHub](https://github.com/presidio-oss/hai-guardrails) — v1.12.0, 10 guard types, 16 releases (actively maintained as of Feb 2026)
- [Arcjet redact docs](https://docs.arcjet.com/redact/quick-start/) — local WASM-based PII redaction
- [bottleneck npm](https://www.npmjs.com/package/bottleneck) — 8M+ weekly downloads, reservoir-based rate limiting
- [helmet.js](https://helmetjs.github.io/) — HTTP security headers, CSP defaults
- [OWASP Top 10 for Agentic Applications 2026](https://neuraltrust.ai/blog/owasp-top-10-for-agentic-applications-2026) — agent-specific risks (memory poisoning, inter-agent trust exploitation)
- [Lakera Guard Documentation](https://docs.lakera.ai/guard) — ML-based injection detection (alternative to hai-guardrails)
- [OpenAI: Hardening Atlas Against Prompt Injection](https://openai.com/index/hardening-atlas-against-prompt-injection/) — vendor-specific defense patterns
- [Lakera Guard self-hosting docs](https://platform.lakera.ai/docs/selfhosting) — container-based alternative (4GB RAM minimum)

### Tertiary (LOW confidence, needs validation)
- [vard GitHub](https://github.com/andersmyrmel/vard) — Zod-inspired injection detection (new project, small community)
- [Giskard: Cross Session Leak](https://www.giskard.ai/knowledge/cross-session-leak-when-your-ai-assistant-becomes-a-data-breach) — single source on cross-session contamination
- [MCP Security for Multi-Tenant AI Agents](https://prefactor.tech/blog/mcp-security-multi-tenant-ai-agents-explained) — single source
- [ICLR 2025 Agent Security Bench](https://proceedings.iclr.cc/paper_files/paper/2025/file/5750f91d8fb9d5c02bd8ad2c3b44456b-Paper-Conference.pdf) — peer-reviewed research (84.6% inter-agent exploitation success rate)
- [Indirect Prompt Injection analysis (Lakera)](https://www.lakera.ai/blog/indirect-prompt-injection) — injection taxonomy (vendor content but detailed)

---
*Research completed: 2026-02-15*
*Ready for roadmap: yes*

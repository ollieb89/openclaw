# OpenClaw

## What This Is

A personal AI assistant gateway that connects to messaging channels (WhatsApp, Telegram, Slack, Discord, Signal, iMessage, and more) and routes messages through a Pi agent runtime. v1.0 delivered security hardening (input screening, session isolation, plugin sandboxing, output filtering, tracing, audit logging). v1.1 focuses on live testing stabilization — getting all automated live tests green, WhatsApp end-to-end working, and improving test infrastructure.

## Core Value

Inbound messages from any channel cannot manipulate the agent into leaking system prompts, accessing unauthorized tools, exfiltrating user data, or affecting other channels' sessions.

## Requirements

### Validated

- ✓ Multi-channel messaging (Telegram, WhatsApp, Discord, Slack, Signal, iMessage, LINE, Feishu) — existing
- ✓ AI agent execution with Pi framework integration — existing
- ✓ Tool execution in sandboxed environments (Docker, PTY, browser) — existing
- ✓ Session-based conversation persistence — existing
- ✓ Config validation with Zod schemas — existing
- ✓ Auth profiles with provider rotation and failover — existing
- ✓ Tool policy system (allowlists/blocklists) — existing
- ✓ Gateway authentication (token/password) — existing
- ✓ SSRF/shell injection guards (recent hardening in 2026.2.14+) — existing
- ✓ Typed security events for auth, tool calls, injection, policy violations (SLOG-01) — v1.0
- ✓ No secrets in committed source; pre-commit hook prevents future commits (REPO-01) — v1.0
- ✓ API keys shown as prefix + length only, never trailing chars (TOOL-02) — v1.0
- ✓ Configurable per-channel input detection sensitivity (INPT-01) — v1.0
- ✓ Cross-session isolation at data access layer (SESS-01) — v1.0
- ✓ Workspace plugins require explicit consent before loading (PLUG-01) — v1.0
- ✓ Plugins declare capabilities; only declared APIs exposed (PLUG-02) — v1.0
- ✓ Per-channel Content Security Policy for agent responses (OUTP-01) — v1.0
- ✓ W3C Trace Context propagation through tool execution chains (TOOL-01) — v1.0
- ✓ Hash-chained append-only security event log with tamper detection (INFR-01) — v1.0

### Active

## Current Milestone: v1.1 Live Testing & Stabilization

**Goal:** All live tests pass, WhatsApp works end-to-end, live test infrastructure improved for ongoing reliability.

**Target features:**
- Fix all failing automated live tests
- WhatsApp end-to-end message flow working
- Improved live test infrastructure (coverage, reliability, developer experience)

### Out of Scope

- End-to-end encryption of message content — channel providers handle transport encryption
- Formal security certification (SOC2, ISO 27001) — this is practical hardening, not compliance
- Rewriting the agent runtime (Pi framework) — we harden around it, not inside it
- Mobile app security (iOS/Android/macOS) — separate concern, different attack surface
- Local LLM-based prompt injection classifier — high latency, GPU cost, second attack surface
- Full message content encryption at rest — single-user local system, use OS-level FDE
- Real-time toxicity/harm scoring — personal assistant, owner decides what's appropriate
- Mutual TLS for channel connections — channel APIs use their own auth

## Context

Shipped v1.0 Security Hardening with ~10K LOC TypeScript across security artifacts.
115 tests added, 0 regressions across existing test suite.
Tech stack: Node.js 22, TypeScript ESM, bun, Vitest, tsdown.

Key security artifacts: `src/security/`, `src/plugins/` (consent, capabilities), `src/utils/mask-api-key.ts`.

10 live test files exist covering: agent providers (Anthropic, Gemini, MiniMax, Zai), browser sessions (Browserless), gateway CLI, model profiles, and Deepgram audio. Current pass/fail state unknown — discovery is part of v1.1.

## Key Decisions

| Decision | Rationale | Outcome |
| --- | --- | --- |
| Harden around Pi framework, not inside it | Proprietary dependency, can't modify | ✓ Good — all hardening works at boundaries |
| Balanced approach (security vs UX) | User wants practical resilience, not lockdown | ✓ Good — fail-open delivery with fail-loud logging |
| Systematic over reactive | Current pattern of reactive fixes isn't scaling | ✓ Good — 5-phase structured approach delivered |
| Weighted scoring for input detection | Binary match too noisy; graduated thresholds needed | ✓ Good — 3 sensitivity levels with configurable thresholds |
| Proxy-based capability enforcement | Preserves TypeScript types; runtime enforcement | ✓ Good — legacy plugins get full access with deprecation warning |
| Promise-chain serialization for audit writes | Concurrent write safety without locks | ✓ Good — same proven pattern as cron/run-log.ts |
| Non-blocking startup verification | Avoid delaying gateway boot | ✓ Good — .then() pattern with tamper alerting |
| Run-keyed trace storage | Avoid circular imports with agent-events | ✓ Good — parallel Map works cleanly |

## Constraints

- **Compatibility**: All existing channel integrations must continue working — no breaking changes to message flow
- **Performance**: Security checks must not add noticeable latency to message processing
- **Pi framework**: Cannot modify the embedded Pi agent core (`@mariozechner/pi-*` packages) — must work around it
- **Runtime**: Node.js >= 22, TypeScript ESM, bun package manager
- **Testing**: Security tests must be automated and run in CI (Vitest)

---

_Last updated: 2026-02-16 after v1.1 milestone started_

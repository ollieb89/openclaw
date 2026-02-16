# Milestones

## v1.0 Security Hardening (Shipped: 2026-02-16)

**Phases completed:** 5 phases, 11 plans, 0 tasks

**Key accomplishments:**
- Unified API key masking with canonical `maskApiKey` utility — prefix-only format across all display sites
- Typed security event system with 12 event types routed through SubsystemLogger
- Weighted input screening with per-channel sensitivity (lenient/moderate/strict) and pipeline integration
- Cross-session data isolation enforced at the data access layer for transcripts and memory
- Plugin consent gates and Proxy-based capability-scoped API enforcement
- Per-channel output Content Security Policy with 6 detect+redact rules
- W3C Trace Context propagation through tool execution chains and sub-agent spawns
- Hash-chained tamper-evident audit log with CLI verification and gateway startup integrity checks

**Stats:** 115 tests, ~10K LOC across security artifacts, 0 regressions

---


---
phase: 03-plugin-security
plan: 02
subsystem: plugins
tags: [security, capabilities, proxy, manifest, runtime-enforcement]

# Dependency graph
requires:
  - phase: 01-foundation-repo-hygiene
    provides: security event logging infrastructure (emitSecurityEvent, SecurityEventType)
  - phase: 03-plugin-security
    plan: 01
    provides: consent gate infrastructure, plugin.consent.blocked event type
provides:
  - PLUGIN_CAPABILITIES map defining all API surfaces per capability
  - resolveEffectiveCapabilities for manifest-based capability resolution
  - createCapabilityScopedApi Proxy factory for runtime enforcement
  - plugin.capability.denied security event type
  - capabilities field in PluginManifest and PluginManifestRecord
affects: [plugin-management-ui, cli-plugin-info, plugin-sdk-docs]

# Tech tracking
tech-stack:
  added: []
  patterns: [proxy-based-capability-enforcement, capability-auto-inference]

key-files:
  created:
    - src/plugins/capabilities.ts
    - src/plugins/capabilities.test.ts
  modified:
    - src/plugins/manifest.ts
    - src/plugins/manifest-registry.ts
    - src/plugins/registry.ts
    - src/plugins/loader.ts
    - src/security/events.ts

key-decisions:
  - "Proxy-based enforcement: runtime Proxy gates all API access, preserving TypeScript types while blocking undeclared surfaces"
  - "Legacy backward compat: plugins without capabilities field get full API access with deprecation warning"
  - "Auto-inference: channels/providers manifest fields automatically add corresponding capabilities"

patterns-established:
  - "Capability scoping via Proxy: top-level methods throw on access, runtime sub-properties return undefined"
  - "Security event emission on every capability violation for audit trail"
  - "Always-allowed properties (id, name, logger, etc.) bypass capability checks"

# Metrics
duration: 5min
completed: 2026-02-16
---

# Phase 3 Plan 02: Plugin Capability Enforcement Summary

**Proxy-based capability enforcement gating plugin API access to declared capabilities, with auto-inference from manifest fields and security event emission on violations**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-15T23:13:23Z
- **Completed:** 2026-02-15T23:19:18Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Plugins declaring capabilities in their manifest only see the API surfaces they declared
- Undeclared registration method calls throw with descriptive error naming the required capability
- Undeclared property access returns undefined with security event emission for audit trail
- Legacy plugins without capabilities field continue to work with full access and deprecation warning
- 15 unit tests covering proxy enforcement, capability resolution, and security event emission

## Task Commits

Each task was committed atomically:

1. **Task 1: Capability definitions, proxy factory, and tests (TDD)** - `ccc41eb70` (feat)
2. **Task 2: Wire capability enforcement into loader and registry** - `1db59821a` (feat)

## Files Created/Modified
- `src/plugins/capabilities.ts` - Capability map, resolveEffectiveCapabilities, createCapabilityScopedApi proxy factory
- `src/plugins/capabilities.test.ts` - 15 unit tests for capability enforcement
- `src/plugins/manifest.ts` - Extended PluginManifest with optional capabilities field, parsing via normalizeStringList
- `src/plugins/manifest-registry.ts` - Added capabilities field to PluginManifestRecord, flows through buildRecord
- `src/plugins/registry.ts` - createApi accepts capabilities param, wraps API with proxy when capabilities declared
- `src/plugins/loader.ts` - Resolves effective capabilities from manifest, passes to createApi, adds deprecation diagnostic
- `src/security/events.ts` - Added plugin.capability.denied to SecurityEventType union

## Decisions Made
- Used Proxy-based runtime enforcement to preserve full TypeScript types for callers while blocking undeclared access at runtime
- Legacy plugins (no capabilities field) get full API access with a deprecation warning diagnostic, ensuring zero breaking changes
- Channels and providers fields in manifest auto-infer their corresponding capabilities, reducing manifest boilerplate
- Registration methods (functions) throw errors on undeclared access; property access returns undefined -- different behavior based on whether the plugin would observe a crash or silent degradation

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed test mock for emitSecurityEvent**
- **Found during:** Task 2 (integration wiring)
- **Issue:** vi.mock with factory function did not properly intercept transitive module imports; emitSecurityEvent mock had 0 calls
- **Fix:** Switched to vi.mock for the logging subsystem + vi.spyOn for emitSecurityEvent, ensuring the real module is loaded but intercepted
- **Files modified:** src/plugins/capabilities.test.ts
- **Verification:** All 15 tests pass, security event emission verified
- **Committed in:** 1db59821a (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Test infrastructure fix only, no scope creep.

## Issues Encountered
None beyond the test mock fix documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 03 (Plugin Security) is now complete with both consent gate and capability enforcement
- Capability enforcement is ready for plugin authors to adopt by adding capabilities arrays to manifests
- All 105 plugin tests pass with zero regressions

## Self-Check: PASSED

- All 7 files verified present on disk
- Both task commits (ccc41eb70, 1db59821a) verified in git log
- All 105 plugin tests pass (16 test files)

---
*Phase: 03-plugin-security*
*Completed: 2026-02-16*

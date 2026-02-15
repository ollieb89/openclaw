# Phase 3: Plugin Security - Research

**Researched:** 2026-02-15
**Domain:** Plugin loading consent, capability-scoped API surfaces
**Confidence:** HIGH

## Summary

Phase 3 hardens the OpenClaw plugin system against two threats: (1) untrusted workspace plugins auto-loading without user consent, and (2) plugins accessing API surfaces they never declared. The codebase already has a mature plugin system with discovery (`src/plugins/discovery.ts`), loading (`src/plugins/loader.ts`), a manifest schema (`openclaw.plugin.json`), and a registry with a `createApi()` factory that builds `OpenClawPluginApi` instances per-plugin. The `PluginOrigin` type already distinguishes `"bundled" | "global" | "workspace" | "config"` origins, and the config system has `allow`/`deny` lists. What's missing is: (a) a consent gate that blocks workspace-origin plugins from loading unless the user has explicitly approved them, and (b) a capability declaration in the manifest that restricts which `OpenClawPluginApi` methods the plugin's `register()` call can access.

The current `OpenClawPluginApi` object passed to plugins exposes 12+ registration methods (`registerTool`, `registerChannel`, `registerProvider`, `registerHook`, `registerGatewayMethod`, `registerHttpHandler`, `registerHttpRoute`, `registerCli`, `registerService`, `registerCommand`, `on`) plus access to `config`, `pluginConfig`, and the massive `runtime` object (which includes `runtime.config.loadConfig`, `runtime.config.writeConfigFile`, `runtime.media.*`, `runtime.channel.*`, etc.). Every plugin receives all of these regardless of what it actually needs. The capability-scoped proxy pattern -- wrapping `createApi()` to return a restricted view -- is the natural enforcement point.

**Primary recommendation:** Add a `capabilities` field to `openclaw.plugin.json` manifests, build a Proxy-based or selective-copy API factory in `createApi()` that only exposes declared capabilities, persist workspace plugin consent in config, and emit security events via `emitSecurityEvent()` on both consent blocks and capability violations.

## Standard Stack

### Core

No new external dependencies needed. This phase is entirely internal to the existing plugin system.

| Component | Location | Purpose | Why Standard |
|-----------|----------|---------|--------------|
| Plugin manifest | `openclaw.plugin.json` | Declare capabilities | Already required for all plugins; extend existing schema |
| Plugin registry | `src/plugins/registry.ts` | API factory (`createApi`) | Single place where `OpenClawPluginApi` is constructed |
| Plugin loader | `src/plugins/loader.ts` | Consent gate | Central loading pipeline, already handles enable/disable |
| Plugin discovery | `src/plugins/discovery.ts` | Origin tracking | Already tags candidates with `PluginOrigin` |
| Security events | `src/security/event-logger.ts` | Log violations | Phase 1 established this backbone |
| Config types | `src/config/types.plugins.ts` | Persist consent | Already has `PluginsConfig` with entries/installs |

### Supporting

| Component | Location | Purpose | When to Use |
|-----------|----------|---------|-------------|
| Plugin config-state | `src/plugins/config-state.ts` | Consent resolution logic | Resolve whether workspace plugin has consent |
| Security audit | `src/security/audit-extra.async.ts` | Audit unconsented plugins | Extend existing audit checks |
| Manifest types | `src/plugins/manifest.ts` | Parse capabilities from manifest | Extend `PluginManifest` type |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Proxy-based API restriction | Throw at runtime in each method | Proxy is cleaner but requires careful `get` trap; method-level checks are simpler but repetitive |
| Selective object copy | ES Proxy | Copy is simpler to debug but creates a new API shape per-capability set; Proxy preserves the full type signature |
| Config-persisted consent | Separate consent file | Config is already the single source of truth for plugin state; a separate file adds complexity |

**Installation:** No new packages needed.

## Architecture Patterns

### Recommended Changes

```
src/plugins/
├── manifest.ts              # Extend PluginManifest with capabilities field
├── capabilities.ts          # NEW: capability definitions, validation, proxy factory
├── capabilities.test.ts     # NEW: tests for capability enforcement
├── consent.ts               # NEW: workspace consent check + persistence
├── consent.test.ts          # NEW: tests for consent flow
├── loader.ts                # Add consent gate + pass capabilities to createApi
├── registry.ts              # Modify createApi to accept capabilities, build restricted API
├── config-state.ts          # Add consent resolution helpers
└── types.ts                 # Extend types with capability-related types
src/config/
└── types.plugins.ts         # Add consent tracking to PluginsConfig
src/security/
└── audit-extra.async.ts     # Add check for unconsented workspace plugins
```

### Pattern 1: Capability Declaration in Manifest

**What:** Plugins declare which API surfaces they need in `openclaw.plugin.json`
**When to use:** Every plugin must declare capabilities; undeclared = no access

The manifest already has `id`, `configSchema`, `channels`, `providers`, `skills`. Add a top-level `capabilities` array:

```json
{
  "id": "voice-call",
  "capabilities": ["tools", "cli", "services", "gateway_methods", "config_read"],
  "configSchema": { "type": "object", "additionalProperties": false, "properties": {} }
}
```

Capability names map to API surface groups:

```typescript
// src/plugins/capabilities.ts

export const PLUGIN_CAPABILITIES = {
  // Registration capabilities
  tools: ["registerTool"],
  hooks: ["registerHook", "on"],
  channels: ["registerChannel"],
  providers: ["registerProvider"],
  http: ["registerHttpHandler", "registerHttpRoute"],
  gateway_methods: ["registerGatewayMethod"],
  cli: ["registerCli"],
  services: ["registerService"],
  commands: ["registerCommand"],

  // Access capabilities
  config_read: ["config"],           // read-only config access
  config_write: ["runtime.config"],  // loadConfig + writeConfigFile
  media: ["runtime.media"],          // media pipeline access
  runtime_channel: ["runtime.channel"],  // channel-specific runtime APIs
  runtime_system: ["runtime.system"],    // system event + exec access
  runtime_state: ["runtime.state"],      // state dir access
  runtime_tts: ["runtime.tts"],          // text-to-speech
  runtime_tools: ["runtime.tools"],      // memory tools
  runtime_logging: ["runtime.logging"],  // logging utilities
} as const;

export type PluginCapability = keyof typeof PLUGIN_CAPABILITIES;
```

### Pattern 2: Capability-Scoped API via Proxy

**What:** `createApi()` wraps the full API in a Proxy that blocks access to undeclared surfaces
**When to use:** Every plugin activation in `loader.ts`

```typescript
// In src/plugins/registry.ts, modify createApi:

function createCapabilityScopedApi(
  fullApi: OpenClawPluginApi,
  capabilities: Set<PluginCapability>,
  pluginId: string,
): OpenClawPluginApi {
  const allowedMethods = new Set<string>();
  for (const cap of capabilities) {
    const methods = PLUGIN_CAPABILITIES[cap];
    if (methods) {
      for (const method of methods) {
        allowedMethods.add(method);
      }
    }
  }

  // Always allowed: id, name, version, description, source, logger, resolvePath, pluginConfig
  const ALWAYS_ALLOWED = new Set([
    "id", "name", "version", "description", "source",
    "logger", "resolvePath", "pluginConfig",
  ]);

  return new Proxy(fullApi, {
    get(target, prop, receiver) {
      const key = String(prop);
      if (ALWAYS_ALLOWED.has(key)) {
        return Reflect.get(target, prop, receiver);
      }
      if (allowedMethods.has(key)) {
        return Reflect.get(target, prop, receiver);
      }
      // For nested objects like "runtime", need deeper proxy
      if (key === "config" && !allowedMethods.has("config")) {
        emitSecurityEvent({
          eventType: "policy.violation",
          timestamp: new Date().toISOString(),
          severity: "warn",
          action: "blocked",
          detail: `Plugin "${pluginId}" attempted to access "${key}" without declaring capability`,
          meta: { pluginId, property: key },
        });
        return undefined;
      }
      if (key === "runtime") {
        return createRuntimeProxy(target.runtime, allowedMethods, pluginId);
      }
      // Block undeclared registration methods
      if (typeof Reflect.get(target, prop, receiver) === "function") {
        emitSecurityEvent({
          eventType: "policy.violation",
          timestamp: new Date().toISOString(),
          severity: "warn",
          action: "blocked",
          detail: `Plugin "${pluginId}" called "${key}" without declaring capability`,
          meta: { pluginId, method: key },
        });
        throw new Error(
          `Plugin "${pluginId}" does not declare capability for "${key}". ` +
          `Add the required capability to openclaw.plugin.json.`
        );
      }
      return undefined;
    },
  });
}
```

### Pattern 3: Workspace Consent Gate

**What:** Before loading a workspace-origin plugin, check if user has previously consented; if not, block loading and record as "pending consent"
**When to use:** In `loader.ts`, after discovery but before module loading

```typescript
// In loader.ts, add consent check before getJiti() call:

if (candidate.origin === "workspace" && !hasWorkspaceConsent(pluginId, cfg)) {
  record.status = "disabled";
  record.error = "workspace plugin requires consent";
  registry.diagnostics.push({
    level: "warn",
    pluginId: record.id,
    source: record.source,
    message: "workspace plugin blocked: explicit consent required",
  });
  emitSecurityEvent({
    eventType: "policy.violation",
    timestamp: new Date().toISOString(),
    severity: "warn",
    action: "blocked",
    detail: `Workspace plugin "${pluginId}" blocked: no consent`,
    meta: { pluginId, origin: "workspace", source: candidate.source },
  });
  registry.plugins.push(record);
  seenIds.set(pluginId, candidate.origin);
  continue;
}
```

Consent is stored in `plugins.entries.<id>.consent`:

```typescript
// Extend PluginEntryConfig in src/config/types.plugins.ts
export type PluginEntryConfig = {
  enabled?: boolean;
  config?: Record<string, unknown>;
  consent?: {
    granted: boolean;
    grantedAt?: string;  // ISO 8601
    source?: string;     // path that was consented
  };
};
```

### Pattern 4: Inferred Capabilities for Existing Plugins

**What:** For backward compatibility, plugins without a `capabilities` field get full access (with a deprecation warning)
**When to use:** Transition period until all plugins declare capabilities

```typescript
function resolveEffectiveCapabilities(
  manifest: PluginManifest,
  pluginId: string,
): Set<PluginCapability> {
  if (manifest.capabilities && manifest.capabilities.length > 0) {
    return new Set(manifest.capabilities as PluginCapability[]);
  }
  // Legacy: no capabilities declared = full access + deprecation warning
  registry.diagnostics.push({
    level: "warn",
    pluginId,
    message: "plugin does not declare capabilities; granting full access (deprecated)",
  });
  return new Set(Object.keys(PLUGIN_CAPABILITIES) as PluginCapability[]);
}
```

### Anti-Patterns to Avoid

- **Checking capabilities at call time without logging:** Every blocked access MUST emit a security event. Silent failures make debugging impossible.
- **Modifying `OpenClawPluginApi` type to be optional-everything:** This breaks all existing plugin code. Use Proxy to maintain the full type while restricting access at runtime.
- **Storing consent in a separate file:** Config is the single source of truth for plugin state. Adding a parallel consent store creates drift risk.
- **Hardcoding capability sets per plugin ID:** Capabilities must come from the manifest, not a central registry. Plugins own their own declarations.
- **Blocking bundled plugins with consent:** Only workspace-origin plugins need consent. Bundled, global, and config-path plugins are already trusted by different mechanisms.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Property interception | Manual if/else per property | ES Proxy with `get` trap | Proxy handles all property access including future additions; manual checks miss new methods |
| Plugin consent UI | Custom terminal prompts | `@clack/prompts` (already used) | Consistent with existing onboarding/setup UX |
| Config persistence | Direct file writes | `writeConfigFile` (existing) | Handles includes, merging, and atomic writes |
| Security event emission | Custom logging | `emitSecurityEvent()` from Phase 1 | Structured events with consistent format |

**Key insight:** The plugin loader (`loader.ts`) already has the perfect structure for inserting both a consent gate and capability resolution. The `createApi()` function in `registry.ts` is the single point where the API object is constructed -- wrapping it with a capability proxy requires changes to exactly one function.

## Common Pitfalls

### Pitfall 1: Breaking Existing Plugins by Requiring Capabilities Immediately

**What goes wrong:** Requiring all plugins to declare capabilities in v1 breaks every existing extension.
**Why it happens:** Temptation to enforce strict security from day one.
**How to avoid:** Default to full access when `capabilities` is absent from manifest. Log a deprecation warning. Plan a future phase to make capabilities required.
**Warning signs:** Extension tests failing because plugins can't access APIs they previously used.

### Pitfall 2: Proxy Performance in Hot Paths

**What goes wrong:** ES Proxy `get` traps add overhead to every property access on the API object.
**Why it happens:** Proxy intercepts ALL property reads, including in tight loops.
**How to avoid:** The `register()` function runs once at startup, not in hot paths. The `runtime` sub-proxy is accessed infrequently. Profile if concerned, but startup cost is negligible.
**Warning signs:** Plugin loading time increasing significantly (measure before/after).

### Pitfall 3: Runtime Object Nesting Depth

**What goes wrong:** `api.runtime.channel.telegram.sendMessageTelegram` requires nested proxy chains to intercept correctly.
**Why it happens:** The `PluginRuntime` type is deeply nested (4+ levels).
**How to avoid:** Scope capabilities at the second level (`runtime.config`, `runtime.media`, `runtime.channel`). Don't try to gate individual methods like `sendMessageTelegram` -- gate the entire `runtime.channel` namespace.
**Warning signs:** Complex recursive proxy logic, hard-to-debug "undefined is not a function" errors.

### Pitfall 4: Consent Gate Blocking Non-Interactive Contexts

**What goes wrong:** Gateway/daemon mode has no TTY for prompting user consent.
**Why it happens:** Consent prompt requires interactive terminal.
**How to avoid:** In non-interactive mode, block the plugin silently (log + security event). Provide a CLI command (`openclaw plugin consent <id>`) for granting consent ahead of time. The gateway logs should make it clear what happened.
**Warning signs:** Gateway failing to start or hanging because it's waiting for TTY input.

### Pitfall 5: Consent Persisted for Wrong Plugin Source

**What goes wrong:** User consents to plugin at path A, attacker replaces it with malicious code at path A.
**Why it happens:** Consent is stored by plugin ID, not by content hash.
**How to avoid:** Store the source path in consent record. When source path changes, require re-consent. Consider storing a hash of the entry file for extra protection (but this may be over-engineering for v1).
**Warning signs:** Consent record's `source` field doesn't match current `candidate.source`.

### Pitfall 6: Capability Conflicts with Existing Manifest Fields

**What goes wrong:** The manifest already has `channels`, `providers`, `skills` fields that imply capabilities.
**Why it happens:** These fields were added for discovery/catalog, not security enforcement.
**How to avoid:** If `channels` is declared in the manifest, auto-infer `channels` capability. Same for `providers` -> `providers` capability. This avoids requiring plugins to redundantly declare what the manifest already says.
**Warning signs:** A channel plugin declaring `"channels": ["telegram"]` but forgetting `"capabilities": ["channels"]` and getting blocked.

## Code Examples

### Example 1: Extended Plugin Manifest

```json
{
  "id": "voice-call",
  "name": "Voice Call",
  "capabilities": ["tools", "cli", "services", "gateway_methods", "config_read", "runtime_tts"],
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "publicUrl": { "type": "string" }
    }
  }
}
```

### Example 2: Channel Plugin Manifest (Capabilities Inferred from channels field)

```json
{
  "id": "telegram",
  "channels": ["telegram"],
  "capabilities": ["channels", "http", "config_read", "runtime_channel"],
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {}
  }
}
```

### Example 3: Consent CLI Command

```bash
# Grant consent to a workspace plugin
openclaw plugin consent voice-call --grant

# Revoke consent
openclaw plugin consent voice-call --revoke

# List workspace plugins and their consent status
openclaw plugin list --origin workspace
```

### Example 4: Security Event for Capability Violation

```typescript
emitSecurityEvent({
  eventType: "policy.violation",
  timestamp: new Date().toISOString(),
  severity: "warn",
  action: "blocked",
  detail: `Plugin "malicious-plugin" called "registerChannel" without declaring "channels" capability`,
  meta: {
    pluginId: "malicious-plugin",
    method: "registerChannel",
    requiredCapability: "channels",
    declaredCapabilities: ["tools"],
    origin: "workspace",
  },
});
```

### Example 5: Extending SecurityEventType (from Phase 1)

```typescript
// Extend src/security/events.ts
export type SecurityEventType =
  | "auth.attempt"
  | "auth.success"
  | "auth.failure"
  | "tool.call"
  | "tool.denied"
  | "injection.detected"
  | "policy.violation"
  | "plugin.consent.blocked"   // NEW
  | "plugin.capability.denied"; // NEW
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| All plugins get full API | Capability-scoped API (this phase) | Phase 3 | Plugins only see what they declare |
| Workspace plugins auto-load | Workspace plugins require consent (this phase) | Phase 3 | User must explicitly trust workspace plugins |
| No security events for plugins | Events logged on block/violation (this phase) | Phase 3 | Full audit trail for plugin security |

**Current state in codebase:**
- The `resolveEnableState()` function in `config-state.ts` already checks allow/deny lists but does NOT check consent for workspace origin
- The `createApi()` in `registry.ts` returns the full unscoped API to every plugin
- The manifest schema (`PluginManifest` type) has no `capabilities` field
- Workspace plugins at `.openclaw/extensions/` auto-discover and auto-load (origin: "workspace")
- The security audit (`audit-extra.async.ts`) already warns about "extensions exist without an explicit allowlist" but doesn't enforce consent

## Open Questions

1. **Should capabilities be strictly enforced or warn-only initially?**
   - What we know: Strict enforcement risks breaking existing plugins; warn-only risks being ignored
   - What's unclear: How many community/third-party plugins exist that would break
   - Recommendation: Strict enforcement for capability violations (throw + log), but legacy plugins without `capabilities` field get full access with deprecation warning. This gives a migration path.

2. **Should consent also apply to config-path plugins?**
   - What we know: Config-path plugins (`load.paths`) are explicitly listed by the user in their config
   - What's unclear: Whether listing a path in config constitutes "consent"
   - Recommendation: Config-path plugins are implicitly consented by the user adding them to config. Only workspace-origin (auto-discovered from `.openclaw/extensions/`) needs explicit consent.

3. **Should bundled plugins need capability declarations?**
   - What we know: Bundled plugins are shipped with OpenClaw and are fully trusted
   - What's unclear: Whether adding capabilities to bundled manifests is useful documentation
   - Recommendation: Add capabilities to bundled manifests as documentation, but don't enforce. Bundled plugins bypass capability checks.

4. **Granularity of `runtime.channel` capabilities**
   - What we know: `runtime.channel` has nested namespaces per channel (telegram, discord, slack, etc.)
   - What's unclear: Whether to gate per-channel-namespace or the whole `runtime.channel` block
   - Recommendation: Gate at `runtime_channel` level (all or nothing). Per-channel gating adds complexity with minimal security benefit since channel plugins only use their own channel APIs.

## Sources

### Primary (HIGH confidence)
- **Codebase analysis** (direct file reads):
  - `src/plugins/types.ts` - Full `OpenClawPluginApi` type definition (12 registration methods + runtime/config access)
  - `src/plugins/registry.ts` - `createApi()` factory function that builds per-plugin API objects
  - `src/plugins/loader.ts` - Plugin loading pipeline with enable/disable logic
  - `src/plugins/discovery.ts` - Plugin discovery with `PluginOrigin` tagging
  - `src/plugins/manifest.ts` - `PluginManifest` type and parsing
  - `src/plugins/config-state.ts` - Enable state resolution logic
  - `src/plugins/runtime/types.ts` - Full `PluginRuntime` type with all nested capabilities
  - `src/config/types.plugins.ts` - `PluginsConfig` and `PluginEntryConfig` types
  - `src/security/events.ts` - Security event types from Phase 1
  - `src/security/event-logger.ts` - `emitSecurityEvent()` function
  - All `extensions/*/openclaw.plugin.json` manifests - Current manifest schema (no capabilities field)
  - All `extensions/*/index.ts` - Actual API usage patterns across 20+ plugins

### Secondary (MEDIUM confidence)
- ES Proxy pattern for capability interception is a well-established JavaScript pattern (MDN, Node.js docs)
- The approach of lazy capability proxying in plugin systems is common in VS Code extensions, Figma plugins, and Chrome extensions

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All changes are internal to existing plugin infrastructure, no new deps
- Architecture: HIGH - `createApi()` is the single enforcement point, Proxy pattern is well-understood
- Pitfalls: HIGH - Derived from direct codebase analysis of existing plugin loading behavior

**Research date:** 2026-02-15
**Valid until:** 2026-03-15 (30 days - stable domain, internal codebase changes only)

import type { OpenClawPluginApi } from "./types.js";
import { emitSecurityEvent } from "../security/event-logger.js";

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
  config_read: ["config"],
  media: ["runtime.media"],
  runtime_channel: ["runtime.channel"],
  runtime_config: ["runtime.config"],
  runtime_system: ["runtime.system"],
  runtime_state: ["runtime.state"],
  runtime_tts: ["runtime.tts"],
  runtime_tools: ["runtime.tools"],
  runtime_logging: ["runtime.logging"],
} as const;

export type PluginCapability = keyof typeof PLUGIN_CAPABILITIES;

const VALID_CAPABILITIES = new Set<string>(Object.keys(PLUGIN_CAPABILITIES));

/**
 * Given a manifest with optional capabilities, channels, and providers fields,
 * returns a Set of effective capabilities. Returns null if no capabilities field
 * is present (legacy/full-access mode).
 */
export function resolveEffectiveCapabilities(manifest: {
  capabilities?: string[];
  channels?: string[];
  providers?: string[];
}): Set<PluginCapability> | null {
  if (manifest.capabilities === undefined || manifest.capabilities === null) {
    return null;
  }

  const result = new Set<PluginCapability>();

  for (const cap of manifest.capabilities) {
    if (VALID_CAPABILITIES.has(cap)) {
      result.add(cap as PluginCapability);
    }
  }

  // Auto-infer from manifest fields
  if (manifest.channels && manifest.channels.length > 0) {
    result.add("channels");
  }
  if (manifest.providers && manifest.providers.length > 0) {
    result.add("providers");
  }

  return result;
}

const ALWAYS_ALLOWED = new Set([
  "id",
  "name",
  "version",
  "description",
  "source",
  "logger",
  "resolvePath",
  "pluginConfig",
]);

/**
 * Finds the capability that grants access to a given property name.
 */
function findRequiredCapability(prop: string): string | undefined {
  for (const [cap, methods] of Object.entries(PLUGIN_CAPABILITIES)) {
    if ((methods as readonly string[]).includes(prop)) {
      return cap;
    }
  }
  return undefined;
}

/**
 * Finds the capability that grants access to a runtime sub-property.
 */
function findRequiredRuntimeCapability(rtProp: string): string | undefined {
  const key = `runtime.${rtProp}`;
  for (const [cap, methods] of Object.entries(PLUGIN_CAPABILITIES)) {
    if ((methods as readonly string[]).includes(key)) {
      return cap;
    }
  }
  return undefined;
}

function emitCapabilityDenied(params: {
  pluginId: string;
  property: string;
  requiredCapability?: string;
}): void {
  emitSecurityEvent({
    eventType: "plugin.capability.denied",
    timestamp: new Date().toISOString(),
    severity: "warn",
    action: "blocked",
    detail: `Plugin "${params.pluginId}" denied access to "${params.property}"${params.requiredCapability ? ` (requires capability "${params.requiredCapability}")` : ""}`,
    meta: {
      pluginId: params.pluginId,
      property: params.property,
      requiredCapability: params.requiredCapability,
    },
  });
}

/**
 * Wraps an OpenClawPluginApi with a Proxy that enforces capability restrictions.
 * Methods/properties not covered by the plugin's declared capabilities are blocked.
 */
export function createCapabilityScopedApi(
  fullApi: OpenClawPluginApi,
  capabilities: Set<PluginCapability>,
  pluginId: string,
): OpenClawPluginApi {
  // Build allowed top-level method/property names from capabilities
  const allowedMethods = new Set<string>();
  const allowedRuntimeProps = new Set<string>();

  for (const cap of capabilities) {
    const methods = PLUGIN_CAPABILITIES[cap];
    if (!methods) {
      continue;
    }
    for (const method of methods) {
      if (method.startsWith("runtime.")) {
        allowedRuntimeProps.add(method.slice("runtime.".length));
      } else {
        allowedMethods.add(method);
      }
    }
  }

  const createRuntimeProxy = (): OpenClawPluginApi["runtime"] => {
    return new Proxy(fullApi.runtime, {
      get(rtTarget, rtProp, rtReceiver) {
        if (typeof rtProp === "symbol") {
          return Reflect.get(rtTarget, rtProp, rtReceiver);
        }
        const rtPropStr = String(rtProp);

        // Always allow version and introspection properties
        if (rtPropStr === "version" || rtPropStr === "toString" || rtPropStr === "valueOf") {
          return Reflect.get(rtTarget, rtProp, rtReceiver);
        }

        if (allowedRuntimeProps.has(rtPropStr)) {
          return Reflect.get(rtTarget, rtProp, rtReceiver);
        }

        const requiredCap = findRequiredRuntimeCapability(rtPropStr);
        emitCapabilityDenied({
          pluginId,
          property: `runtime.${rtPropStr}`,
          requiredCapability: requiredCap,
        });
        return undefined;
      },
    });
  };

  let runtimeProxy: OpenClawPluginApi["runtime"] | null = null;

  return new Proxy(fullApi, {
    get(target, prop, receiver) {
      if (typeof prop === "symbol") {
        return Reflect.get(target, prop, receiver);
      }
      const propStr = String(prop);

      // Always-allowed properties
      if (ALWAYS_ALLOWED.has(propStr)) {
        return Reflect.get(target, prop, receiver);
      }

      // Config access: gated by config_read capability
      if (propStr === "config") {
        if (allowedMethods.has("config")) {
          return Reflect.get(target, prop, receiver);
        }
        emitCapabilityDenied({
          pluginId,
          property: "config",
          requiredCapability: "config_read",
        });
        return undefined;
      }

      // Runtime: return a sub-proxy
      if (propStr === "runtime") {
        if (!runtimeProxy) {
          runtimeProxy = createRuntimeProxy();
        }
        return runtimeProxy;
      }

      // Check if allowed by capabilities
      if (allowedMethods.has(propStr)) {
        return Reflect.get(target, prop, receiver);
      }

      // Not allowed -- check if it's a function (registration method) or property
      const value = Reflect.get(target, prop, receiver);
      const requiredCap = findRequiredCapability(propStr);

      if (typeof value === "function") {
        // Return a wrapper that throws on invocation
        emitCapabilityDenied({ pluginId, property: propStr, requiredCapability: requiredCap });
        throw new Error(
          `Plugin "${pluginId}" is not allowed to call "${propStr}". ` +
            `Required capability: "${requiredCap ?? "unknown"}". ` +
            `Declare it in your plugin manifest's capabilities array.`,
        );
      }

      // Non-function property access
      emitCapabilityDenied({ pluginId, property: propStr, requiredCapability: requiredCap });
      return undefined;
    },
  });
}

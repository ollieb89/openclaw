import { describe, expect, it } from "vitest";
import { hasWorkspaceConsent } from "./consent.js";

describe("hasWorkspaceConsent", () => {
  const pluginId = "my-workspace-plugin";
  const source = "/workspace/.openclaw/extensions/my-plugin/index.ts";

  it("returns true when consent is granted and source matches", () => {
    const entries = {
      [pluginId]: {
        consent: {
          granted: true,
          grantedAt: "2026-01-01T00:00:00Z",
          source,
        },
      },
    };
    expect(hasWorkspaceConsent(pluginId, source, entries)).toBe(true);
  });

  it("returns false when no entry exists for the plugin ID", () => {
    const entries = {};
    expect(hasWorkspaceConsent(pluginId, source, entries)).toBe(false);
  });

  it("returns false when consent field is missing from entry", () => {
    const entries = { [pluginId]: {} };
    expect(hasWorkspaceConsent(pluginId, source, entries)).toBe(false);
  });

  it("returns false when consent.granted is false", () => {
    const entries = {
      [pluginId]: {
        consent: {
          granted: false,
          source,
        },
      },
    };
    expect(hasWorkspaceConsent(pluginId, source, entries)).toBe(false);
  });

  it("returns false when consent.source does not match current source path", () => {
    const entries = {
      [pluginId]: {
        consent: {
          granted: true,
          grantedAt: "2026-01-01T00:00:00Z",
          source: "/different/path/index.ts",
        },
      },
    };
    expect(hasWorkspaceConsent(pluginId, source, entries)).toBe(false);
  });

  it("returns true when consent.source is undefined (legacy consent record)", () => {
    const entries = {
      [pluginId]: {
        consent: {
          granted: true,
          grantedAt: "2026-01-01T00:00:00Z",
        },
      },
    };
    expect(hasWorkspaceConsent(pluginId, source, entries)).toBe(true);
  });
});

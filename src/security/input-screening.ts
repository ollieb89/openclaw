/**
 * Input screening for inbound messages.
 *
 * Provides scored detection with per-channel sensitivity thresholds,
 * mapping message content to actions (allow/log/warn/block) and emitting
 * security events for non-allow outcomes.
 */

import { emitSecurityEvent } from "./event-logger.js";
import { detectSuspiciousPatterns } from "./external-content.js";

export type InputSensitivity = "lenient" | "moderate" | "strict";

export type InputDetectionConfig = {
  defaultSensitivity?: InputSensitivity;
  channels?: Record<string, { sensitivity?: InputSensitivity }>;
};

export type InputScreeningResult = {
  score: number;
  matchedPatterns: string[];
  action: "allow" | "log" | "warn" | "block";
  sensitivity: InputSensitivity;
};

type SensitivityThresholds = { logAt: number; warnAt: number; blockAt: number };

/**
 * Threshold configuration per sensitivity level.
 *
 * - lenient: owner DMs — only block on maximum score
 * - moderate: trusted channels — balanced detection
 * - strict: public channels — aggressive detection
 */
export const SENSITIVITY_THRESHOLDS: Record<InputSensitivity, SensitivityThresholds> = {
  lenient: { logAt: 0.6, warnAt: 0.9, blockAt: 1.0 },
  moderate: { logAt: 0.3, warnAt: 0.6, blockAt: 0.9 },
  strict: { logAt: 0.1, warnAt: 0.3, blockAt: 0.6 },
};

/**
 * Resolve the effective sensitivity for a channel.
 * Looks up per-channel override first (case-insensitive), then falls back
 * to the configured default, and finally to "moderate".
 */
export function resolveChannelSensitivity(
  channel: string,
  config: InputDetectionConfig,
): InputSensitivity {
  const channelOverride = config.channels?.[channel.toLowerCase()]?.sensitivity;
  if (channelOverride) {
    return channelOverride;
  }
  return config.defaultSensitivity ?? "moderate";
}

function resolveAction(
  score: number,
  thresholds: SensitivityThresholds,
): "allow" | "log" | "warn" | "block" {
  if (score >= thresholds.blockAt) {
    return "block";
  }
  if (score >= thresholds.warnAt) {
    return "warn";
  }
  if (score >= thresholds.logAt) {
    return "log";
  }
  return "allow";
}

const SEVERITY_MAP: Record<string, "info" | "warn" | "critical"> = {
  log: "info",
  warn: "warn",
  block: "critical",
};

/**
 * Screen an inbound message for potential injection.
 *
 * Calls `detectSuspiciousPatterns` to get a weighted score, resolves the
 * channel sensitivity, determines the appropriate action, and emits a
 * security event for non-allow actions.
 */
export function screenInput(params: {
  content: string;
  channel: string;
  sessionKey?: string;
  config: InputDetectionConfig;
}): InputScreeningResult {
  const { content, channel, sessionKey, config } = params;
  const { matches, score } = detectSuspiciousPatterns(content);
  const sensitivity = resolveChannelSensitivity(channel, config);
  const thresholds = SENSITIVITY_THRESHOLDS[sensitivity];
  const action = resolveAction(score, thresholds);

  if (action !== "allow") {
    emitSecurityEvent({
      eventType: "injection.detected",
      timestamp: new Date().toISOString(),
      severity: SEVERITY_MAP[action] ?? "info",
      action,
      sessionKey,
      channel,
      detail: `Input screening: score=${score.toFixed(2)}, sensitivity=${sensitivity}, action=${action}`,
      meta: { patterns: matches, score, sensitivity },
    });
  }

  return { score, matchedPatterns: matches, action, sensitivity };
}

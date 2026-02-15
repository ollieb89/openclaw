export type SecurityEventType =
  | "auth.attempt"
  | "auth.success"
  | "auth.failure"
  | "tool.call"
  | "tool.denied"
  | "injection.detected"
  | "policy.violation"
  | "plugin.consent.blocked";

export type SecurityEventSeverity = "info" | "warn" | "critical";

export type SecurityEvent = {
  eventType: SecurityEventType;
  timestamp: string; // ISO 8601
  sessionKey?: string;
  channel?: string;
  severity: SecurityEventSeverity;
  action: string; // What was done: "allowed", "blocked", "logged"
  detail?: string; // Human-readable context
  meta?: Record<string, unknown>; // Additional structured data
};

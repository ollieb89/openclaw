import type { OutputCspRuleId } from "../security/output-policy.js";

export type SecurityConfig = {
  inputDetection?: {
    defaultSensitivity?: "lenient" | "moderate" | "strict";
    channels?: Record<string, { sensitivity?: "lenient" | "moderate" | "strict" }>;
  };
  outputPolicy?: {
    defaultRules?: OutputCspRuleId[];
    channels?: Record<string, { rules?: OutputCspRuleId[] }>;
  };
};

export type SecurityConfig = {
  inputDetection?: {
    defaultSensitivity?: "lenient" | "moderate" | "strict";
    channels?: Record<string, { sensitivity?: "lenient" | "moderate" | "strict" }>;
  };
};

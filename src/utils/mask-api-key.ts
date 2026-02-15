/**
 * Masks an API key showing only the first 4 characters and total length.
 * Output format: "sk-pr... (52 chars)"
 *
 * This is the ONLY function that should be used for masking API keys
 * in user-visible output (session_status, /status, models list, etc.).
 */
export function maskApiKey(apiKey: string): string {
  const compact = apiKey.replace(/\s+/g, "").trim();
  if (!compact) {
    return "unknown";
  }
  const prefix = compact.slice(0, 4);
  return `${prefix}... (${compact.length} chars)`;
}

/**
 * Workspace plugin consent gate.
 *
 * Workspace-origin plugins require explicit user consent before loading.
 * Bundled, global, and config-path plugins bypass this check entirely.
 */

export function hasWorkspaceConsent(
  pluginId: string,
  source: string,
  entries: Record<string, { consent?: { granted: boolean; grantedAt?: string; source?: string } }>,
): boolean {
  const entry = entries[pluginId];
  if (!entry) return false;

  const consent = entry.consent;
  if (!consent?.granted) return false;

  // If a source path was recorded in the consent, it must match the current source.
  // A mismatch means the plugin moved and re-consent is required.
  // Undefined source means legacy consent record -- allow it.
  if (consent.source !== undefined && consent.source !== source) return false;

  return true;
}

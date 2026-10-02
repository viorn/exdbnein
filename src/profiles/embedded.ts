import { EMBEDDED_PROFILES_YAML } from "./embedded-data.generated.ts";
import { loadProfiles, parseProfile } from "./load.ts";
import type { Profile } from "./types.ts";

export { EMBEDDED_PROFILES_YAML } from "./embedded-data.generated.ts";

/** Embedded profile names (P8.1). */
export function embeddedProfileNames(): string[] {
  return Object.keys(EMBEDDED_PROFILES_YAML);
}

/**
 * Loads the embedded profiles through the same pipeline as the YAML directory
 * (parsing + validation). Used when the profiles/ directory is unavailable —
 * the compiled binary in the LiveCD runs from an arbitrary CWD (P8.1).
 */
export async function loadEmbeddedProfiles(): Promise<Map<string, Profile>> {
  const profiles = new Map<string, Profile>();
  for (const [name, text] of Object.entries(EMBEDDED_PROFILES_YAML)) {
    profiles.set(name, parseProfile(name, text));
  }
  return profiles;
}

/**
 * Profiles for installation: the YAML directory if available; otherwise the embedded
 * binary data. The directory is preferred (--profiles-dir overrides the set),
 * the embedded profiles guarantee operation in the LiveCD without assets nearby (P8.1).
 */
export async function loadProfilesOrDefault(dir: string): Promise<Map<string, Profile>> {
  if (await Bun.file(dir).exists()) return loadProfiles(dir);

  const embedded = await loadEmbeddedProfiles();
  if (embedded.size === 0) {
    throw new Error(`Profiles directory ${dir} not found and no embedded profiles available`);
  }
  return embedded;
}

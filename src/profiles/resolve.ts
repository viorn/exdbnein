import type { MergedProfiles, Profile, ResolvedProfile } from "./types.ts";

/** Profile resolution error: extends cycle, missing parent or file conflict. */
export class ProfileResolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileResolveError";
  }
}

function parentsOf(profile: Profile): string[] {
  if (!profile.extends) return [];
  return Array.isArray(profile.extends) ? profile.extends : [profile.extends];
}

/**
 * Resolves a profile: DFS walk over ancestors (topological order) with cycle protection.
 * Merge rules: packages/services — deduplicated union; commands/files —
 * concatenation preserving order (parents before children).
 */
export function resolveProfile(
  name: string,
  profiles: ReadonlyMap<string, Profile>,
): ResolvedProfile {
  const visited = new Set<string>();
  const path = new Set<string>();
  const order: string[] = [];

  const visit = (current: string): void => {
    if (visited.has(current)) return;
    if (path.has(current)) {
      throw new ProfileResolveError(`Cycle in extends: ${[...path, current].join(" → ")}`);
    }
    const profile = profiles.get(current);
    if (!profile) {
      throw new ProfileResolveError(`Profile "${current}" not found (extends)`);
    }
    path.add(current);
    for (const parent of parentsOf(profile)) visit(parent);
    path.delete(current);
    visited.add(current);
    order.push(current);
  };

  visit(name);

  const packages = new Set<string>();
  const services = new Set<string>();
  const commands: Profile["commands"] = [];
  const files: Profile["files"] = [];

  for (const id of order) {
    const profile = profiles.get(id);
    if (!profile) continue;
    for (const pkg of profile.packages) packages.add(pkg);
    for (const svc of profile.services) services.add(svc);
    commands.push(...profile.commands);
    files.push(...profile.files);
  }

  return {
    name,
    packages: [...packages],
    services: [...services],
    commands,
    files,
    parents: order.slice(0, -1),
  };
}

/** Merges several resolved profiles. A file conflict with different content is an error. */
export function mergeProfiles(list: ResolvedProfile[]): MergedProfiles {
  const packages = new Set<string>();
  const services = new Set<string>();
  const commands: Profile["commands"] = [];
  const files: Profile["files"] = [];
  const fileOwners = new Map<string, { content: string; owner: string }>();

  for (const resolved of list) {
    for (const pkg of resolved.packages) packages.add(pkg);
    for (const svc of resolved.services) services.add(svc);
    commands.push(...resolved.commands);

    for (const file of resolved.files) {
      const prev = fileOwners.get(file.path);
      if (prev && prev.content !== file.content) {
        throw new ProfileResolveError(
          `File conflict ${file.path}: different content in "${prev.owner}" and "${resolved.name}"`,
        );
      }
      if (!prev) {
        fileOwners.set(file.path, { content: file.content, owner: resolved.name });
        files.push(file);
      }
    }
  }

  return { packages: [...packages], services: [...services], commands, files };
}

/** Resolves the list of selected profiles and merges them into one final set. */
export function resolveProfiles(
  names: string[],
  profiles: ReadonlyMap<string, Profile>,
): MergedProfiles {
  return mergeProfiles(names.map((name) => resolveProfile(name, profiles)));
}

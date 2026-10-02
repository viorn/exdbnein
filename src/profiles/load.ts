import { parse } from "yaml";
import type { Profile } from "./types.ts";
import { validateProfile } from "./validate.ts";

const EMPTY_COLLECTIONS = {
  packages: [],
  services: [],
  commands: [],
  files: [],
} as const;

/** Parses and validates a single YAML profile. Throws an error describing the issues. */
export function parseProfile(name: string, text: string): Profile {
  const parsed: unknown = parse(text);
  const issues = validateProfile(name, parsed);
  if (issues.length > 0) {
    const list = issues.map((issue) => `• ${issue.path}: ${issue.message}`).join("\n");
    throw new Error(`Profile ${name} is invalid:\n${list}`);
  }
  return { ...EMPTY_COLLECTIONS, ...(parsed as Profile), name };
}

/**
 * Loads profiles from a directory (*.yaml, *.yml) and validates each one.
 * On any error throws an exception naming the file.
 */
export async function loadProfiles(dir: string): Promise<Map<string, Profile>> {
  const glob = new Bun.Glob("*.{yaml,yml}");
  const profiles = new Map<string, Profile>();

  for await (const file of glob.scan({ cwd: dir, onlyFiles: true })) {
    const text = await Bun.file(`${dir}/${file}`).text();
    const raw = parse(text) as Record<string, unknown>;
    const name = typeof raw?.name === "string" ? raw.name : "";

    if (!name) {
      throw new Error(`Profile ${file}: missing name field`);
    }

    profiles.set(name, parseProfile(name, text));
  }

  return profiles;
}

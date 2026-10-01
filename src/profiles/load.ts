import { parse } from "yaml";
import type { Profile } from "./types.ts";
import { validateProfile } from "./validate.ts";

const EMPTY_COLLECTIONS = {
  packages: [],
  services: [],
  commands: [],
  files: [],
} as const;

/**
 * Загружает профили из каталога (*.yaml, *.yml) и валидирует каждый.
 * При любой ошибке бросает исключение с указанием файла.
 */
export async function loadProfiles(dir: string): Promise<Map<string, Profile>> {
  const glob = new Bun.Glob("*.{yaml,yml}");
  const profiles = new Map<string, Profile>();

  for await (const file of glob.scan({ cwd: dir, onlyFiles: true })) {
    const text = await Bun.file(`${dir}/${file}`).text();
    const parsed: unknown = parse(text);
    const raw = parsed as Record<string, unknown>;
    const name = typeof raw?.name === "string" ? raw.name : "";

    if (!name) {
      throw new Error(`Профиль ${file}: отсутствует поле name`);
    }

    const issues = validateProfile(name, parsed);
    if (issues.length > 0) {
      const list = issues.map((issue) => `• ${issue.path}: ${issue.message}`).join("\n");
      throw new Error(`Профиль ${file} невалиден:\n${list}`);
    }

    profiles.set(name, { ...EMPTY_COLLECTIONS, ...(parsed as Profile), name });
  }

  return profiles;
}

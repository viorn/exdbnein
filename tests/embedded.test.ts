import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EMBEDDED_PROFILES_YAML,
  embeddedProfileNames,
  loadEmbeddedProfiles,
  loadProfilesOrDefault,
} from "../src/profiles/index.ts";

const PROFILES_DIR = join(import.meta.dir, "..", "profiles");

describe("встроенные профили (P8.1)", () => {
  test("данные соответствуют YAML-файлам в profiles/", () => {
    const files = readdirSync(PROFILES_DIR)
      .filter((file) => /\.(yaml|yml)$/.test(file))
      .sort();

    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const name = file.replace(/\.(yaml|yml)$/, "");
      const text = readFileSync(join(PROFILES_DIR, file), "utf8").trimEnd();
      expect(EMBEDDED_PROFILES_YAML[name], `встроенный профиль ${name}`).toBe(text);
    }

    expect(Object.keys(EMBEDDED_PROFILES_YAML).sort()).toEqual(
      files.map((file) => file.replace(/\.(yaml|yml)$/, "")).sort(),
    );
  });

  test("встроенные профили парсятся и валидируются", async () => {
    const profiles = await loadEmbeddedProfiles();
    const names = embeddedProfileNames();

    expect(names).toContain("base");
    expect(profiles.size).toBe(names.length);

    for (const [name, profile] of profiles) {
      expect(profile.name).toBe(name);
      expect(Array.isArray(profile.packages)).toBe(true);
      expect(Array.isArray(profile.services)).toBe(true);
      expect(Array.isArray(profile.commands)).toBe(true);
      expect(Array.isArray(profile.files)).toBe(true);
    }
  });

  test("fallback: существующий каталог профилей предпочтительнее", async () => {
    const fromDir = await loadProfilesOrDefault(PROFILES_DIR);
    expect([...fromDir.keys()].sort()).toEqual(embeddedProfileNames().sort());
  });

  test("fallback: отсутствующий каталог → встроенные профили", async () => {
    const missing = join(tmpdir(), `exdbnein-missing-${Date.now()}`);
    const profiles = await loadProfilesOrDefault(missing);

    expect(profiles.size).toBe(embeddedProfileNames().length);
    expect(profiles.has("base")).toBe(true);

    // Содержимое совпадает с дисковым профилем: встроенные данные — срез YAML.
    const disk = await loadProfilesOrDefault(PROFILES_DIR);
    expect(profiles.get("base")?.packages).toEqual(disk.get("base")?.packages);
  });
});

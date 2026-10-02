import { EMBEDDED_PROFILES_YAML } from "./embedded-data.generated.ts";
import { loadProfiles, parseProfile } from "./load.ts";
import type { Profile } from "./types.ts";

export { EMBEDDED_PROFILES_YAML } from "./embedded-data.generated.ts";

/** Имена встроенных профилей (P8.1). */
export function embeddedProfileNames(): string[] {
  return Object.keys(EMBEDDED_PROFILES_YAML);
}

/**
 * Загружает встроенные профили тем же конвейером, что и YAML-каталог
 * (парсинг + валидация). Используется, когда каталог profiles/ недоступен —
 * скомпилированный бинарь в LiveCD запускается из произвольного CWD (P8.1).
 */
export async function loadEmbeddedProfiles(): Promise<Map<string, Profile>> {
  const profiles = new Map<string, Profile>();
  for (const [name, text] of Object.entries(EMBEDDED_PROFILES_YAML)) {
    profiles.set(name, parseProfile(name, text));
  }
  return profiles;
}

/**
 * Профили для установки: YAML-каталог, если доступен; иначе — встроенные
 * данные бинаря. Каталог предпочтителен (--profiles-dir переопределяет набор),
 * встроенные профили гарантируют работу в LiveCD без ассетов рядом (P8.1).
 */
export async function loadProfilesOrDefault(dir: string): Promise<Map<string, Profile>> {
  if (await Bun.file(dir).exists()) return loadProfiles(dir);

  const embedded = await loadEmbeddedProfiles();
  if (embedded.size === 0) {
    throw new Error(`Каталог профилей ${dir} не найден, встроенные профили отсутствуют`);
  }
  return embedded;
}

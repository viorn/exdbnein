import { CONFIG_VERSION, defaultConfig, type InstallConfig } from "./types.ts";

/** Убирает из конфига секреты (пароли в открытом виде) перед записью на диск. */
export function redact(config: InstallConfig): InstallConfig {
  return {
    ...config,
    users: config.users.map(({ password: _password, ...rest }) => rest),
  };
}

export function serializeConfig(config: InstallConfig): string {
  return `${JSON.stringify(redact(config), null, 2)}\n`;
}

/** Разбирает JSON и дополняет недостающие поля значениями по умолчанию. */
export function parseConfig(json: string): InstallConfig {
  const raw = JSON.parse(json) as Partial<InstallConfig>;
  const base = defaultConfig();
  return {
    ...base,
    ...raw,
    version: raw.version ?? CONFIG_VERSION,
    disk: { ...base.disk, ...raw.disk },
    locale: { ...base.locale, ...raw.locale },
    network: { ...base.network, ...raw.network },
    bootloader: { ...base.bootloader, ...raw.bootloader },
    users: raw.users ?? base.users,
    profiles: raw.profiles ?? base.profiles,
  };
}

export async function saveConfig(config: InstallConfig, path: string): Promise<void> {
  await Bun.write(path, serializeConfig(config));
}

export async function loadConfig(path: string): Promise<InstallConfig> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`Файл конфигурации не найден: ${path}`);
  }
  return parseConfig(await file.text());
}

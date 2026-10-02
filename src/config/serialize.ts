import { CONFIG_VERSION, defaultConfig, type InstallConfig, type UserConfig } from "./types.ts";

/** Removes the legacy plaintext `password` field from a user object. */
function stripPassword(user: UserConfig): UserConfig {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- legacy field removal
  const { password: _password, ...rest } = user;
  return rest;
}

/** Removes secrets (plaintext passwords) from the config before writing to disk. */
export function redact(config: InstallConfig): InstallConfig {
  return {
    ...config,
    users: config.users.map(stripPassword),
  };
}

export function serializeConfig(config: InstallConfig): string {
  return `${JSON.stringify(redact(config), null, 2)}\n`;
}

/** Parses JSON and fills missing fields with defaults. Strips legacy plaintext `password`. */
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
    users: (raw.users ?? base.users).map(stripPassword),
    profiles: raw.profiles ?? base.profiles,
  };
}

export async function saveConfig(config: InstallConfig, path: string): Promise<void> {
  await Bun.write(path, serializeConfig(config));
}

export async function loadConfig(path: string): Promise<InstallConfig> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`Configuration file not found: ${path}`);
  }
  return parseConfig(await file.text());
}

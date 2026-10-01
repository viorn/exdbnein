import { CONFIG_VERSION, type InstallConfig } from "./types.ts";

export interface ValidationIssue {
  /** Путь к полю, например "disk.device". */
  path: string;
  message: string;
}

const HOSTNAME_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
const USERNAME_RE = /^[a-z_][a-z0-9_-]{0,31}$/;

/** Проверяет конфиг и возвращает список проблем. Пустой список — конфиг валиден. */
export function validateConfig(config: InstallConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });

  if (config.version !== CONFIG_VERSION) {
    add("version", `Ожидается версия ${CONFIG_VERSION}, получена ${config.version}`);
  }

  if (!config.disk.device) {
    add("disk.device", "Не выбран целевой диск");
  } else if (!config.disk.device.startsWith("/dev/")) {
    add("disk.device", "Путь к диску должен начинаться с /dev/");
  }

  if (config.disk.swap && config.disk.swapSizeGiB <= 0) {
    add("disk.swapSizeGiB", "Размер swap должен быть больше нуля");
  }

  if (!HOSTNAME_RE.test(config.network.hostname)) {
    add("network.hostname", "Некорректный hostname");
  }

  if (!config.locale.locale) add("locale.locale", "Не задана локаль");
  if (!config.locale.keymap) add("locale.keymap", "Не задана раскладка");
  if (!config.locale.timezone) add("locale.timezone", "Не задан часовой пояс");

  if (!/^https?:\/\//.test(config.mirror)) {
    add("mirror", "Зеркало должно быть http(s)-URL");
  }

  if (!config.rootPasswordHash) {
    add("rootPasswordHash", "Не задан пароль root");
  }

  const seen = new Set<string>();
  config.users.forEach((user, index) => {
    const base = `users[${index}]`;
    if (!USERNAME_RE.test(user.username)) {
      add(`${base}.username`, "Некорректное имя пользователя");
    }
    if (seen.has(user.username)) {
      add(`${base}.username`, "Дублирующееся имя пользователя");
    }
    seen.add(user.username);
    if (!user.password && !user.passwordHash) {
      add(`${base}.password`, "Не задан пароль или его хеш");
    }
  });

  return issues;
}

export function isValid(config: InstallConfig): boolean {
  return validateConfig(config).length === 0;
}

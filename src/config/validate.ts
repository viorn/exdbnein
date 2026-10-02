import { CONFIG_VERSION, type InstallConfig } from "./types.ts";

export interface ValidationIssue {
  /** Field path, e.g. "disk.device". */
  path: string;
  message: string;
}

const HOSTNAME_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
const USERNAME_RE = /^[a-z_][a-z0-9_-]{0,31}$/;

/** Validates the config and returns a list of issues. An empty list — the config is valid. */
export function validateConfig(config: InstallConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });

  if (config.version !== CONFIG_VERSION) {
    add("version", `Expected version ${CONFIG_VERSION}, got ${config.version}`);
  }

  if (!config.disk.device) {
    add("disk.device", "No target disk selected");
  } else if (!config.disk.device.startsWith("/dev/")) {
    add("disk.device", "Disk path must start with /dev/");
  }

  if (config.disk.swap && config.disk.swapSizeGiB <= 0) {
    add("disk.swapSizeGiB", "Swap size must be greater than zero");
  }

  if (config.disk.espSizeGiB <= 0) {
    add("disk.espSizeGiB", "ESP size must be greater than zero");
  }

  if (config.disk.layout === "keep") {
    if (!config.disk.rootPartition) {
      add("disk.rootPartition", "Select a partition for / with the keep layout");
    } else if (!config.disk.rootPartition.startsWith("/dev/")) {
      add("disk.rootPartition", "Partition path must start with /dev/");
    }
    if (config.disk.espPartition && !config.disk.espPartition.startsWith("/dev/")) {
      add("disk.espPartition", "Partition path must start with /dev/");
    }
    if (
      config.disk.swap &&
      config.disk.swapPartition &&
      !config.disk.swapPartition.startsWith("/dev/")
    ) {
      add("disk.swapPartition", "Partition path must start with /dev/");
    }
  }

  if (!HOSTNAME_RE.test(config.network.hostname)) {
    add("network.hostname", "Invalid hostname");
  }

  if (!config.locale.locale) add("locale.locale", "Locale is not set");
  if (!config.locale.keymap) add("locale.keymap", "Keymap is not set");
  if (!config.locale.timezone) add("locale.timezone", "Time zone is not set");

  if (!/^https?:\/\//.test(config.mirror)) {
    add("mirror", "Mirror must be an http(s) URL");
  }

  if (!config.rootPasswordHash) {
    add("rootPasswordHash", "Root password is not set");
  }

  const seen = new Set<string>();
  config.users.forEach((user, index) => {
    const base = `users[${index}]`;
    if (!USERNAME_RE.test(user.username)) {
      add(`${base}.username`, "Invalid username");
    }
    if (seen.has(user.username)) {
      add(`${base}.username`, "Duplicate username");
    }
    seen.add(user.username);
    if (!user.password && !user.passwordHash) {
      add(`${base}.password`, "Neither password nor its hash is set");
    }
  });

  return issues;
}

export function isValid(config: InstallConfig): boolean {
  return validateConfig(config).length === 0;
}

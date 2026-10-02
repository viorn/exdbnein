import { describe, expect, test } from "bun:test";
import {
  CONFIG_VERSION,
  defaultConfig,
  isValid,
  parseConfig,
  redact,
  serializeConfig,
  validateConfig,
} from "../src/config/index.ts";

function validConfig() {
  const config = defaultConfig();
  config.disk.device = "/dev/sda";
  config.rootPasswordHash = "$6$salt$hash";
  config.users = [{ username: "user", passwordHash: "$6$salt$hash", sudo: true, sshKeys: [] }];
  return config;
}

describe("defaultConfig", () => {
  test("валиден после заполнения обязательных полей", () => {
    expect(validateConfig(validConfig())).toEqual([]);
    expect(isValid(validConfig())).toBe(true);
  });

  test("по умолчанию невалиден (нет диска и пароля root)", () => {
    const issues = validateConfig(defaultConfig());
    expect(issues.map((i) => i.path)).toContain("disk.device");
    expect(issues.map((i) => i.path)).toContain("rootPasswordHash");
  });
});

describe("validateConfig", () => {
  test("ловит некорректный hostname", () => {
    const config = validConfig();
    config.network.hostname = "-bad-";
    expect(validateConfig(config).some((i) => i.path === "network.hostname")).toBe(true);
  });

  test("ловит дублирующихся пользователей", () => {
    const config = validConfig();
    config.users = [
      { username: "user", passwordHash: "x", sudo: true, sshKeys: [] },
      { username: "user", passwordHash: "y", sudo: false, sshKeys: [] },
    ];
    expect(validateConfig(config).some((i) => i.message.includes("Duplicate"))).toBe(true);
  });

  test("ловит неверное зеркало", () => {
    const config = validConfig();
    config.mirror = "ftp://example.com";
    expect(validateConfig(config).some((i) => i.path === "mirror")).toBe(true);
  });
});

describe("serialize", () => {
  test("round-trip сохраняет конфиг", () => {
    const config = validConfig();
    const parsed = parseConfig(serializeConfig(config));
    expect(parsed).toEqual(config);
  });

  test("redact убирает пароли в открытом виде", () => {
    const config = validConfig();
    const user = config.users[0];
    if (!user) throw new Error("нет пользователя");
    user.password = "secret";
    const json = serializeConfig(config);
    expect(json).not.toContain("secret");
    expect(redact(config).users[0]?.password).toBeUndefined();
  });

  test("parseConfig дополняет недостающие поля значениями по умолчанию", () => {
    const parsed = parseConfig(
      JSON.stringify({ version: CONFIG_VERSION, disk: { device: "/dev/sdb" } }),
    );
    expect(parsed.disk.device).toBe("/dev/sdb");
    expect(parsed.disk.filesystem).toBe("btrfs");
    expect(parsed.network.hostname).toBe("debian");
  });
});

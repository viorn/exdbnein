import { describe, expect, test } from "bun:test";
import { defaultConfig } from "../src/config/types.ts";
import { validateConfig } from "../src/config/validate.ts";

describe("review step", () => {
  test("валидный конфиг проходит валидацию", () => {
    const config = defaultConfig();
    config.disk.device = "/dev/sda";
    config.rootPasswordHash = "$6$salt$hash";
    config.users = [{ username: "user", passwordHash: "$6$salt$hash", sudo: true, sshKeys: [] }];
    expect(validateConfig(config)).toEqual([]);
  });

  test("невалидный конфиг содержит ошибки", () => {
    const config = defaultConfig();
    const issues = validateConfig(config);
    expect(issues.some((i) => i.path === "disk.device")).toBe(true);
    expect(issues.some((i) => i.path === "rootPasswordHash")).toBe(true);
  });

  test("unattended-конфиг валиден", () => {
    const config = defaultConfig();
    config.disk.device = "/dev/sda";
    config.rootPasswordHash = "$6$salt$hash";
    config.users = [{ username: "user", passwordHash: "$6$salt$hash", sudo: true, sshKeys: [] }];
    config.unattended = true;
    expect(validateConfig(config)).toEqual([]);
  });
});

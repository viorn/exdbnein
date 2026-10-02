import { describe, expect, test } from "bun:test";
import { loadConfig, validateConfig } from "../src/config/index.ts";

/**
 * Phase 9 (P9.1): the QEMU automation fixture must stay a valid, complete
 * `--unattended` config — `scripts/qemu-test.sh` substitutes the SSH public key
 * into the @@PUBKEY@@ placeholder and feeds the result to the installer.
 */
const FIXTURE = `${import.meta.dir}/../scripts/qemu/unattended.json`;

describe("scripts/qemu/unattended.json (QEMU e2e config)", () => {
  test("полный конфиг проходит валидацию установщика", async () => {
    const config = await loadConfig(FIXTURE);
    expect(validateConfig(config)).toEqual([]);
  });

  test("включён авторежим и обязательные поля заполнены", async () => {
    const config = await loadConfig(FIXTURE);
    expect(config.unattended).toBe(true);
    expect(config.disk.device).toBe("/dev/sda");
    expect(config.disk.layout).toBe("auto");
    expect(config.network.hostname).toBe("exdbnein-test");
    expect(config.rootPasswordHash).toMatch(/^\$6\$/);
    expect(config.profiles).toContain("base");
  });

  test("SSH-ключ пользователя подставляется через плейсхолдер @@PUBKEY@@", async () => {
    const text = await Bun.file(FIXTURE).text();
    expect(text).toContain("@@PUBKEY@@");
    const config = await loadConfig(FIXTURE);
    expect(config.users[0]?.sshKeys).toEqual(["@@PUBKEY@@"]);
  });
});

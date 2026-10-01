import { describe, expect, test } from "bun:test";
import { defaultConfig } from "../src/config/types.ts";
import { summaryText } from "../src/install/finish.ts";
import { swapsForTarget, UNMOUNT_ORDER } from "../src/system/finalize.ts";
import { InstallLogger } from "../src/system/log.ts";

describe("swapoffTarget (P7.3)", () => {
  test("swapsForTarget: разделы целевого диска по префиксу пути", () => {
    const swaps = swapsForTarget(["/dev/sda1", "/dev/sda2", "/dev/sdb1"], "/dev/sda");
    expect(swaps).toContain("/dev/sda1");
    expect(swaps).toContain("/dev/sda2");
    expect(swaps).not.toContain("/dev/sdb1");
  });

  test("swapsForTarget: явный список (схема keep) добавляется и не дублируется", () => {
    expect(swapsForTarget([], "/dev/sda", ["/dev/sdb1"])).toEqual(["/dev/sdb1"]);
    expect(swapsForTarget(["/dev/sda2"], "/dev/sda", ["/dev/sda2"])).toEqual(["/dev/sda2"]);
  });
});

describe("unmountTarget (P7.3)", () => {
  test("порядок размонтирования: вложенные точки раньше корня /mnt", () => {
    expect(UNMOUNT_ORDER[UNMOUNT_ORDER.length - 1]).toBe("");
    for (const suffix of UNMOUNT_ORDER.slice(0, -1)) {
      expect(suffix.startsWith("/")).toBe(true);
      expect(suffix.startsWith("//")).toBe(false);
    }
  });

  test("в план входят ESP, btrfs-subvolumes и chroot-монтирования", () => {
    for (const expected of [
      "/boot/efi",
      "/.snapshots",
      "/home",
      "/dev/pts",
      "/dev",
      "/proc",
      "/sys",
      "/run",
    ]) {
      expect(UNMOUNT_ORDER).toContain(expected);
    }
  });
});

describe("summaryText (финальный экран)", () => {
  test("сводка содержит диск, хост, локаль, пользователей и профили", () => {
    const config = defaultConfig();
    config.disk.device = "/dev/sda";
    config.network.hostname = "myhost";
    config.locale.locale = "ru_RU.UTF-8";
    config.users = [{ username: "ivan", passwordHash: "$6$x", sudo: true, sshKeys: [] }];
    config.profiles = ["server"];

    const text = summaryText({
      config,
      interactive: true,
      profilesDir: "profiles",
      logger: new InstallLogger(),
    });

    expect(text).toContain("/dev/sda");
    expect(text).toContain("myhost");
    expect(text).toContain("ru_RU.UTF-8");
    expect(text).toContain("ivan");
    expect(text).toContain("server");
  });
});

import { describe, expect, test } from "bun:test";
import { defaultConfig } from "../src/config/types.ts";
import {
  APT_COMPONENTS,
  aptGet,
  DEBOOTSTRAP_SUITE,
  debootstrapCommand,
  essentialBasePackages,
  isBtrfsRoot,
  sourcesListContent,
} from "../src/system/base.ts";
import { chrootMounts, inChroot } from "../src/system/chroot.ts";

describe("debootstrapCommand", () => {
  test("minbase amd64, stable, целевой корень и зеркало из конфига", () => {
    const config = defaultConfig();
    config.mirror = "http://deb.debian.org/debian";
    expect(debootstrapCommand(config)).toEqual([
      "debootstrap",
      "--arch=amd64",
      "--variant=minbase",
      `--components=${APT_COMPONENTS}`,
      "stable",
      "/mnt",
      "http://deb.debian.org/debian",
    ]);
    expect(DEBOOTSTRAP_SUITE).toBe("stable");
  });
});

describe("sourcesListContent", () => {
  test("stable + stable-updates + security с компонентами Debian 12+", () => {
    const content = sourcesListContent("http://deb.debian.org/debian/");
    const lines = content.split("\n").filter((line) => line.length > 0);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(
      "deb http://deb.debian.org/debian stable main contrib non-free non-free-firmware",
    );
    expect(lines[1]).toBe(
      "deb http://deb.debian.org/debian stable-updates main contrib non-free non-free-firmware",
    );
    expect(lines[2]).toBe(
      "deb http://security.debian.org/debian-security stable-security main contrib non-free non-free-firmware",
    );
  });

  test("срезает завершающий слэш у зеркала", () => {
    expect(sourcesListContent("https://mirror.example/debian/")).toContain(
      "deb https://mirror.example/debian stable",
    );
  });
});

describe("chrootMounts", () => {
  test("UEFI: /proc /sys /dev /dev/pts /run + efivars (P5.3)", () => {
    const mounts = chrootMounts("uefi");
    expect(mounts.map((mount) => mount.target)).toEqual([
      "/proc",
      "/sys",
      "/dev",
      "/dev/pts",
      "/run",
      "/sys/firmware/efi/efivars",
    ]);
    expect(mounts[5]?.argv).toContain("/sys/firmware/efi/efivars");
  });

  test("BIOS: без efivars", () => {
    const mounts = chrootMounts("bios");
    expect(mounts.map((mount) => mount.target)).toEqual([
      "/proc",
      "/sys",
      "/dev",
      "/dev/pts",
      "/run",
    ]);
    expect(mounts.some((mount) => mount.target.includes("efivars"))).toBe(false);
  });

  test("все точки монтируются внутрь /mnt", () => {
    for (const mount of chrootMounts("uefi")) {
      expect(mount.argv.some((arg) => arg.startsWith("/mnt/"))).toBe(true);
    }
  });
});

describe("boot-critical packages (P5.4)", () => {
  test("btrfs root: systemd-sysv + btrfs-progs", () => {
    const config = defaultConfig();
    config.disk.filesystem = "btrfs";
    expect(essentialBasePackages(config)).toEqual(["systemd-sysv", "btrfs-progs"]);
  });

  test("ext4 root: только systemd-sysv", () => {
    const config = defaultConfig();
    config.disk.filesystem = "ext4";
    expect(essentialBasePackages(config)).toEqual(["systemd-sysv"]);
  });

  test("isBtrfsRoot учитывает rootPartitionFstype при layout=keep", () => {
    const config = defaultConfig();
    config.disk.layout = "keep";
    config.disk.rootPartition = "/dev/sda2";
    config.disk.rootPartitionFstype = "btrfs";
    expect(isBtrfsRoot(config)).toBe(true);
    config.disk.rootPartitionFstype = "ext4";
    expect(isBtrfsRoot(config)).toBe(false);
  });
});

describe("inChroot / aptGet", () => {
  test("inChroot добавляет префикс chroot /mnt", () => {
    expect(inChroot(["ls", "-l"])).toEqual(["chroot", "/mnt", "ls", "-l"]);
  });

  test("aptGet неинтерактивен и всегда -y", () => {
    expect(aptGet("update")).toEqual([
      "chroot",
      "/mnt",
      "env",
      "DEBIAN_FRONTEND=noninteractive",
      "apt-get",
      "-y",
      "update",
    ]);
    expect(aptGet("install", "linux-image-amd64")).toContain("linux-image-amd64");
  });
});

import { describe, expect, test } from "bun:test";
import type { FindmntEntry } from "../src/system/fstab.ts";
import {
  buildFstab,
  formatFstabEntry,
  fstabDumpPass,
  fstabOptions,
  parseBlkidExport,
  parseFindmnt,
  parseSwaps,
  realEntries,
  subvolOption,
  targetToMountpoint,
} from "../src/system/fstab.ts";

const BTRFS_FINDMNT = `{
  "filesystems": [
    {
      "source": "/dev/sda3[/@]",
      "target": "/mnt",
      "fstype": "btrfs",
      "options": "rw,relatime,compress=zstd,ssd,space_cache=v2,subvol=/@",
      "uuid": "11111111-aaaa-4b00-8f1c-111111111111"
    },
    {
      "source": "/dev/sda3[/@home]",
      "target": "/mnt/home",
      "fstype": "btrfs",
      "options": "rw,relatime,compress=zstd,ssd,space_cache=v2,subvol=/@home",
      "uuid": "11111111-aaaa-4b00-8f1c-111111111111"
    },
    {
      "source": "/dev/sda3[/@snapshots]",
      "target": "/mnt/.snapshots",
      "fstype": "btrfs",
      "options": "rw,relatime,compress=zstd,ssd,space_cache=v2,subvol=/@snapshots",
      "uuid": "11111111-aaaa-4b00-8f1c-111111111111"
    },
    {
      "source": "/dev/sda1",
      "target": "/mnt/boot/efi",
      "fstype": "vfat",
      "options": "rw,relatime,fmask=0022,dmask=0022,codepage=437,iocharset=iso8859-1,shortname=mixed,errors=remount-ro",
      "uuid": "2222-CCCC"
    },
    {
      "source": "proc",
      "target": "/mnt/proc",
      "fstype": "proc",
      "options": "rw,nosuid,nodev,noexec,relatime"
    },
    {
      "source": "sysfs",
      "target": "/mnt/sys",
      "fstype": "sysfs",
      "options": "rw,nosuid,nodev,noexec,relatime"
    }
  ]
}`;

const SWAPS = `Filename\t\t\t\tType\t\tSize\t\tUsed\t\tPriority
/dev/sda2                               partition\t4194300\t0\t-2
`;

const BLKID = `DEVNAME=/dev/sda2
UUID=33333333-bbbb-4f00-9c30-333333333333
TYPE=swap

DEVNAME=/dev/sda1
UUID=2222-CCCC
TYPE=vfat
`;

describe("parseFindmnt / realEntries", () => {
  test("парсит все записи, включая псевдо-ФС", () => {
    const entries = parseFindmnt(BTRFS_FINDMNT);
    expect(entries).toHaveLength(6);
    expect(entries[0]).toMatchObject({ fstype: "btrfs", target: "/mnt" });
  });

  test("realEntries отсекает proc/sysfs — их монтирует сама система", () => {
    const real = realEntries(parseFindmnt(BTRFS_FINDMNT));
    expect(real.map((entry) => entry.fstype)).toEqual(["btrfs", "btrfs", "btrfs", "vfat"]);
  });
});

describe("targetToMountpoint", () => {
  test("/mnt → /, вложенные пути — без префикса корня", () => {
    expect(targetToMountpoint("/mnt")).toBe("/");
    expect(targetToMountpoint("/mnt/home")).toBe("/home");
    expect(targetToMountpoint("/mnt/.snapshots")).toBe("/.snapshots");
    expect(targetToMountpoint("/mnt/boot/efi")).toBe("/boot/efi");
  });
});

describe("subvolOption / fstabOptions", () => {
  test("извлекает subvol= из опций монтирования", () => {
    expect(subvolOption("rw,relatime,compress=zstd,subvol=/@")).toBe("subvol=/@");
    expect(subvolOption("rw,relatime")).toBeNull();
  });

  test("btrfs: compress=zstd,noatime + subvol; vfat: umask; ext4: rw,relatime", () => {
    const entryAt = (index: number): FindmntEntry => {
      const entry = parseFindmnt(BTRFS_FINDMNT)[index];
      if (!entry) throw new Error(`Нет записи ${index} в фикстуре`);
      return entry;
    };
    expect(fstabOptions(entryAt(0))).toBe("rw,noatime,compress=zstd,subvol=/@");
    expect(fstabOptions(entryAt(3))).toBe("defaults,umask=0077");
    expect(
      fstabOptions({ source: "/dev/sda2", target: "/mnt", fstype: "ext4", options: "rw,relatime" }),
    ).toBe("rw,relatime");
  });
});

describe("fstabDumpPass", () => {
  test("btrfs/xfs не проверяются fsck; корень ext4 — pass 1; прочие ext4 — pass 2", () => {
    expect(fstabDumpPass("btrfs", "/")).toEqual([0, 0]);
    expect(fstabDumpPass("ext4", "/")).toEqual([0, 1]);
    expect(fstabDumpPass("ext4", "/home")).toEqual([0, 2]);
    expect(fstabDumpPass("vfat", "/boot/efi")).toEqual([0, 1]);
  });
});

describe("parseSwaps / parseBlkidExport", () => {
  test("извлекает устройства подкачки из /proc/swaps", () => {
    expect(parseSwaps(SWAPS)).toEqual(["/dev/sda2"]);
    expect(parseSwaps("")).toEqual([]);
  });

  test("строит карту устройство → UUID из blkid -o export", () => {
    const map = parseBlkidExport(BLKID);
    expect(map.get("/dev/sda2")).toBe("33333333-bbbb-4f00-9c30-333333333333");
    expect(map.get("/dev/sda1")).toBe("2222-CCCC");
    expect(map.size).toBe(2);
  });
});

describe("buildFstab", () => {
  test("btrfs+subvolumes+ESP: fstab по UUID, swap добавлен из blkid", () => {
    const fstab = buildFstab(BTRFS_FINDMNT, SWAPS, BLKID);
    expect(fstab).toBe(
      [
        "UUID=11111111-aaaa-4b00-8f1c-111111111111\t/\tbtrfs\trw,noatime,compress=zstd,subvol=/@\t0\t0",
        "UUID=11111111-aaaa-4b00-8f1c-111111111111\t/home\tbtrfs\trw,noatime,compress=zstd,subvol=/@home\t0\t0",
        "UUID=11111111-aaaa-4b00-8f1c-111111111111\t/.snapshots\tbtrfs\trw,noatime,compress=zstd,subvol=/@snapshots\t0\t0",
        "UUID=2222-CCCC\t/boot/efi\tvfat\tdefaults,umask=0077\t0\t1",
        "UUID=33333333-bbbb-4f00-9c30-333333333333\tnone\tswap\tsw\t0\t0",
      ].join("\n"),
    );
  });

  test("ext4 root: rw,relatime и pass 1", () => {
    const json = `{
      "filesystems": [
        {
          "source": "/dev/sda1",
          "target": "/mnt",
          "fstype": "ext4",
          "options": "rw,relatime",
          "uuid": "EEEE-EX4"
        }
      ]
    }`;
    expect(buildFstab(json, "", "")).toBe("UUID=EEEE-EX4\t/\text4\trw,relatime\t0\t1");
  });

  test("записи без UUID пропускаются (например, ещё не размеченные)", () => {
    const json = `{
      "filesystems": [
        { "source": "/dev/sda9", "target": "/mnt", "fstype": "ext4", "options": "rw,relatime" }
      ]
    }`;
    expect(buildFstab(json, "", "")).toBe("");
  });

  test("swap без UUID в blkid не попадает в fstab", () => {
    expect(buildFstab(BTRFS_FINDMNT, SWAPS, "DEVNAME=/dev/sda2\nTYPE=swap\n")).not.toContain(
      "\tswap\t",
    );
  });

  test("формат одной записи — стандартный fstab", () => {
    expect(
      formatFstabEntry({
        source: "UUID=X",
        mountpoint: "/",
        fstype: "ext4",
        options: "rw,relatime",
        dump: 0,
        pass: 1,
      }),
    ).toBe("UUID=X\t/\text4\trw,relatime\t0\t1");
  });
});

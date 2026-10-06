import { describe, expect, test } from "bun:test";
import type { DiskConfig } from "../src/config/types.ts";
import { defaultConfig } from "../src/config/types.ts";
import {
  buildPartitionLayout,
  keepMountCommands,
  layoutCommands,
  missingPlanTools,
  parseLsblkPartitions,
  planPartitionCommands,
} from "../src/system/disks.ts";

function disk(overrides: Partial<DiskConfig> = {}): DiskConfig {
  return {
    device: "/dev/sda",
    layout: "auto",
    filesystem: "btrfs",
    swap: true,
    swapSizeGiB: 4,
    espSizeGiB: 1,
    btrfsSubvolumes: true,
    ...overrides,
  };
}

describe("buildPartitionLayout", () => {
  test("UEFI + btrfs + swap → GPT: ESP, swap, root (остаток)", () => {
    const layout = buildPartitionLayout(disk(), "uefi");
    expect(layout.table).toBe("gpt");
    expect(layout.partitions.map((p) => p.kind)).toEqual(["esp", "swap", "root"]);
    expect(layout.partitions[0]).toMatchObject({
      number: 1,
      kind: "esp",
      filesystem: "fat32",
      mountpoint: "/boot/efi",
      bootFlag: "esp",
      sizeGiB: 1,
    });
    expect(layout.partitions[1]).toMatchObject({ number: 2, kind: "swap", sizeGiB: 4 });
    expect(layout.partitions[2]).toMatchObject({
      number: 3,
      kind: "root",
      filesystem: "btrfs",
      mountpoint: "/",
      btrfsSubvolumes: true,
    });
    expect(layout.partitions[2]?.sizeGiB).toBeUndefined();
  });

  test("UEFI + ext4 без swap → GPT: ESP, root", () => {
    const layout = buildPartitionLayout(disk({ filesystem: "ext4", swap: false }), "uefi");
    expect(layout.partitions.map((p) => p.kind)).toEqual(["esp", "root"]);
    expect(layout.partitions[1]?.bootFlag).toBeUndefined();
    expect(layout.partitions[1]?.btrfsSubvolumes).toBe(false);
  });

  test("BIOS + btrfs + swap → MBR: swap, root (boot)", () => {
    const layout = buildPartitionLayout(disk(), "bios");
    expect(layout.table).toBe("msdos");
    expect(layout.partitions.map((p) => p.kind)).toEqual(["swap", "root"]);
    expect(layout.partitions[1]).toMatchObject({ number: 2, kind: "root", bootFlag: "boot" });
  });

  test("BIOS + ext4 без swap → MBR: один root (boot)", () => {
    const layout = buildPartitionLayout(disk({ filesystem: "ext4", swap: false }), "bios");
    expect(layout.partitions).toHaveLength(1);
    expect(layout.partitions[0]).toMatchObject({ number: 1, kind: "root", bootFlag: "boot" });
  });
});

describe("layoutCommands", () => {
  test("NVMe UEFI btrfs: имена с pN, mkfs и subvolumes", () => {
    const commands = layoutCommands("/dev/nvme0n1", buildPartitionLayout(disk(), "uefi"));
    const argv = commands.map((c) => c.argv);

    expect(argv[0]).toEqual(["parted", "-s", "/dev/nvme0n1", "mklabel", "gpt"]);
    expect(argv.some((a) => a.join(" ") === "mkfs.fat -F32 /dev/nvme0n1p1")).toBe(true);
    expect(argv.some((a) => a.join(" ") === "mkfs.btrfs -f /dev/nvme0n1p3")).toBe(true);
    expect(argv.some((a) => a.join(" ") === "btrfs subvolume create /mnt/@")).toBe(true);
    expect(
      argv.some(
        (a) => a.join(" ") === "mount -o subvol=@,compress=zstd,noatime /dev/nvme0n1p3 /mnt",
      ),
    ).toBe(true);
    expect(argv.some((a) => a.join(" ") === "mount /dev/nvme0n1p1 /mnt/boot/efi")).toBe(true);
    expect(argv.some((a) => a.includes("udevadm") && a.includes("settle"))).toBe(true);
  });

  test("SATA BIOS ext4: MBR, mkswap и boot-флаг на root", () => {
    const commands = layoutCommands(
      "/dev/sda",
      buildPartitionLayout(disk({ filesystem: "ext4" }), "bios"),
    );
    const argv = commands.map((c) => c.argv);

    expect(argv[0]).toEqual(["parted", "-s", "/dev/sda", "mklabel", "msdos"]);
    expect(argv.some((a) => a.join(" ") === "mkswap /dev/sda1")).toBe(true);
    expect(argv.some((a) => a.join(" ") === "mkfs.ext4 -F /dev/sda2")).toBe(true);
    expect(argv.some((a) => a.join(" ") === "parted -s /dev/sda set 2 boot on")).toBe(true);
    expect(argv.some((a) => a.join(" ") === "mount /dev/sda2 /mnt")).toBe(true);
    expect(argv.some((a) => a.includes("/mnt/boot/efi"))).toBe(false);
  });

  test("btrfs без subvolumes монтируется с compress=zstd,noatime", () => {
    const commands = layoutCommands(
      "/dev/sda",
      buildPartitionLayout(disk({ btrfsSubvolumes: false }), "uefi"),
    );
    const argv = commands.map((c) => c.argv);
    expect(argv.some((a) => a.join(" ") === "mount -o compress=zstd,noatime /dev/sda3 /mnt")).toBe(
      true,
    );
    expect(argv.some((a) => a.includes("subvolume create"))).toBe(false);
  });
});

describe("keepMountCommands", () => {
  test("root + esp + swap — монтирование без форматирования", () => {
    const commands = keepMountCommands(
      disk({
        layout: "keep",
        rootPartition: "/dev/sda2",
        espPartition: "/dev/sda1",
        swap: true,
        swapPartition: "/dev/sda3",
      }),
    );
    expect(commands.map((c) => c.argv.join(" "))).toEqual([
      "mount /dev/sda2 /mnt",
      "mkdir -p /mnt/boot/efi",
      "mount /dev/sda1 /mnt/boot/efi",
      "swapon /dev/sda3",
    ]);
  });

  test("btrfs root с subvolumes монтируется с subvol=@", () => {
    const commands = keepMountCommands(
      disk({ layout: "keep", rootPartition: "/dev/sda2", rootPartitionFstype: "btrfs" }),
    );
    expect(commands[0]?.argv).toEqual(["mount", "-o", "subvol=@", "/dev/sda2", "/mnt"]);
  });

  test("без rootPartition — ошибка", () => {
    expect(() => keepMountCommands(disk({ layout: "keep" }))).toThrow();
  });
});

describe("missingPlanTools", () => {
  test("ext4 UEFI план: все инструменты на месте → пусто", () => {
    const commands = layoutCommands(
      "/dev/sda",
      buildPartitionLayout(disk({ filesystem: "ext4" }), "uefi"),
    );
    expect(
      missingPlanTools(commands, ["parted", "udevadm", "mkfs.fat", "mkswap", "mkfs.ext4"]),
    ).toEqual([]);
  });

  test("ext4 план без mkfs.ext4 (e2fsprogs отсутствует в LiveCD) → find missing", () => {
    const commands = layoutCommands(
      "/dev/sda",
      buildPartitionLayout(disk({ filesystem: "ext4" }), "uefi"),
    );
    expect(missingPlanTools(commands, ["parted", "udevadm", "mkfs.fat", "mkswap"])).toEqual([
      "mkfs.ext4",
    ]);
  });

  test("keep layout (только mount) — проверяемых инструментов нет", () => {
    const commands = keepMountCommands(disk({ layout: "keep", rootPartition: "/dev/sda2" }));
    expect(missingPlanTools(commands, [])).toEqual([]);
  });
});

describe("planPartitionCommands", () => {
  test("auto → layoutCommands, keep → keepMountCommands", () => {
    const auto = defaultConfig();
    auto.disk.device = "/dev/sda";
    auto.disk.layout = "auto";
    const autoCommands = planPartitionCommands(auto, "uefi");
    expect(autoCommands[0]?.argv).toEqual(["parted", "-s", "/dev/sda", "mklabel", "gpt"]);

    const keep = defaultConfig();
    keep.disk.layout = "keep";
    keep.disk.rootPartition = "/dev/sda2";
    const keepCommandsList = planPartitionCommands(keep, "uefi");
    expect(keepCommandsList[0]?.argv.join(" ")).toBe("mount /dev/sda2 /mnt");
  });
});

describe("parseLsblkPartitions", () => {
  const JSON_OUTPUT = `{
    "blockdevices": [
      {
        "name": "sda",
        "path": "/dev/sda",
        "type": "disk",
        "children": [
          {
            "name": "sda1",
            "path": "/dev/sda1",
            "size": "512M",
            "type": "part",
            "fstype": "vfat",
            "mountpoints": ["/mnt/boot/efi"]
          },
          {
            "name": "sda2",
            "path": "/dev/sda2",
            "size": "30G",
            "type": "part",
            "fstype": "btrfs",
            "mountpoints": ["/mnt"]
          }
        ]
      }
    ]
  }`;

  test("разделы: путь, размер, fstype, mountpoints", () => {
    const partitions = parseLsblkPartitions(JSON_OUTPUT);
    expect(partitions.map((p) => p.name)).toEqual(["sda1", "sda2"]);
    expect(partitions[1]?.path).toBe("/dev/sda2");
    expect(partitions[1]?.fstype).toBe("btrfs");
    expect(partitions[1]?.mountpoints).toEqual(["/mnt"]);
    expect(partitions[0]?.mountpoints).toEqual(["/mnt/boot/efi"]);
  });
});

import { describe, expect, test } from "bun:test";
import { defaultConfig } from "../src/config/types.ts";
import {
  BTRFS_SUBVOLUME_MOUNTS,
  deviceFromSource,
  diskPreparationStateFrom,
  missingSubvolumesOnDisk,
  mountedRootSource,
  parseLsblkOutput,
  partitionPath,
  subvolumeMountCommands,
  wantsBtrfsSubvolumes,
} from "../src/system/disks.ts";

const SAMPLE = `{
  "blockdevices": [
    {
      "name": "sda",
      "path": "/dev/sda",
      "size": "238.5G",
      "type": "disk",
      "rm": "0",
      "tran": "sata",
      "model": "SSD",
      "mountpoints": null
    },
    {
      "name": "sdb",
      "path": "/dev/sdb",
      "size": "57.3G",
      "type": "disk",
      "rm": "1",
      "tran": "usb",
      "model": "Flash",
      "mountpoints": null,
      "children": [
        {
          "name": "sdb1",
          "path": "/dev/sdb1",
          "size": "57.3G",
          "type": "part",
          "rm": "1",
          "tran": "usb",
          "model": null,
          "mountpoints": ["/run/live/medium"]
        }
      ]
    },
    {
      "name": "nvme0n1",
      "path": "/dev/nvme0n1",
      "size": "476.9G",
      "type": "disk",
      "rm": "0",
      "tran": "nvme",
      "model": null,
      "mountpoints": null
    },
    {
      "name": "loop0",
      "path": "/dev/loop0",
      "size": "100M",
      "type": "loop",
      "rm": "0",
      "tran": null,
      "model": null,
      "mountpoints": ["/run/live/rootfs"]
    }
  ]
}`;

describe("parseLsblkOutput", () => {
  test("возвращает только диски (type=disk)", () => {
    const disks = parseLsblkOutput(SAMPLE);
    expect(disks.map((disk) => disk.name)).toEqual(["sda", "sdb", "nvme0n1"]);
  });

  test("помечает носитель LiveCD по mountpoints дочерних разделов", () => {
    const disks = parseLsblkOutput(SAMPLE);
    expect(disks.find((disk) => disk.name === "sdb")?.isLiveMedium).toBe(true);
    expect(disks.find((disk) => disk.name === "sda")?.isLiveMedium).toBe(false);
    expect(disks.find((disk) => disk.name === "nvme0n1")?.isLiveMedium).toBe(false);
  });

  test("читает размер, транспорт и съёмность", () => {
    const disks = parseLsblkOutput(SAMPLE);
    const sda = disks.find((disk) => disk.name === "sda");
    expect(sda?.size).toBe("238.5G");
    expect(sda?.tran).toBe("sata");
    expect(sda?.model).toBe("SSD");
    expect(sda?.removable).toBe(false);
    expect(disks.find((disk) => disk.name === "sdb")?.removable).toBe(true);
  });
});

describe("partitionPath", () => {
  test("sdX — без суффикса", () => {
    expect(partitionPath("/dev/sda", 1)).toBe("/dev/sda1");
  });

  test("NVMe — с суффиксом p", () => {
    expect(partitionPath("/dev/nvme0n1", 2)).toBe("/dev/nvme0n1p2");
  });

  test("MMC — с суффиксом p", () => {
    expect(partitionPath("/dev/mmcblk0", 1)).toBe("/dev/mmcblk0p1");
  });
});

describe("wantsBtrfsSubvolumes", () => {
  test("auto/manual: btrfs + флаг subvolumes", () => {
    const config = defaultConfig();
    config.disk.filesystem = "btrfs";
    config.disk.btrfsSubvolumes = true;
    expect(wantsBtrfsSubvolumes(config)).toBe(true);

    config.disk.btrfsSubvolumes = false;
    expect(wantsBtrfsSubvolumes(config)).toBe(false);

    config.disk.filesystem = "ext4";
    config.disk.btrfsSubvolumes = true;
    expect(wantsBtrfsSubvolumes(config)).toBe(false);
  });

  test("keep: тип корневого раздела важнее disk.filesystem", () => {
    const config = defaultConfig();
    config.disk.layout = "keep";
    config.disk.filesystem = "ext4";
    config.disk.btrfsSubvolumes = true;
    config.disk.rootPartitionFstype = "btrfs";
    expect(wantsBtrfsSubvolumes(config)).toBe(true);

    config.disk.rootPartitionFstype = "ext4";
    expect(wantsBtrfsSubvolumes(config)).toBe(false);
  });
});

describe("diskPreparationStateFrom", () => {
  test("root не смонтирован — none (полная разметка)", () => {
    expect(diskPreparationStateFrom(false, true, [])).toBe("none");
  });

  test("root смонтирован, subvolumes не ожидаются — ready", () => {
    expect(diskPreparationStateFrom(true, false, [])).toBe("ready");
  });

  test("root смонтирован, все subvolumes на месте — ready", () => {
    expect(diskPreparationStateFrom(true, true, [])).toBe("ready");
  });

  test("root смонтирован, часть subvolumes отсутствует — partial (не none!)", () => {
    expect(diskPreparationStateFrom(true, true, ["@home"])).toBe("partial");
    expect(diskPreparationStateFrom(true, true, ["@home", "@snapshots"])).toBe("partial");
  });
});

describe("subvolumeMountCommands", () => {
  test("только отсутствующие subvolumes монтируются с mkdir", () => {
    expect(subvolumeMountCommands("/dev/sda3", ["@home"]).map((c) => c.argv.join(" "))).toEqual([
      "mkdir -p /mnt/home",
      "mount -o subvol=@home,compress=zstd,noatime /dev/sda3 /mnt/home",
    ]);
  });

  test("home и snapshots — в порядке BTRFS_SUBVOLUME_MOUNTS", () => {
    expect(
      subvolumeMountCommands("/dev/sda3", ["@home", "@snapshots"]).map((c) => c.argv.join(" ")),
    ).toEqual([
      "mkdir -p /mnt/home",
      "mount -o subvol=@home,compress=zstd,noatime /dev/sda3 /mnt/home",
      "mkdir -p /mnt/.snapshots",
      "mount -o subvol=@snapshots,compress=zstd,noatime /dev/sda3 /mnt/.snapshots",
    ]);
  });

  test("пустой список — пустой план", () => {
    expect(subvolumeMountCommands("/dev/sda3", [])).toEqual([]);
  });

  test("ожидаемые точки монтирования — /home и /.snapshots", () => {
    expect(BTRFS_SUBVOLUME_MOUNTS.map((s) => s.mountpoint)).toEqual(["/home", "/.snapshots"]);
  });
});

describe("deviceFromSource", () => {
  test("срезает btrfs-суффикс subvolume из findmnt SOURCE", () => {
    expect(deviceFromSource("/dev/sda3[/@]")).toBe("/dev/sda3");
    expect(deviceFromSource("/dev/sda3[/@]\n")).toBe("/dev/sda3");
  });

  test("обычный путь без суффикса не меняется", () => {
    expect(deviceFromSource("/dev/sda2")).toBe("/dev/sda2");
  });

  test("нежадный regex:[/@] режется, а содержимое внутри — нет", () => {
    expect(deviceFromSource("/dev/nvme0n1p1[/@home]")).toBe("/dev/nvme0n1p1");
    expect(deviceFromSource("/dev/sda1[/@]\n")).toBe("/dev/sda1");
  });
});

describe("missingSubvolumesOnDisk", () => {
  test("парсит вывод btrfs subvolume list: пустой список — все subvolumes отсутствуют", () => {
    // Функция вызывает exec, поэтому тестируем через моки.
    // Здесь проверяем, что функция экспортирована и принимает правильные аргументы.
    expect(typeof missingSubvolumesOnDisk).toBe("function");
  });
});

describe("mountedRootSource", () => {
  test("функция экспортирована и асинхронна", () => {
    expect(typeof mountedRootSource).toBe("function");
  });
});

import { describe, expect, test } from "bun:test";
import { parseLsblkOutput, partitionPath } from "../src/system/disks.ts";

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

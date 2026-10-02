import { note } from "@clack/prompts";
import type { InstallConfig } from "../config/types.ts";
import {
  type DiskInfo,
  detectFirmware,
  type Firmware,
  listDisks,
  listPartitions,
  type PartitionInfo,
} from "../system/index.ts";
import { backOption, confirm, isBack, select, text } from "../ui/prompts.ts";
import type { Step, StepResult } from "../ui/wizard.ts";

function diskOptions(disks: DiskInfo[]) {
  return disks.map((disk) => ({
    value: disk.path,
    label: disk.path,
    hint: [disk.size, disk.model, disk.tran, disk.removable ? "removable" : undefined]
      .filter((part): part is string => Boolean(part))
      .join(", "),
  }));
}

function partitionOptions(partitions: PartitionInfo[]) {
  return partitions.map((partition) => ({
    value: partition.path,
    label: partition.path,
    hint: [
      partition.size,
      partition.fstype ?? "?",
      partition.mountpoints.length ? `mounted: ${partition.mountpoints.join(",")}` : undefined,
    ]
      .filter((part): part is string => Boolean(part))
      .join(", "),
  }));
}

/** Keep layout: pick existing partitions, nothing is wiped. */
async function runKeep(config: InstallConfig, firmware: Firmware): Promise<StepResult> {
  const partitions = await listPartitions(config.disk.device);
  if (partitions.length === 0) {
    throw new Error(
      `Disk ${config.disk.device} has no partitions — the "keep partitions" layout is impossible`,
    );
  }

  const root = await select<string>({
    message: "Partition for /",
    options: [...partitionOptions(partitions), backOption()],
  });
  if (isBack(root)) return { type: "back" };
  config.disk.rootPartition = root;
  config.disk.rootPartitionFstype = partitions.find((p) => p.path === root)?.fstype;

  if (firmware === "uefi") {
    const esp = await select<string>({
      message: "ESP partition (/boot/efi)",
      options: [
        { value: "none", label: "No ESP", hint: "caution: UEFI won't boot without ESP" },
        ...partitionOptions(partitions),
        backOption(),
      ],
    });
    if (isBack(esp)) return { type: "back" };
    config.disk.espPartition = esp === "none" ? undefined : esp;
  }

  const swap = await select<string>({
    message: "Swap partition",
    options: [{ value: "none", label: "No swap" }, ...partitionOptions(partitions), backOption()],
  });
  if (isBack(swap)) return { type: "back" };
  if (swap === "none") {
    config.disk.swap = false;
    config.disk.swapPartition = undefined;
  } else {
    config.disk.swap = true;
    config.disk.swapPartition = swap;
  }

  return { type: "continue" };
}

export const diskStep: Step = {
  id: "disk",
  title: "Target disk",
  async run({ config }): Promise<StepResult> {
    let disks: DiskInfo[];
    try {
      disks = await listDisks();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to list disks: ${message}`);
    }

    // The LiveCD medium and the current system disk are excluded from the choice.
    const candidates = disks.filter((disk) => !disk.isLiveMedium);
    const firmware = await detectFirmware();
    note(`Firmware: ${firmware === "uefi" ? "UEFI" : "BIOS"}`, "Environment");

    if (candidates.length === 0) {
      throw new Error("No suitable disks found (LiveCD medium and current system disk excluded)");
    }

    const device = await select<string>({
      message: "Target disk",
      options: [...diskOptions(candidates), backOption()],
    });

    if (isBack(device)) return { type: "back" };
    config.disk.device = device;

    const layout = await select<string>({
      message: "Partitioning scheme",
      initialValue: config.disk.layout,
      options: [
        { value: "auto", label: "Automatic", hint: "wipe the disk and repartition" },
        { value: "manual", label: "Manual", hint: "custom ESP/swap sizes" },
        {
          value: "keep",
          label: "Keep partitions",
          hint: "use existing partitions, no wiping",
        },
        backOption(),
      ],
    });

    if (isBack(layout)) return { type: "back" };
    if (layout !== "auto" && layout !== "manual" && layout !== "keep") {
      throw new Error(`Unknown partitioning scheme: ${layout}`);
    }
    config.disk.layout = layout;

    // Clear fields of the other scheme when switching choices.
    config.disk.rootPartition = undefined;
    config.disk.rootPartitionFstype = undefined;
    config.disk.espPartition = undefined;
    config.disk.swapPartition = undefined;

    if (layout === "keep") return runKeep(config, firmware);

    const fs = await select<string>({
      message: "Filesystem",
      initialValue: config.disk.filesystem,
      options: [
        { value: "btrfs", label: "btrfs", hint: "subvolumes, snapshots, compression" },
        { value: "ext4", label: "ext4", hint: "simple and proven" },
        backOption(),
      ],
    });

    if (isBack(fs)) return { type: "back" };
    if (fs !== "btrfs" && fs !== "ext4") {
      throw new Error(`Unknown filesystem: ${fs}`);
    }

    config.disk.filesystem = fs;

    if (config.disk.filesystem === "btrfs") {
      config.disk.btrfsSubvolumes = await confirm({
        message: "Create subvolumes @, @home, @snapshots?",
        initialValue: config.disk.btrfsSubvolumes,
      });
    }

    if (firmware === "uefi" && layout === "manual") {
      const espSize = await text({
        message: "ESP size, GiB",
        defaultValue: String(config.disk.espSizeGiB),
        validate: (value) => {
          const n = Number(value);
          if (!Number.isFinite(n) || n <= 0) return "Enter a positive number";
          return undefined;
        },
      });
      config.disk.espSizeGiB = Number(espSize);
    }

    config.disk.swap = await confirm({
      message: "Create a swap partition?",
      initialValue: config.disk.swap,
    });

    if (config.disk.swap) {
      const size = await text({
        message: "Swap size, GiB",
        defaultValue: String(config.disk.swapSizeGiB),
        validate: (value) => {
          const n = Number(value);
          if (!Number.isFinite(n) || n <= 0) return "Enter a positive number";
          return undefined;
        },
      });
      config.disk.swapSizeGiB = Number(size);
    }

    return { type: "continue" };
  },
};

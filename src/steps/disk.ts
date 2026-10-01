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
    hint: [disk.size, disk.model, disk.tran, disk.removable ? "съёмный" : undefined]
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
      partition.mountpoints.length ? `смонтирован: ${partition.mountpoints.join(",")}` : undefined,
    ]
      .filter((part): part is string => Boolean(part))
      .join(", "),
  }));
}

/** Схема keep: выбор существующих разделов, ничего не стирается. */
async function runKeep(config: InstallConfig, firmware: Firmware): Promise<StepResult> {
  const partitions = await listPartitions(config.disk.device);
  if (partitions.length === 0) {
    throw new Error(
      `На диске ${config.disk.device} нет разделов — схема «оставить разделы» невозможна`,
    );
  }

  const root = await select<string>({
    message: "Раздел для /",
    options: [...partitionOptions(partitions), backOption()],
  });
  if (isBack(root)) return { type: "back" };
  config.disk.rootPartition = root;
  config.disk.rootPartitionFstype = partitions.find((p) => p.path === root)?.fstype;

  if (firmware === "uefi") {
    const esp = await select<string>({
      message: "Раздел ESP (/boot/efi)",
      options: [
        { value: "none", label: "Нет ESP", hint: "осторожно: UEFI не загрузится без ESP" },
        ...partitionOptions(partitions),
        backOption(),
      ],
    });
    if (isBack(esp)) return { type: "back" };
    config.disk.espPartition = esp === "none" ? undefined : esp;
  }

  const swap = await select<string>({
    message: "Раздел подкачки",
    options: [{ value: "none", label: "Без swap" }, ...partitionOptions(partitions), backOption()],
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
  title: "Целевой диск",
  async run({ config }): Promise<StepResult> {
    let disks: DiskInfo[];
    try {
      disks = await listDisks();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Ошибка определения дисков: ${message}`);
    }

    // Носитель LiveCD и системный диск текущей ОС исключаем из выбора.
    const candidates = disks.filter((disk) => !disk.isLiveMedium);
    const firmware = await detectFirmware();
    note(`Прошивка: ${firmware === "uefi" ? "UEFI" : "BIOS"}`, "Окружение");

    if (candidates.length === 0) {
      throw new Error("Не найдено подходящих дисков (носитель LiveCD и системный диск исключены)");
    }

    const device = await select<string>({
      message: "Целевой диск",
      options: [...diskOptions(candidates), backOption()],
    });

    if (isBack(device)) return { type: "back" };
    config.disk.device = device;

    const layout = await select<string>({
      message: "Схема разметки",
      initialValue: config.disk.layout,
      options: [
        { value: "auto", label: "Авто", hint: "стереть диск и разметить заново" },
        { value: "manual", label: "Ручная", hint: "свои размеры ESP/swap" },
        {
          value: "keep",
          label: "Оставить разделы",
          hint: "использовать существующие, без стирания",
        },
        backOption(),
      ],
    });

    if (isBack(layout)) return { type: "back" };
    if (layout !== "auto" && layout !== "manual" && layout !== "keep") {
      throw new Error(`Неизвестная схема разметки: ${layout}`);
    }
    config.disk.layout = layout;

    // Очищаем поля другой схемы при смене выбора.
    config.disk.rootPartition = undefined;
    config.disk.rootPartitionFstype = undefined;
    config.disk.espPartition = undefined;
    config.disk.swapPartition = undefined;

    if (layout === "keep") return runKeep(config, firmware);

    const fs = await select<string>({
      message: "Файловая система",
      initialValue: config.disk.filesystem,
      options: [
        { value: "btrfs", label: "btrfs", hint: "subvolumes, снапшоты, сжатие" },
        { value: "ext4", label: "ext4", hint: "простая и проверенная" },
        backOption(),
      ],
    });

    if (isBack(fs)) return { type: "back" };
    if (fs !== "btrfs" && fs !== "ext4") {
      throw new Error(`Неизвестная файловая система: ${fs}`);
    }

    config.disk.filesystem = fs;

    if (config.disk.filesystem === "btrfs") {
      config.disk.btrfsSubvolumes = await confirm({
        message: "Создать subvolumes @, @home, @snapshots?",
        initialValue: config.disk.btrfsSubvolumes,
      });
    }

    if (firmware === "uefi" && layout === "manual") {
      const espSize = await text({
        message: "Размер ESP, GiB",
        defaultValue: String(config.disk.espSizeGiB),
        validate: (value) => {
          const n = Number(value);
          if (!Number.isFinite(n) || n <= 0) return "Введите положительное число";
          return undefined;
        },
      });
      config.disk.espSizeGiB = Number(espSize);
    }

    config.disk.swap = await confirm({
      message: "Создать swap-раздел?",
      initialValue: config.disk.swap,
    });

    if (config.disk.swap) {
      const size = await text({
        message: "Размер swap, GiB",
        defaultValue: String(config.disk.swapSizeGiB),
        validate: (value) => {
          const n = Number(value);
          if (!Number.isFinite(n) || n <= 0) return "Введите положительное число";
          return undefined;
        },
      });
      config.disk.swapSizeGiB = Number(size);
    }

    return { type: "continue" };
  },
};

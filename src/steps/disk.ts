import { note } from "@clack/prompts";
import type { Filesystem } from "../config/types.ts";
import type { DiskInfo } from "../system/disks.ts";
import { detectFirmware, listDisks } from "../system/index.ts";
import { backOption, confirm, isBack, select, text } from "../ui/prompts.ts";
import type { Step, StepResult } from "../ui/wizard.ts";

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
      options: [
        ...candidates.map((disk) => ({
          value: disk.path,
          label: disk.path,
          hint: [disk.size, disk.model, disk.tran, disk.removable ? "съёмный" : undefined]
            .filter((part): part is string => Boolean(part))
            .join(", "),
        })),
        backOption(),
      ],
    });

    if (isBack(device)) return { type: "back" };
    config.disk.device = device;

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

    config.disk.filesystem = fs as Filesystem;

    if (config.disk.filesystem === "btrfs") {
      config.disk.btrfsSubvolumes = await confirm({
        message: "Создать subvolumes @, @home, @snapshots?",
        initialValue: config.disk.btrfsSubvolumes,
      });
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

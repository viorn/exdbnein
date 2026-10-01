import type { Filesystem } from "../config/types.ts";
import { confirm, select, text } from "../ui/prompts.ts";
import type { Step, StepResult } from "../ui/wizard.ts";

export const diskStep: Step = {
  id: "disk",
  title: "Целевой диск",
  async run({ config }): Promise<StepResult> {
    config.disk.device = await text({
      message: "Устройство для установки",
      placeholder: "/dev/sda",
      validate: (value) => {
        if (!value) return "Укажите устройство";
        if (!value.startsWith("/dev/")) return "Путь должен начинаться с /dev/";
        return undefined;
      },
    });

    const fs = await select<string>({
      message: "Файловая система",
      initialValue: config.disk.filesystem,
      options: [
        { value: "btrfs", label: "btrfs", hint: "subvolumes, снапшоты, сжатие" },
        { value: "ext4", label: "ext4", hint: "простая и проверенная" },
        { value: "back", label: "← Назад", hint: "к выбору устройства" },
      ],
    });

    if (fs === "back") {
      return { type: "back" } satisfies StepResult;
    }

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

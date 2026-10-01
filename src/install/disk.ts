import { log, spinner } from "@clack/prompts";
import {
  type CommandPhase,
  isDiskPrepared,
  type PlannedCommand,
  planPartitionCommands,
} from "../system/disks.ts";
import { detectFirmware } from "../system/environment.ts";
import { exec } from "../system/exec.ts";
import { CancelledError } from "../ui/errors.ts";
import { confirm } from "../ui/prompts.ts";
import type { InstallContext, InstallStage } from "./index.ts";

const PHASE_TITLE: Record<CommandPhase, string> = {
  partition: "Разметка",
  format: "Форматирование",
  mount: "Монтирование",
};

/** Разметка и форматирование уничтожают данные — это необратимая часть плана. */
function isDestructive(commands: PlannedCommand[]): boolean {
  return commands.some((command) => command.phase === "partition" || command.phase === "format");
}

/** Печатает план команд по фазам (dry-run, ничего не выполняется). */
function printPlan(commands: PlannedCommand[]): void {
  let phase: CommandPhase | null = null;
  for (const command of commands) {
    if (command.phase !== phase) {
      log.step(PHASE_TITLE[command.phase]);
      phase = command.phase;
    }
    log.message(`  ${command.argv.join(" ")}`);
  }
}

/** Выполняет команды плана последовательно, напрямую (без shell). */
async function runCommands(commands: PlannedCommand[], label: string): Promise<void> {
  const progress = spinner();
  progress.start(label);
  try {
    for (const command of commands) {
      await exec(command.argv);
    }
    progress.stop("Выполнено");
  } catch (error) {
    progress.stop("Ошибка");
    throw error;
  }
}

/**
 * Этап 4: подготовка целевого диска — таблица разделов, ФС, subvolumes,
 * монтирование в /mnt. Первая необратимая точка установки.
 */
export const prepareDiskStage: InstallStage = {
  id: "disk",
  title: "Подготовка диска",
  async run(ctx: InstallContext): Promise<void> {
    const { config, interactive } = ctx;
    const device = config.disk.device;

    // Идемпотентность: повторный вход поверх уже размеченного диска не стирает его.
    if (await isDiskPrepared(device)) {
      log.info(`Диск ${device} уже размечен и примонтирован в /mnt — разметка пропущена.`);
      return;
    }

    const firmware = await detectFirmware();
    const commands = planPartitionCommands(config, firmware);
    const destructive = isDestructive(commands);

    if (destructive) {
      log.warn(`Данные на диске ${device} будут стёрты.`);
    }
    log.info("План команд (dry-run):");
    printPlan(commands);

    if (interactive) {
      const confirmed = await confirm({
        message: destructive
          ? `Выполнить разметку? Данные на ${device} будут уничтожены`
          : `Примонтировать разделы диска ${device}?`,
        initialValue: false,
      });
      if (!confirmed) throw new CancelledError("Установка отменена: разметка не подтверждена");
    }

    await runCommands(commands, destructive ? "Разметка диска..." : "Монтирование разделов...");
    log.success("Диск подготовлен");
  },
};

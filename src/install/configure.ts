import { log } from "@clack/prompts";
import { type PlannedAction, writeTargetFile } from "../system/base.ts";
import {
  planBootloader,
  planDebconfPresets,
  planHostname,
  planKeyboard,
  planLocale,
  planNetwork,
  planRootPassword,
  planSystemPackages,
  planTimezone,
  planUsers,
} from "../system/configure.ts";
import { detectFirmware } from "../system/environment.ts";
import { runLong } from "../system/run.ts";
import { CancelledError } from "../ui/errors.ts";
import { confirm } from "../ui/prompts.ts";
import type { InstallContext, InstallStage } from "./index.ts";

/** Печатает план действий (dry-run, ничего не выполняется). */
function printPlan(plan: PlannedAction[]): void {
  for (const action of plan) {
    if (action.argv) {
      log.message(`  ${action.argv.join(" ")}`);
    } else if (action.file) {
      log.message(`  ${action.file.path} ← ${action.description}`);
    }
  }
}

/** Выполняет одно действие плана: команду или запись файла в целевой корень. */
async function runAction(action: PlannedAction): Promise<void> {
  if (action.argv) {
    await runLong(action.argv, { label: action.description });
  } else if (action.file) {
    await writeTargetFile(action.file);
  }
}

/**
 * Этап 6: настройка установленной системы — hostname, локали/раскладка/timezone
 * (debconf-пресеты, P6.1), пользователи и sudo, SSH-ключи (P6.3), сеть, GRUB
 * (BIOS/UEFI) с os-prober по умолчанию выключенным (P6.2). Все шаги идемпотентны.
 */
export const configureSystemStage: InstallStage = {
  id: "configure",
  title: "Настройка системы",
  async run(ctx: InstallContext): Promise<void> {
    const { config, interactive } = ctx;
    const firmware = await detectFirmware();

    const plan: PlannedAction[] = [
      ...(await planHostname(config)),
      ...(await planDebconfPresets(config, firmware)),
      ...(await planSystemPackages(config, firmware)),
      ...(await planLocale(config)),
      ...(await planKeyboard(config)),
      ...(await planTimezone(config)),
      ...(await planRootPassword(config)),
      ...(await planUsers(config)),
      ...(await planNetwork(config)),
      ...(await planBootloader(config, firmware)),
    ];

    if (plan.length === 0) {
      log.info("Система уже настроена — шаги этапа пропущены.");
      return;
    }

    log.info("План (dry-run):");
    printPlan(plan);

    if (interactive) {
      const confirmed = await confirm({
        message: "Применить настройки системы (локали, пользователи, сеть, GRUB)?",
        initialValue: false,
      });
      if (!confirmed) {
        throw new CancelledError("Установка отменена: настройка системы не подтверждена");
      }
    }

    for (const action of plan) {
      await runAction(action);
    }

    log.success("Система настроена");
  },
};

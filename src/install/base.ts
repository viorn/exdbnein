import { log } from "@clack/prompts";
import {
  type PlannedAction,
  planAptUpdate,
  planChrootMounts,
  planDebootstrap,
  planFstab,
  planKernelInstall,
  planResolvConf,
  sourcesListContent,
  writeTargetFile,
} from "../system/base.ts";
import { TARGET_ROOT } from "../system/chroot.ts";
import { detectFirmware } from "../system/environment.ts";
import { hasCommand } from "../system/exec.ts";
import { generateFstab } from "../system/fstab.ts";
import { runLong } from "../system/run.ts";
import { CancelledError } from "../ui/errors.ts";
import { confirm } from "../ui/prompts.ts";
import type { InstallContext, InstallStage } from "./index.ts";

/** Возможные расположения ключей архива Debian (P5.1). */
const KEYRING_PATHS = [
  "/usr/share/keyrings/debian-archive-keyring.gpg",
  "/usr/share/debian-archive-keyring.gpg",
];

/**
 * P5.1: в LiveCD обязаны быть debootstrap и ключи архива; в офлайне —
 * понятный отказ, а не падение посреди установки.
 */
async function preflight(): Promise<void> {
  if (!(await hasCommand("debootstrap"))) {
    throw new Error("debootstrap не найден — он должен быть предустановлен в LiveCD (см. этап 8)");
  }
  const keyrings = await Promise.all(KEYRING_PATHS.map((path) => Bun.file(path).exists()));
  if (!keyrings.some(Boolean)) {
    throw new Error(
      "debian-archive-keyring не найден — установите пакет debian-archive-keyring " +
        "в LiveCD (P5.1)",
    );
  }
}

/** Печатает план действий (dry-run, ничего не выполняется). */
function printPlan(plan: PlannedAction[]): void {
  for (const action of plan) {
    if (action.argv) {
      log.message(`  ${action.argv.join(" ")}`);
    } else if (action.file) {
      log.message(`  ${action.file.path} ← ${action.description}`);
    } else {
      log.message(`  ${action.description}`);
    }
  }
}

/** Выполняет одно действие плана: команду, запись файла или генерацию fstab. */
async function runAction(action: PlannedAction): Promise<void> {
  if (action.argv) {
    await runLong(action.argv, { label: action.description, timeoutMs: action.timeoutMs });
  } else if (action.file) {
    await writeTargetFile(action.file);
  } else if (action.generateFstab) {
    const content = await generateFstab(TARGET_ROOT);
    await writeTargetFile({ path: `${TARGET_ROOT}/etc/fstab`, content, mode: "0644" });
  }
}

/**
 * Этап 5: установка минимальной Debian-системы в /mnt — debootstrap, chroot-монтирования,
 * sources.list, ядро и firmware, fstab по UUID. Все шаги идемпотентны: повторный вход
 * поверх готовой базы не ломает установленное.
 */
export const installBaseStage: InstallStage = {
  id: "base",
  title: "Установка базовой системы",
  async run(ctx: InstallContext): Promise<void> {
    const { config, interactive } = ctx;

    await preflight();
    const firmware = await detectFirmware();

    const plan: PlannedAction[] = [
      ...(await planDebootstrap(config)),
      ...(await planChrootMounts(firmware)),
      ...(await planResolvConf()),
      {
        description: "Записать /etc/apt/sources.list",
        file: {
          path: `${TARGET_ROOT}/etc/apt/sources.list`,
          content: sourcesListContent(config.mirror),
          mode: "0644",
        },
      },
      ...(await planAptUpdate()),
      ...(await planKernelInstall()),
      ...(await planFstab()),
    ];

    if (plan.length === 0) {
      log.info("Базовая система уже установлена — шаги этапа пропущены.");
      return;
    }

    log.info("План (dry-run):");
    printPlan(plan);

    if (interactive) {
      const confirmed = await confirm({
        message: "Выполнить установку базовой системы? Это займёт несколько минут",
        initialValue: false,
      });
      if (!confirmed) {
        throw new CancelledError("Установка отменена: базовая система не установлена");
      }
    }

    for (const action of plan) {
      await runAction(action);
    }

    log.success("Базовая система установлена");
  },
};

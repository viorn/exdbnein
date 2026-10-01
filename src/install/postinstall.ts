import { log } from "@clack/prompts";
import type { MergedProfiles, Profile } from "../profiles/index.ts";
import { loadProfiles, resolveProfiles } from "../profiles/index.ts";
import { writeTargetFile } from "../system/base.ts";
import { inChroot } from "../system/chroot.ts";
import {
  markCommandsApplied,
  pendingCommands,
  planCleanup,
  planProfileFiles,
  planProfilePackages,
  planProfileServices,
  readAppliedCommands,
} from "../system/postinstall.ts";
import { runLong } from "../system/run.ts";
import { CancelledError } from "../ui/errors.ts";
import { confirm } from "../ui/prompts.ts";
import type { InstallContext, InstallStage } from "./index.ts";

/** Действие плана этапа 7: команда, файл или запись с маркером применённой команды. */
interface PostInstallAction {
  description: string;
  argv?: string[];
  file?: { path: string; content: string; mode?: string };
  /** Команда профиля, помечается применённой после успеха (идемпотентность). */
  commandKey?: string;
  /** Ошибка не прерывает установку (optional-команды профилей). */
  optional?: boolean;
  timeoutMs?: number;
}

/** Загружает и резолвит выбранные профили; при ошибке — понятный отказ. */
async function resolveSelected(dir: string, names: string[]): Promise<MergedProfiles> {
  if (names.length === 0) return { packages: [], services: [], commands: [], files: [] };
  let profiles: Map<string, Profile>;
  try {
    profiles = await loadProfiles(dir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Не удалось загрузить профили из ${dir}: ${message}`);
  }
  try {
    return resolveProfiles(names, profiles);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Ошибка разрешения профилей: ${message}`);
  }
}

/** План этапа 7: пакеты → сервисы → файлы → команды → очистка. */
async function buildPlan(merged: MergedProfiles): Promise<PostInstallAction[]> {
  const applied = await readAppliedCommands();
  const pending = pendingCommands(merged.commands, applied);

  return [
    ...(await planProfilePackages(merged)),
    ...(await planProfileServices(merged)),
    ...(await planProfileFiles(merged)),
    ...pending.map((command) => ({
      description: command.description ?? `Команда профиля: ${command.cmd}`,
      argv: inChroot(["sh", "-c", command.cmd]),
      commandKey: command.cmd,
      optional: command.optional ?? false,
    })),
    ...(await planCleanup()),
  ];
}

/** Печатает план (dry-run, ничего не выполняется). */
function printPlan(plan: PostInstallAction[]): void {
  for (const action of plan) {
    if (action.argv) {
      log.message(`  ${action.argv.join(" ")}${action.optional ? "  (optional)" : ""}`);
    } else if (action.file) {
      log.message(`  ${action.file.path} ← ${action.description}`);
    }
  }
}

/** Выполняет одно действие; optional-ошибки превращаются в предупреждения. */
async function runAction(action: PostInstallAction): Promise<void> {
  if (action.argv) {
    const result = await runLong(action.argv, {
      label: action.description,
      timeoutMs: action.timeoutMs,
      allowFailure: action.optional,
    });
    if (action.optional && result.code !== 0) {
      log.warn(`Пропущено (optional): ${action.description} — код ${result.code}`);
      return;
    }
  } else if (action.file) {
    await writeTargetFile(action.file);
  }
  if (action.commandKey) {
    await markCommandsApplied([action.commandKey]);
  }
}

/**
 * Этап 7: применение профилей (пакеты, сервисы, команды в chroot, файлы с префиксом
 * целевого корня), очистка apt и временных файлов. Все под-шаги идемпотентны:
 * повторный вход поверх готовой системы пропускает выполненное (P7.2).
 */
export const postInstallStage: InstallStage = {
  id: "postinstall",
  title: "Пост-установка",
  async run(ctx: InstallContext): Promise<void> {
    const { config, interactive, profilesDir } = ctx;

    const merged = await resolveSelected(profilesDir, config.profiles);
    const plan = await buildPlan(merged);

    if (plan.length === 0) {
      log.info("Пост-установка не требуется — профили уже применены.");
      return;
    }

    log.info("План (dry-run):");
    printPlan(plan);

    if (interactive) {
      const confirmed = await confirm({
        message: "Применить профили и выполнить очистку?",
        initialValue: true,
      });
      if (!confirmed)
        throw new CancelledError("Установка отменена: пост-установка не подтверждена");
    }

    for (const action of plan) {
      await runAction(action);
    }

    log.success("Профили применены, система очищена");
  },
};

import { log } from "@clack/prompts";
import type { InstallConfig } from "../config/types.ts";
import { TARGET_ROOT } from "../system/chroot.ts";
import { swapoffTarget, unmountTarget } from "../system/finalize.ts";
import { InstallLogger } from "../system/log.ts";
import { installBaseStage } from "./base.ts";
import { configureSystemStage } from "./configure.ts";
import { prepareDiskStage } from "./disk.ts";
import { finishInstall } from "./finish.ts";
import { postInstallStage } from "./postinstall.ts";

export interface InstallContext {
  config: InstallConfig;
  /** Запрашивать подтверждения (интерактивный режим). */
  interactive: boolean;
  /** Каталог с YAML-профилями (для применения на этапе 7). */
  profilesDir: string;
  /** Журнал шагов фазы B (P7.2) — отчёт при ошибке и повторный вход. */
  logger: InstallLogger;
}

export interface InstallStage {
  id: string;
  title: string;
  run: (ctx: InstallContext) => Promise<void>;
}

/** Стадии фазы B в порядке применения. */
const STAGES: InstallStage[] = [
  prepareDiskStage,
  installBaseStage,
  configureSystemStage,
  postInstallStage,
];

export interface InstallOptions {
  interactive: boolean;
  profilesDir: string;
}

/** Журнал пишется в целевую систему и на LiveCD-носитель (best-effort). */
function installLogFiles(): string[] {
  return [`${TARGET_ROOT}/var/log/exdbnein/install.log`, "/var/log/exdbnein/install.log"];
}

/**
 * Фаза B: применяет готовый конфиг к системе. Линейный раннер без возвратов —
 * шаги визарда не используются, вопросы задаются только на подтверждение.
 * Ошибка логируется и пробрасывается; диск размонтируется всегда (finally, P7.3).
 */
export async function runInstall(config: InstallConfig, options: InstallOptions): Promise<void> {
  const ctx: InstallContext = {
    config,
    interactive: options.interactive,
    profilesDir: options.profilesDir,
    logger: new InstallLogger(installLogFiles()),
  };

  try {
    for (const stage of STAGES) {
      ctx.logger.step(stage.id, stage.title);
      log.step(stage.title);
      await stage.run(ctx);
      ctx.logger.ok(`стадия ${stage.id} завершена`);
    }
    // Целевой корень ещё примонтирован — журнал успевает попасть и в установленную систему.
    await ctx.logger.flush();
    await finishInstall(ctx);
  } catch (error) {
    ctx.logger.error(error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    // P7.3: очистка при ошибке — размонтирование и swapoff даже в unhappy-path.
    try {
      await unmountTarget();
      const extra = config.disk.swapPartition ? [config.disk.swapPartition] : [];
      await swapoffTarget(config.disk.device, extra);
    } catch {
      // лог уже записан; повторная попытка — при следующем запуске (идемпотентный вход)
    }
    await ctx.logger.flush();
  }
}

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
  /** Ask for confirmations (interactive mode). */
  interactive: boolean;
  /** Directory with YAML profiles (applied at stage 7). */
  profilesDir: string;
  /** Phase B step log (P7.2) — error report and re-entry. */
  logger: InstallLogger;
}

export interface InstallStage {
  id: string;
  title: string;
  run: (ctx: InstallContext) => Promise<void>;
}

/** Phase B stages in application order. */
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

/** The log is written into the target system and onto the LiveCD medium (best-effort). */
function installLogFiles(): string[] {
  return [`${TARGET_ROOT}/var/log/exdbnein/install.log`, "/var/log/exdbnein/install.log"];
}

/**
 * Phase B: applies the ready config to the system. A linear runner without returns —
 * wizard steps are not used, questions are only asked for confirmation.
 * Errors are logged and rethrown; the disk is always unmounted (finally, P7.3).
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
      ctx.logger.ok(`stage ${stage.id} completed`);
    }
    // The target root is still mounted — the log also makes it into the installed system.
    await ctx.logger.flush();
    await finishInstall(ctx);
  } catch (error) {
    ctx.logger.error(error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    // P7.3: cleanup on error — unmounting and swapoff even in the unhappy path.
    try {
      await unmountTarget();
      const extra = config.disk.swapPartition ? [config.disk.swapPartition] : [];
      await swapoffTarget(config.disk.device, extra);
    } catch {
      // the log is already written; retry happens on the next run (idempotent re-entry)
    }
    await ctx.logger.flush();
  }
}

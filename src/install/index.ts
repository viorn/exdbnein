import { log } from "@clack/prompts";
import type { InstallConfig } from "../config/types.ts";
import { installBaseStage } from "./base.ts";
import { configureSystemStage } from "./configure.ts";
import { prepareDiskStage } from "./disk.ts";

export interface InstallContext {
  config: InstallConfig;
  /** Запрашивать подтверждения (интерактивный режим). */
  interactive: boolean;
}

export interface InstallStage {
  id: string;
  title: string;
  run: (ctx: InstallContext) => Promise<void>;
}

/** Стадии фазы B в порядке применения; следующие этапы добавляют новые. */
const STAGES: InstallStage[] = [prepareDiskStage, installBaseStage, configureSystemStage];

/**
 * Фаза B: применяет готовый конфиг к системе. Линейный раннер без возвратов —
 * шаги визарда не используются, вопросы задаются только на подтверждение.
 */
export async function runInstall(
  config: InstallConfig,
  options: { interactive: boolean },
): Promise<void> {
  const ctx: InstallContext = { config, interactive: options.interactive };
  for (const stage of STAGES) {
    log.step(stage.title);
    await stage.run(ctx);
  }
}

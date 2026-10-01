import { tmpdir } from "node:os";
import { join } from "node:path";
import { cancel, log } from "@clack/prompts";
import { helpText, parseArgs } from "./cli.ts";
import { defaultConfig, loadConfig, saveConfig } from "./config/index.ts";
import type { InstallConfig } from "./config/types.ts";
import { buildSteps } from "./steps/index.ts";
import { isLiveEnvironment, isRoot, LIVE_MARKER } from "./system/environment.ts";
import { CancelledError, confirm, runWizard } from "./ui/index.ts";

/** Черновик последней сессии — чтобы краш не терял ввод. */
const DRAFT_FILE = join(tmpdir(), "exdbnein-last.json");

/** Читает черновик предыдущей сессии, если он есть и валиден. */
async function loadDraft(): Promise<InstallConfig | null> {
  try {
    if (!(await Bun.file(DRAFT_FILE).exists())) return null;
    return await loadConfig(DRAFT_FILE);
  } catch {
    return null;
  }
}

/** Загружает конфиг: файл --config, иначе черновик (с вопросом), иначе дефолты. */
async function loadOrInit(options: {
  config?: string;
  unattended: boolean;
}): Promise<InstallConfig> {
  if (options.config) {
    if (await Bun.file(options.config).exists()) return loadConfig(options.config);
    return defaultConfig();
  }

  if (!options.unattended) {
    const draft = await loadDraft();
    if (draft) {
      const restore = await confirm({
        message: "Найдена незавершённая сессия. Восстановить?",
        initialValue: true,
      });
      if (restore) return draft;
    }
  }

  return defaultConfig();
}

/** Pre-flight: безопасность перед запуском визарда (этап 3). */
async function checkEnvironment(force: boolean): Promise<void> {
  const root = await isRoot();
  if (!root) {
    throw new Error("Требуются права root — установщик изменяет систему");
  }

  const live = await isLiveEnvironment();
  if (!live && !force) {
    throw new Error(
      `Установщик запускается только внутри LiveCD (маркер ${LIVE_MARKER} не найден). ` +
        "Для разработки используйте --force.",
    );
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(helpText());
    return;
  }

  await checkEnvironment(options.force);

  const config = await loadOrInit(options);
  config.unattended = options.unattended;

  await runWizard({
    title: "exdbnein — установка Debian",
    steps: buildSteps({ profilesDir: options.profilesDir }),
    config,
    onStepDone: async (_step, current) => {
      // Черновик сохраняем всегда, --config — дополнительно.
      await saveConfig(current, DRAFT_FILE);
      if (options.config) await saveConfig(current, options.config);
    },
  });

  if (options.config) {
    await saveConfig(config, options.config);
    log.success(`Конфигурация сохранена: ${options.config}`);
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof CancelledError) {
    cancel(error.message);
    process.exit(130);
  }
  log.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

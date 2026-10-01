import { cancel, log } from "@clack/prompts";
import { helpText, parseArgs } from "./cli.ts";
import { defaultConfig, loadConfig, saveConfig } from "./config/index.ts";
import { buildSteps } from "./steps/index.ts";
import { CancelledError, runWizard } from "./ui/index.ts";

/** Загружает конфиг, если файл существует, иначе начинает с значений по умолчанию. */
async function loadOrInit(path: string) {
  if (await Bun.file(path).exists()) return loadConfig(path);
  return defaultConfig();
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(helpText());
    return;
  }

  const config = options.config ? await loadOrInit(options.config) : defaultConfig();
  config.unattended = options.unattended;

  await runWizard({
    title: "exdbnein — установка Debian",
    steps: buildSteps({ profilesDir: options.profilesDir }),
    config,
    onStepDone: async (_step, current) => {
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

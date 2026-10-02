import { tmpdir } from "node:os";
import { join } from "node:path";
import { cancel, log } from "@clack/prompts";
import { helpText, parseArgs } from "./cli.ts";
import { defaultConfig, loadConfig, saveConfig } from "./config/index.ts";
import type { InstallConfig } from "./config/types.ts";
import { runInstall } from "./install/index.ts";
import { buildSteps } from "./steps/index.ts";
import { isLiveEnvironment, isRoot, LIVE_MARKER } from "./system/environment.ts";
import { CancelledError, confirm, runWizard } from "./ui/index.ts";

/** Draft of the last session — so a crash does not lose the input. */
const DRAFT_FILE = join(tmpdir(), "exdbnein-last.json");

/** Reads the previous session draft, if it exists and is valid. */
async function loadDraft(): Promise<InstallConfig | null> {
  try {
    if (!(await Bun.file(DRAFT_FILE).exists())) return null;
    return await loadConfig(DRAFT_FILE);
  } catch {
    return null;
  }
}

/** Loads the config: --config file, otherwise the draft (with a question), otherwise defaults. */
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
        message: "Found an unfinished session. Restore it?",
        initialValue: true,
      });
      if (restore) return draft;
    }
  }

  return defaultConfig();
}

/** Pre-flight: safety before launching the wizard (stage 3). */
async function checkEnvironment(force: boolean): Promise<void> {
  const root = await isRoot();
  if (!root) {
    throw new Error("Root privileges are required — the installer modifies the system");
  }

  const live = await isLiveEnvironment();
  if (!live && !force) {
    throw new Error(
      `The installer runs only inside the LiveCD (marker ${LIVE_MARKER} not found). ` +
        "Use --force for development.",
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
    title: "exdbnein — Debian installer",
    steps: buildSteps({ profilesDir: options.profilesDir }),
    config,
    onStepDone: async (_step, current) => {
      // Always save the draft; --config is saved additionally.
      await saveConfig(current, DRAFT_FILE);
      if (options.config) await saveConfig(current, options.config);
    },
  });

  if (options.config) {
    await saveConfig(config, options.config);
    log.success(`Configuration saved: ${options.config}`);
  }

  // Phase B: applying the configuration (stages 4–7).
  await runInstall(config, {
    interactive: !config.unattended,
    profilesDir: options.profilesDir,
  });
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

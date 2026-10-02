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

/** Prints the action plan (dry-run, nothing executes). */
function printPlan(plan: PlannedAction[]): void {
  for (const action of plan) {
    if (action.argv) {
      log.message(`  ${action.argv.join(" ")}`);
    } else if (action.file) {
      log.message(`  ${action.file.path} ← ${action.description}`);
    }
  }
}

/** Runs one plan action: a command or a file write into the target root. */
async function runAction(action: PlannedAction): Promise<void> {
  if (action.argv) {
    await runLong(action.argv, { label: action.description });
  } else if (action.file) {
    await writeTargetFile(action.file);
  }
}

/**
 * Stage 6: configuring the installed system — hostname, locales/layout/timezone
 * (debconf presets, P6.1), users and sudo, SSH keys (P6.3), network, GRUB
 * (BIOS/UEFI) with os-prober disabled by default (P6.2). All steps are idempotent.
 */
export const configureSystemStage: InstallStage = {
  id: "configure",
  title: "System configuration",
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
      log.info("System is already configured — stage steps skipped.");
      return;
    }

    log.info("Plan (dry-run):");
    printPlan(plan);

    if (interactive) {
      const confirmed = await confirm({
        message: "Apply system settings (locales, users, network, GRUB)?",
        initialValue: false,
      });
      if (!confirmed) {
        throw new CancelledError("Installation cancelled: system settings not confirmed");
      }
    }

    for (const action of plan) {
      await runAction(action);
    }

    log.success("System configured");
  },
};

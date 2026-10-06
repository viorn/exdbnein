import { log, spinner } from "@clack/prompts";
import {
  type CommandPhase,
  checkPlanTools,
  diskPreparationState,
  type PlannedCommand,
  planPartitionCommands,
  recoverSubvolumeMounts,
} from "../system/disks.ts";
import { detectFirmware } from "../system/environment.ts";
import { exec } from "../system/exec.ts";
import { CancelledError } from "../ui/errors.ts";
import { confirm } from "../ui/prompts.ts";
import type { InstallContext, InstallStage } from "./index.ts";

const PHASE_TITLE: Record<CommandPhase, string> = {
  partition: "Partitioning",
  format: "Formatting",
  mount: "Mounting",
};

/** Partitioning and formatting destroy data — this is the irreversible part of the plan. */
function isDestructive(commands: PlannedCommand[]): boolean {
  return commands.some((command) => command.phase === "partition" || command.phase === "format");
}

/** Prints the command plan by phases (dry-run, nothing executes). */
function printPlan(commands: PlannedCommand[]): void {
  let phase: CommandPhase | null = null;
  for (const command of commands) {
    if (command.phase !== phase) {
      log.step(PHASE_TITLE[command.phase]);
      phase = command.phase;
    }
    log.message(`  ${command.argv.join(" ")}`);
  }
}

/** Runs the plan commands sequentially, directly (no shell). */
async function runCommands(commands: PlannedCommand[], label: string): Promise<void> {
  const progress = spinner();
  progress.start(label);
  try {
    for (const command of commands) {
      await exec(command.argv);
    }
    progress.stop("Done");
  } catch (error) {
    progress.stop("Error");
    throw error;
  }
}

/**
 * Stage 4: preparing the target disk — partition table, FS, subvolumes,
 * mounting into /mnt. The first irreversible point of the installation.
 */
export const prepareDiskStage: InstallStage = {
  id: "disk",
  title: "Disk preparation",
  async run(ctx: InstallContext): Promise<void> {
    const { config, interactive } = ctx;
    const device = config.disk.device;

    const state = await diskPreparationState(config);

    // Idempotency: re-entering over an already partitioned disk does not wipe it.
    if (state === "ready") {
      log.info(`Disk ${device} is already partitioned and mounted in /mnt — partitioning skipped.`);
      return;
    }

    // Partial preparation (root mounted, subvolumes missing): restore the mounts
    // instead of re-partitioning — the disk already holds data.
    if (state === "partial") {
      const recovery = await recoverSubvolumeMounts(config);
      if (recovery.length === 0) {
        log.info(`Disk ${device} is already mounted in /mnt — partitioning skipped.`);
        return;
      }
      log.warn(`Disk ${device} is partially prepared: missing subvolume mounts.`);
      log.info("Command plan (dry-run):");
      printPlan(recovery);

      if (interactive) {
        const confirmed = await confirm({
          message: `Mount the missing btrfs subvolumes of ${device}?`,
          initialValue: true,
        });
        if (!confirmed)
          throw new CancelledError("Installation cancelled: subvolume recovery not confirmed");
      }

      await runCommands(recovery, "Mounting btrfs subvolumes...");
      log.success("Subvolume mounts restored");
      return;
    }

    const firmware = await detectFirmware();
    const commands = planPartitionCommands(config, firmware);

    // Fail fast BEFORE the destructive confirmation: without the fs tools the
    // plan would abort right after wiping the disk. E.g. mkfs.ext4 is provided
    // by e2fsprogs, which was missing from the LiveCD (btrfs worked — btrfs-progs
    // was there, ext4 crashed on the first formatting command).
    const missingTools = await checkPlanTools(commands);
    if (missingTools.length > 0) {
      throw new Error(
        `Required filesystem tools are missing in the LiveCD: ${missingTools.join(", ")}. ` +
          "Add the corresponding packages to livecd/packages.txt " +
          "(e.g. e2fsprogs provides mkfs.ext4) and rebuild the ISO.",
      );
    }

    const destructive = isDestructive(commands);

    if (destructive) {
      log.warn(`Data on disk ${device} will be wiped.`);
    }
    log.info("Command plan (dry-run):");
    printPlan(commands);

    if (interactive) {
      const confirmed = await confirm({
        message: destructive
          ? `Run partitioning? Data on ${device} will be destroyed`
          : `Mount partitions of disk ${device}?`,
        initialValue: false,
      });
      if (!confirmed)
        throw new CancelledError("Installation cancelled: partitioning not confirmed");
    }

    await runCommands(commands, destructive ? "Partitioning disk..." : "Mounting partitions...");
    log.success("Disk prepared");
  },
};

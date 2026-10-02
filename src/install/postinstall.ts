import { log } from "@clack/prompts";
import type { MergedProfiles, Profile } from "../profiles/index.ts";
import { loadProfilesOrDefault, resolveProfiles } from "../profiles/index.ts";
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

/** Stage 7 plan action: command, file or a record with the applied command marker. */
interface PostInstallAction {
  description: string;
  argv?: string[];
  file?: { path: string; content: string; mode?: string };
  /** Profile command, marked as applied after success (idempotency). */
  commandKey?: string;
  /** A failure does not interrupt the installation (optional profile commands). */
  optional?: boolean;
  timeoutMs?: number;
}

/** Loads and resolves the selected profiles; on error — a clear refusal. */
async function resolveSelected(dir: string, names: string[]): Promise<MergedProfiles> {
  if (names.length === 0) return { packages: [], services: [], commands: [], files: [] };
  let profiles: Map<string, Profile>;
  try {
    // P8.1: the profiles/ directory may be absent in the LiveCD — use the embedded ones.
    profiles = await loadProfilesOrDefault(dir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load profiles from ${dir}: ${message}`);
  }
  try {
    return resolveProfiles(names, profiles);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to resolve profiles: ${message}`);
  }
}

/** Stage 7 plan: packages → services → files → commands → cleanup. */
async function buildPlan(merged: MergedProfiles): Promise<PostInstallAction[]> {
  const applied = await readAppliedCommands();
  const pending = pendingCommands(merged.commands, applied);

  return [
    ...(await planProfilePackages(merged)),
    ...(await planProfileServices(merged)),
    ...(await planProfileFiles(merged)),
    ...pending.map((command) => ({
      description: command.description ?? `Profile command: ${command.cmd}`,
      argv: inChroot(["sh", "-c", command.cmd]),
      commandKey: command.cmd,
      optional: command.optional ?? false,
    })),
    ...(await planCleanup()),
  ];
}

/** Prints the plan (dry-run, nothing executes). */
function printPlan(plan: PostInstallAction[]): void {
  for (const action of plan) {
    if (action.argv) {
      log.message(`  ${action.argv.join(" ")}${action.optional ? "  (optional)" : ""}`);
    } else if (action.file) {
      log.message(`  ${action.file.path} ← ${action.description}`);
    }
  }
}

/** Runs one action; optional failures become warnings. */
async function runAction(action: PostInstallAction): Promise<void> {
  if (action.argv) {
    const result = await runLong(action.argv, {
      label: action.description,
      timeoutMs: action.timeoutMs,
      allowFailure: action.optional,
    });
    if (action.optional && result.code !== 0) {
      log.warn(`Skipped (optional): ${action.description} — code ${result.code}`);
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
 * Stage 7: applying profiles (packages, services, commands in chroot, files with
 * the target root prefix), cleaning apt and temp files. All sub-steps are idempotent:
 * re-entering over a ready system skips what was done (P7.2).
 */
export const postInstallStage: InstallStage = {
  id: "postinstall",
  title: "Post-install",
  async run(ctx: InstallContext): Promise<void> {
    const { config, interactive, profilesDir } = ctx;

    const merged = await resolveSelected(profilesDir, config.profiles);
    const plan = await buildPlan(merged);

    if (plan.length === 0) {
      log.info("Post-install not required — profiles already applied.");
      return;
    }

    log.info("Plan (dry-run):");
    printPlan(plan);

    if (interactive) {
      const confirmed = await confirm({
        message: "Apply profiles and clean up?",
        initialValue: true,
      });
      if (!confirmed)
        throw new CancelledError("Installation cancelled: post-install not confirmed");
    }

    for (const action of plan) {
      await runAction(action);
    }

    log.success("Profiles applied, system cleaned");
  },
};

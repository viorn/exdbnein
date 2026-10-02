import { log } from "@clack/prompts";
import {
  type PlannedAction,
  planAptUpdate,
  planChrootMounts,
  planDebootstrap,
  planFstab,
  planKernelInstall,
  planResolvConf,
  sourcesListContent,
  writeTargetFile,
} from "../system/base.ts";
import { TARGET_ROOT } from "../system/chroot.ts";
import { detectFirmware } from "../system/environment.ts";
import { hasCommand } from "../system/exec.ts";
import { generateFstab } from "../system/fstab.ts";
import { runLong } from "../system/run.ts";
import { CancelledError } from "../ui/errors.ts";
import { confirm } from "../ui/prompts.ts";
import type { InstallContext, InstallStage } from "./index.ts";

/** Possible locations of the Debian archive keys (P5.1). */
const KEYRING_PATHS = [
  "/usr/share/keyrings/debian-archive-keyring.gpg",
  "/usr/share/debian-archive-keyring.gpg",
];

/**
 * P5.1: debootstrap and the archive keys must exist in the LiveCD; offline —
 * a clear refusal instead of a crash in the middle of the installation.
 */
async function preflight(): Promise<void> {
  if (!(await hasCommand("debootstrap"))) {
    throw new Error("debootstrap not found — it must be preinstalled in the LiveCD (see stage 8)");
  }
  const keyrings = await Promise.all(KEYRING_PATHS.map((path) => Bun.file(path).exists()));
  if (!keyrings.some(Boolean)) {
    throw new Error(
      "debian-archive-keyring not found — install the debian-archive-keyring package " +
        "in the LiveCD (P5.1)",
    );
  }
}

/** Prints the action plan (dry-run, nothing executes). */
function printPlan(plan: PlannedAction[]): void {
  for (const action of plan) {
    if (action.argv) {
      log.message(`  ${action.argv.join(" ")}`);
    } else if (action.file) {
      log.message(`  ${action.file.path} ← ${action.description}`);
    } else {
      log.message(`  ${action.description}`);
    }
  }
}

/** Runs one plan action: a command, file write or fstab generation. */
async function runAction(action: PlannedAction): Promise<void> {
  if (action.argv) {
    await runLong(action.argv, { label: action.description, timeoutMs: action.timeoutMs });
  } else if (action.file) {
    await writeTargetFile(action.file);
  } else if (action.generateFstab) {
    const content = await generateFstab(TARGET_ROOT);
    await writeTargetFile({ path: `${TARGET_ROOT}/etc/fstab`, content, mode: "0644" });
  }
}

/**
 * Stage 5: installing a minimal Debian system into /mnt — debootstrap, chroot mounts,
 * sources.list, kernel and firmware, fstab by UUID. All steps are idempotent:
 * re-entering over a ready base does not break what is installed.
 */
export const installBaseStage: InstallStage = {
  id: "base",
  title: "Base system installation",
  async run(ctx: InstallContext): Promise<void> {
    const { config, interactive } = ctx;

    await preflight();
    const firmware = await detectFirmware();

    const plan: PlannedAction[] = [
      ...(await planDebootstrap(config)),
      ...(await planChrootMounts(firmware)),
      ...(await planResolvConf()),
      {
        description: "Write /etc/apt/sources.list",
        file: {
          path: `${TARGET_ROOT}/etc/apt/sources.list`,
          content: sourcesListContent(config.mirror),
          mode: "0644",
        },
      },
      ...(await planAptUpdate()),
      ...(await planKernelInstall()),
      ...(await planFstab()),
    ];

    if (plan.length === 0) {
      log.info("Base system is already installed — stage steps skipped.");
      return;
    }

    log.info("Plan (dry-run):");
    printPlan(plan);

    if (interactive) {
      const confirmed = await confirm({
        message: "Run base system installation? This will take a few minutes",
        initialValue: false,
      });
      if (!confirmed) {
        throw new CancelledError("Installation cancelled: base system not installed");
      }
    }

    for (const action of plan) {
      await runAction(action);
    }

    log.success("Base system installed");
  },
};

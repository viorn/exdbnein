import type { MergedProfiles, ProfileFile } from "../profiles/types.ts";
import { aptGet, isPackageInstalled, type PlannedAction, writeTargetFile } from "./base.ts";
import { inChroot, TARGET_ROOT } from "./chroot.ts";
import { isServiceEnabled } from "./configure.ts";

/**
 * Applying profiles (stage 7). Two path namespaces (P7.1):
 * - files are written via the writer — the profile path gets the target root prefix
 *   (profileTargetPath: `/etc/x` → `/mnt/etc/x`);
 * - commands run in the chroot and see the target system directly (`/etc/x`).
 */

/** Converts a profile file path into the installer host path (writer namespace). */
export function profileTargetPath(profilePath: string, root = TARGET_ROOT): string {
  const normalized = profilePath.startsWith("/") ? profilePath : `/${profilePath}`;
  return `${root}${normalized}`;
}

/** The profile file content already matches the file in the target system. */
export async function isProfileFileSame(file: ProfileFile, root = TARGET_ROOT): Promise<boolean> {
  const current = await Bun.file(profileTargetPath(file.path, root))
    .text()
    .catch(() => null);
  return current === file.content;
}

/** Missing profile packages — one apt-get install (idempotent via dpkg statuses). */
export async function planProfilePackages(merged: MergedProfiles): Promise<PlannedAction[]> {
  const toInstall: string[] = [];
  for (const pkg of merged.packages) {
    if (!(await isPackageInstalled(pkg))) toInstall.push(pkg);
  }
  if (toInstall.length === 0) return [];
  return [
    {
      description: `Install profile packages: ${toInstall.join(", ")}`,
      argv: aptGet("install", "--no-install-recommends", ...toInstall),
    },
  ];
}

/** Missing profile services — one systemctl enable (in chroot). */
export async function planProfileServices(merged: MergedProfiles): Promise<PlannedAction[]> {
  const toEnable: string[] = [];
  for (const service of merged.services) {
    if (!(await isServiceEnabled(service))) toEnable.push(service);
  }
  if (toEnable.length === 0) return [];
  return [
    {
      description: `Enable profile services: ${toEnable.join(", ")}`,
      argv: inChroot(["systemctl", "enable", ...toEnable]),
    },
  ];
}

/** Profile files — only if the content differs from the current one. */
export async function planProfileFiles(
  merged: MergedProfiles,
  root = TARGET_ROOT,
): Promise<PlannedAction[]> {
  const actions: PlannedAction[] = [];
  for (const file of merged.files) {
    if (await isProfileFileSame(file, root)) continue;
    actions.push({
      description: `Write profile file ${file.path}`,
      file: {
        path: profileTargetPath(file.path, root),
        content: file.content,
        mode: file.mode || "0644",
      },
    });
  }
  return actions;
}

// ---- applied commands marker (idempotent re-entry, P7.2) ------------------------

/** State file inside the target system; persists between runs. */
export const APPLIED_STATE_PATH = "/var/lib/exdbnein/applied.json";

interface AppliedState {
  /** Commands that completed successfully (not run again). */
  commands: string[];
}

/** Reads the applied commands list; an empty set when the file is absent. */
export async function readAppliedCommands(root = TARGET_ROOT): Promise<Set<string>> {
  try {
    const parsed = JSON.parse(
      await Bun.file(`${root}${APPLIED_STATE_PATH}`).text(),
    ) as AppliedState;
    return new Set(parsed.commands ?? []);
  } catch {
    return new Set();
  }
}

/** Commands still pending (not marked as applied). */
export function pendingCommands(
  commands: MergedProfiles["commands"],
  applied: ReadonlySet<string>,
): MergedProfiles["commands"] {
  return commands.filter((command) => !applied.has(command.cmd));
}

/** Marks commands as applied (after a successful run). */
export async function markCommandsApplied(commands: string[], root = TARGET_ROOT): Promise<void> {
  const applied = await readAppliedCommands(root);
  for (const command of commands) applied.add(command);
  const state: AppliedState = { commands: [...applied] };
  await writeTargetFile({
    path: `${root}${APPLIED_STATE_PATH}`,
    content: JSON.stringify(state, null, 2),
    mode: "0600",
  });
}

// ---- cleanup --------------------------------------------------------------------

/** Cleanup after applying profiles: apt cache and installer temp files. */
export async function planCleanup(root = TARGET_ROOT): Promise<PlannedAction[]> {
  return [
    {
      description: "Clean package cache (apt-get clean)",
      argv: aptGet("clean"),
    },
    {
      description: "Remove exdbnein temporary files from /tmp",
      argv: ["sh", "-c", `rm -rf ${root}/tmp/exdbnein-*`],
    },
  ];
}

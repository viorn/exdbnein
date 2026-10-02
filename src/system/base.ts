import { readdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { InstallConfig } from "../config/types.ts";
import { chrootMounts, inChroot, isMounted, TARGET_ROOT } from "./chroot.ts";
import type { Firmware } from "./environment.ts";
import { exec } from "./exec.ts";

/** Plan action of phase B: command, file write or fstab generation. */
export interface PlannedAction {
  description: string;
  /** Command to run in a separate process group (see run.ts). */
  argv?: string[];
  /** File in the target root. */
  file?: { path: string; content: string; mode?: string };
  /** Generate /etc/fstab from the actual mounts. */
  generateFstab?: boolean;
  /** Time limit for argv (default — 30 minutes). */
  timeoutMs?: number;
  /** A failure does not interrupt the installation (optional profile commands). */
  optional?: boolean;
}

/** Codename of stable Debian for debootstrap/apt. */
export const DEBOOTSTRAP_SUITE = "stable";
/** Debian archive components (12+, incl. non-free-firmware); for debootstrap --components=. */
export const APT_COMPONENTS = "main,contrib,non-free,non-free-firmware";
/** The same components for sources.list (space-separated). */
const SOURCES_COMPONENTS = "main contrib non-free non-free-firmware";

/** Limits for long steps. */
export const APT_UPDATE_TIMEOUT_MS = 10 * 60 * 1000;

/** debootstrap command: minimal stable base into the target root with a mirror. */
export function debootstrapCommand(config: InstallConfig): string[] {
  return [
    "debootstrap",
    "--arch=amd64",
    "--variant=minbase",
    `--components=${APT_COMPONENTS}`,
    DEBOOTSTRAP_SUITE,
    TARGET_ROOT,
    config.mirror,
  ];
}

/** sources.list of the target system: stable + updates + security. */
export function sourcesListContent(mirror: string): string {
  const mirrorBase = mirror.replace(/\/+$/, "");
  return [
    `deb ${mirrorBase} stable ${SOURCES_COMPONENTS}`,
    `deb ${mirrorBase} stable-updates ${SOURCES_COMPONENTS}`,
    `deb http://security.debian.org/debian-security stable-security ${SOURCES_COMPONENTS}`,
    "",
  ].join("\n");
}

/** The base system is already installed: Debian metadata exists in the target root. */
export async function isBaseInstalled(root = TARGET_ROOT): Promise<boolean> {
  return Bun.file(`${root}/etc/debian_version`).exists();
}

/** A package is installed in the target root (dpkg-query in chroot). */
export async function isPackageInstalled(pkg: string, root = TARGET_ROOT): Promise<boolean> {
  const result = await exec(inChroot(["dpkg-query", "-W", `-f=\${Status}`, pkg], root), {
    allowFailure: true,
  });
  return result.code === 0 && result.stdout.trim() === "install ok installed";
}

/** Whether the directory has any files (idempotency of apt lists). */
async function dirHasFiles(dir: string): Promise<boolean> {
  try {
    return (await readdir(dir)).length > 0;
  } catch {
    return false;
  }
}

/** Writes a file into the target system (creates directories, sets permissions). */
export async function writeTargetFile(file: {
  path: string;
  content: string;
  mode?: string;
}): Promise<void> {
  await exec(["mkdir", "-p", dirname(file.path)]);
  await Bun.write(file.path, file.content);
  if (file.mode) {
    await exec(["chmod", file.mode, file.path]);
  }
}

// ---- Stage 5 plan (idempotent) ------------------------------------------------

/** debootstrap — only if the base is not installed yet. */
export async function planDebootstrap(config: InstallConfig): Promise<PlannedAction[]> {
  if (await isBaseInstalled()) return [];
  return [
    {
      description: `debootstrap ${DEBOOTSTRAP_SUITE} into ${TARGET_ROOT} (${config.mirror})`,
      argv: debootstrapCommand(config),
    },
  ];
}

/** Pseudo-FS mounts — only those not mounted yet. */
export async function planChrootMounts(firmware: Firmware): Promise<PlannedAction[]> {
  const actions: PlannedAction[] = [];
  for (const mount of chrootMounts(firmware)) {
    if (await isMounted(`${TARGET_ROOT}${mount.target}`)) continue;
    actions.push({ description: mount.description, argv: mount.argv });
  }
  return actions;
}

/** Copies the host resolv.conf — without DNS apt in the chroot cannot see the mirror. */
export async function planResolvConf(): Promise<PlannedAction[]> {
  const content = await Bun.file("/etc/resolv.conf")
    .text()
    .catch(() => "");
  if (!content.trim()) return [];
  return [
    {
      description: "Copy /etc/resolv.conf into the target system",
      file: { path: `${TARGET_ROOT}/etc/resolv.conf`, content, mode: "0644" },
    },
  ];
}

/** apt-get in chroot with non-interactive debconf (P6.1) and -y. */
export function aptGet(...args: string[]): string[] {
  return inChroot(["env", "DEBIAN_FRONTEND=noninteractive", "apt-get", "-y", ...args]);
}

/** apt-get update — only if the package lists are not downloaded yet. */
export async function planAptUpdate(): Promise<PlannedAction[]> {
  if (await dirHasFiles(`${TARGET_ROOT}/var/lib/apt/lists`)) return [];
  return [
    {
      description: "Update package lists (apt-get update)",
      argv: aptGet("update"),
      timeoutMs: APT_UPDATE_TIMEOUT_MS,
    },
  ];
}

/** The root filesystem of the target system; the keep layout may override it. */
export function isBtrfsRoot(config: InstallConfig): boolean {
  if (config.disk.layout === "keep" && config.disk.rootPartitionFstype) {
    return config.disk.rootPartitionFstype === "btrfs";
  }
  return config.disk.filesystem === "btrfs";
}

/**
 * Packages without which the installed system does not boot. minbase + --no-install-recommends
 * do not guarantee /sbin/init (systemd-sysv), and a btrfs root needs the user-space tools
 * (fsck.btrfs/mount.btrfs) to be present BEFORE the initramfs is generated (P5.4).
 */
export function essentialBasePackages(config: InstallConfig): string[] {
  const packages = ["systemd-sysv"];
  if (isBtrfsRoot(config)) packages.push("btrfs-progs");
  return packages;
}

/** A kernel is already installed in the target system (/boot/vmlinuz-*). */
async function hasInstalledKernel(root = TARGET_ROOT): Promise<boolean> {
  try {
    const entries = await readdir(`${root}/boot`);
    return entries.some((name) => name.startsWith("vmlinuz-"));
  } catch {
    return false;
  }
}

/**
 * Essential boot packages — installed BEFORE the kernel, so the initramfs built by the
 * kernel postinst already contains systemd-sysv and the btrfs tools. Re-entering over a
 * broken base (kernel present) triggers update-initramfs so the fix also heals old installs.
 */
export async function planEssentialPackages(config: InstallConfig): Promise<PlannedAction[]> {
  const packages = essentialBasePackages(config);
  const installed = await Promise.all(packages.map((pkg) => isPackageInstalled(pkg)));
  if (installed.every(Boolean)) return [];

  const actions: PlannedAction[] = [
    {
      description: `Install essential boot packages: ${packages.join(", ")}`,
      argv: aptGet("install", "--no-install-recommends", ...packages),
    },
  ];
  // On a fresh install the kernel step regenerates the initramfs; on a re-entry the
  // kernel already exists and the new tools must be picked up explicitly.
  if (await hasInstalledKernel()) {
    actions.push({
      description: "Rebuild initramfs (update-initramfs -u)",
      argv: inChroot(["update-initramfs", "-u"]),
    });
  }
  return actions;
}

/** Kernel and firmware — only if the kernel is not installed yet. */
export async function planKernelInstall(): Promise<PlannedAction[]> {
  if (await isPackageInstalled("linux-image-amd64")) return [];
  return [
    {
      description: "Install kernel linux-image-amd64 and firmware-linux",
      argv: aptGet("install", "--no-install-recommends", "linux-image-amd64", "firmware-linux"),
    },
  ];
}

/** fstab — only if it is not generated yet. */
export async function planFstab(): Promise<PlannedAction[]> {
  if (await Bun.file(`${TARGET_ROOT}/etc/fstab`).exists()) return [];
  return [
    {
      description: "Generate /etc/fstab by UUID",
      generateFstab: true,
    },
  ];
}

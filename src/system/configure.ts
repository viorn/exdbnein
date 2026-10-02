import { readlink, stat } from "node:fs/promises";
import type { InstallConfig, UserConfig } from "../config/types.ts";
import { aptGet, isPackageInstalled, type PlannedAction } from "./base.ts";
import { inChroot, TARGET_ROOT } from "./chroot.ts";
import { recoverSubvolumeMounts } from "./disks.ts";
import type { Firmware } from "./environment.ts";
import { exec } from "./exec.ts";

// ---- hostname ---------------------------------------------------------------

/** Content of /etc/hostname. */
export function hostnameFileContent(hostname: string): string {
  return `${hostname}\n`;
}

/** Content of /etc/hosts — localhost and a static entry for the hostname. */
export function hostsFileContent(hostname: string): string {
  return [
    "127.0.0.1\tlocalhost",
    `127.0.1.1\t${hostname}`,
    "",
    "# The following lines are desirable for IPv6 capable hosts",
    "::1\t\tlocalhost ip6-localhost ip6-loopback",
    "ff02::1\t\tip6-allnodes",
    "ff02::2\t\tip6-allrouters",
    "",
  ].join("\n");
}

/** The hostname is already applied in the target system. */
export async function isHostnameConfigured(hostname: string, root = TARGET_ROOT): Promise<boolean> {
  const content = await Bun.file(`${root}/etc/hostname`)
    .text()
    .catch(() => "");
  return content.trim() === hostname;
}

/** /etc/hostname and /etc/hosts — only if the hostname is not set yet. */
export async function planHostname(config: InstallConfig): Promise<PlannedAction[]> {
  const hostname = config.network.hostname;
  if (await isHostnameConfigured(hostname)) return [];
  return [
    {
      description: `Set hostname ${hostname}`,
      file: {
        path: `${TARGET_ROOT}/etc/hostname`,
        content: hostnameFileContent(hostname),
        mode: "0644",
      },
    },
    {
      description: "Write /etc/hosts",
      file: {
        path: `${TARGET_ROOT}/etc/hosts`,
        content: hostsFileContent(hostname),
        mode: "0644",
      },
    },
  ];
}

// ---- debconf presets (P6.1) ---------------------------------------------------

/** Splits a time zone into area and zone for the debconf tzdata questions. */
export function tzdataAreaZone(timezone: string): [string, string] {
  const slash = timezone.indexOf("/");
  if (slash === -1) return ["Etc", timezone];
  return [timezone.slice(0, slash), timezone.slice(slash + 1)];
}

/**
 * debconf preset text for locales/console-setup/keyboard-configuration/tzdata
 * and (BIOS) grub-pc. Without them the chroot install hangs on questions (P6.1).
 */
export function debconfPresetsContent(config: InstallConfig, firmware: Firmware): string {
  const [area, zone] = tzdataAreaZone(config.locale.timezone);
  const lines = [
    `locales locales/locales_to_be_generated multiselect ${config.locale.locale} UTF-8`,
    `locales locales/default_environment_locale select ${config.locale.locale}`,
    `keyboard-configuration keyboard-configuration/xkb-keymap select ${config.locale.keymap}`,
    `keyboard-configuration keyboard-configuration/layoutcode string ${config.locale.keymap}`,
    `console-setup console-setup/layoutcode string ${config.locale.keymap}`,
    "console-setup console-setup/codesetcode string Lat15",
    `tzdata tzdata/Areas select ${area}`,
    `tzdata tzdata/Zones/${area} select ${zone}`,
  ];
  if (firmware === "bios") {
    lines.push(`grub-pc grub-pc/install_devices multiselect ${config.disk.device}`);
    lines.push("grub-pc grub-pc/install_devices_empty boolean false");
  }
  return `${lines.join("\n")}\n`;
}

const PRESEED_PATH = "/tmp/exdbnein-debconf.preseed";

/** Presets are applied before installing packages; re-application is safe. */
export async function planDebconfPresets(
  config: InstallConfig,
  firmware: Firmware,
): Promise<PlannedAction[]> {
  const localeOk = await isLocaleConfigured(config.locale.locale);
  const keymapOk = await isKeymapConfigured(config.locale.keymap);
  const timezoneOk = await isTimezoneConfigured(config.locale.timezone);
  if (localeOk && keymapOk && timezoneOk) return [];

  const content = debconfPresetsContent(config, firmware);
  return [
    {
      description: "Write debconf presets",
      file: { path: `${TARGET_ROOT}${PRESEED_PATH}`, content, mode: "0600" },
    },
    {
      description: "Apply debconf presets (debconf-set-selections)",
      argv: inChroot(["debconf-set-selections", PRESEED_PATH]),
    },
    {
      description: "Remove the temporary presets file",
      argv: ["rm", "-f", `${TARGET_ROOT}${PRESEED_PATH}`],
    },
  ];
}

// ---- system packages ----------------------------------------------------------

/** Stage 6 packages for the target system (depend on network/firmware/bootloader). */
export function systemPackages(config: InstallConfig, firmware: Firmware): string[] {
  const packages = [
    "locales",
    "console-setup",
    "keyboard-configuration",
    "tzdata",
    "sudo",
    "openssh-server",
  ];
  if (config.network.manager === "networkmanager") packages.push("network-manager");
  packages.push(firmware === "uefi" ? "grub-efi-amd64" : "grub-pc");
  if (config.bootloader.osProber) packages.push("os-prober");
  return packages;
}

/** The installation is skipped if all needed packages are already installed (idempotency). */
export async function planSystemPackages(
  config: InstallConfig,
  firmware: Firmware,
): Promise<PlannedAction[]> {
  const packages = systemPackages(config, firmware);
  const installed = await Promise.all(packages.map((pkg) => isPackageInstalled(pkg)));
  if (installed.every(Boolean)) return [];
  return [
    {
      description: `Install system packages: ${packages.join(", ")}`,
      argv: aptGet("install", "--no-install-recommends", ...packages),
    },
  ];
}

// ---- locale --------------------------------------------------------------------

/** /etc/locale.gen: only the selected locale is generated. */
export function localeGenContent(locale: string): string {
  return [`# exdbnein: locales`, `${locale} UTF-8`, ""].join("\n");
}

/** /etc/default/locale. */
export function defaultLocaleContent(locale: string): string {
  return `LANG=${locale}\n`;
}

/** The locale is already configured (/etc/default/locale has the needed LANG). */
export async function isLocaleConfigured(locale: string, root = TARGET_ROOT): Promise<boolean> {
  const content = await Bun.file(`${root}/etc/default/locale`)
    .text()
    .catch(() => "");
  return content.includes(`LANG=${locale}`);
}

/** Locale generation — only if it is not configured yet. */
export async function planLocale(config: InstallConfig): Promise<PlannedAction[]> {
  const locale = config.locale.locale;
  if (await isLocaleConfigured(locale)) return [];
  return [
    {
      description: `Write /etc/locale.gen (${locale})`,
      file: {
        path: `${TARGET_ROOT}/etc/locale.gen`,
        content: localeGenContent(locale),
        mode: "0644",
      },
    },
    {
      description: `Write /etc/default/locale (${locale})`,
      file: {
        path: `${TARGET_ROOT}/etc/default/locale`,
        content: defaultLocaleContent(locale),
        mode: "0644",
      },
    },
    { description: "Generate locales (locale-gen)", argv: inChroot(["locale-gen"]) },
  ];
}

// ---- keyboard layout -----------------------------------------------------------

/** /etc/default/keyboard — model, layout and switching (e.g. us,ru). */
export function keyboardContent(keymap: string): string {
  return [
    "# /etc/default/keyboard — exdbnein",
    'XKBMODEL="pc105"',
    `XKBLAYOUT="${keymap}"`,
    'XKBVARIANT=""',
    'XKBOPTIONS="grp:alt_shift_toggle,terminate:ctrl_alt_bksp"',
    "",
  ].join("\n");
}

/** The layout is already configured (/etc/default/keyboard has the needed XKBLAYOUT). */
export async function isKeymapConfigured(keymap: string, root = TARGET_ROOT): Promise<boolean> {
  const content = await Bun.file(`${root}/etc/default/keyboard`)
    .text()
    .catch(() => "");
  return content.includes(`XKBLAYOUT="${keymap}"`);
}

/** Console and X11 layout — via /etc/default/keyboard (console-setup). */
export async function planKeyboard(config: InstallConfig): Promise<PlannedAction[]> {
  const keymap = config.locale.keymap;
  if (await isKeymapConfigured(keymap)) return [];
  return [
    {
      description: `Write /etc/default/keyboard (${keymap})`,
      file: {
        path: `${TARGET_ROOT}/etc/default/keyboard`,
        content: keyboardContent(keymap),
        mode: "0644",
      },
    },
  ];
}

// ---- time zone ------------------------------------------------------------------

/** Path to the zone file inside the target system. */
export function timezonePath(timezone: string): string {
  return `/usr/share/zoneinfo/${timezone}`;
}

/** The time zone is already configured (symlink /etc/localtime). */
export async function isTimezoneConfigured(timezone: string, root = TARGET_ROOT): Promise<boolean> {
  const target = await readlink(`${root}/etc/localtime`).catch(() => "");
  return target === timezonePath(timezone);
}

/** /etc/timezone + /etc/localtime symlink to the tzdata zone. */
export async function planTimezone(config: InstallConfig): Promise<PlannedAction[]> {
  const timezone = config.locale.timezone;
  if (await isTimezoneConfigured(timezone)) return [];
  return [
    {
      description: `Write /etc/timezone (${timezone})`,
      file: { path: `${TARGET_ROOT}/etc/timezone`, content: `${timezone}\n`, mode: "0644" },
    },
    {
      description: `Link /etc/localtime to ${timezone}`,
      argv: ["ln", "-sf", timezonePath(timezone), `${TARGET_ROOT}/etc/localtime`],
    },
  ];
}

// ---- root password --------------------------------------------------------------

/** Root password hash in the target system (from /etc/shadow); null — if unset. */
export async function rootPasswordHashInSystem(root = TARGET_ROOT): Promise<string | null> {
  const result = await exec(inChroot(["getent", "shadow", "root"], root), { allowFailure: true });
  if (result.code !== 0) return null;
  return result.stdout.split(":")[1] ?? null;
}

/** Root password — only if the hash differs from the current one (idempotency). */
export async function planRootPassword(config: InstallConfig): Promise<PlannedAction[]> {
  const hash = config.rootPasswordHash;
  if (!hash || (await rootPasswordHashInSystem()) === hash) return [];
  return [
    {
      description: "Set root password",
      argv: inChroot(["usermod", "-p", hash, "root"]),
    },
  ];
}

// ---- users and SSH keys (P6.3) --------------------------------------------------

/** The user already exists in the target system. */
export async function isUserCreated(username: string, root = TARGET_ROOT): Promise<boolean> {
  const result = await exec(inChroot(["id", "-u", username], root), { allowFailure: true });
  return result.code === 0;
}

/** useradd command: home, bash, sudo group, full name, password hash. */
export function useraddCommand(user: UserConfig): string[] {
  const args = ["useradd", "-m", "-s", "/bin/bash"];
  if (user.sudo) args.push("-G", "sudo");
  if (user.fullName) args.push("-c", user.fullName);
  args.push("-p", user.passwordHash ?? "", user.username);
  return inChroot(args);
}

/** authorized_keys content — one key per line. */
export function authorizedKeysContent(keys: string[]): string {
  return `${keys
    .map((key) => key.trim())
    .filter(Boolean)
    .join("\n")}\n`;
}

/** SSH keys: ~/.ssh 700, authorized_keys 600, owner — the user (P6.3). */
export async function planUserSsh(user: UserConfig): Promise<PlannedAction[]> {
  if (user.sshKeys.length === 0) return [];
  const home = `/home/${user.username}`;
  const sshDir = `${home}/.ssh`;
  const keys = authorizedKeysContent(user.sshKeys);
  const current = await Bun.file(`${TARGET_ROOT}${sshDir}/authorized_keys`)
    .text()
    .catch(() => "");
  if (current === keys) return [];
  return [
    {
      description: `Write ${sshDir}/authorized_keys`,
      file: { path: `${TARGET_ROOT}${sshDir}/authorized_keys`, content: keys, mode: "0600" },
    },
    {
      description: `Set 700 permissions on ${sshDir}`,
      argv: ["chmod", "700", `${TARGET_ROOT}${sshDir}`],
    },
    {
      description: `Owner of ${home} — ${user.username}`,
      argv: ["chown", "-R", `${user.username}:${user.username}`, `${TARGET_ROOT}${home}`],
    },
  ];
}

/** The user's home directory exists in the target system. */
export async function homeDirectoryExists(username: string, root = TARGET_ROOT): Promise<boolean> {
  try {
    return (await stat(`${root}/home/${username}`)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Recreates a missing home for an already existing user from /etc/skel. Runs inside
 * the chroot so the target NSS resolves the owner — the host does not know the user.
 * Needed when a previous run created the user while /home was not yet mounted.
 */
export function createHomeCommand(user: UserConfig): string[] {
  const home = `/home/${user.username}`;
  const script = [
    `mkdir -p ${home}`,
    `chmod 700 ${home}`,
    `chown ${user.username}: ${home}`,
    `cp -a /etc/skel/. ${home}/ 2>/dev/null || true`,
    `chown -R ${user.username}: ${home}`,
  ].join(" && ");
  return inChroot(["sh", "-c", script]);
}

/**
 * Creating users and their SSH keys. Before useradd -m the @home subvolume is
 * ensured to be mounted: otherwise the home lands in the root subvolume and is
 * hidden after reboot (the visible /home/<user> is missing). An existing user
 * without a home directory gets it recreated.
 */
export async function planUsers(config: InstallConfig): Promise<PlannedAction[]> {
  const actions: PlannedAction[] = [];

  // Recover subvolume mounts once, before processing any users.
  const recovery = await recoverSubvolumeMounts(config);
  for (const command of recovery) {
    actions.push({ description: command.description, argv: command.argv });
  }

  for (const user of config.users) {
    if (!user.passwordHash) continue;
    if (!(await isUserCreated(user.username))) {
      actions.push({
        description: `Create user ${user.username}`,
        argv: useraddCommand(user),
      });
    } else if (!(await homeDirectoryExists(user.username))) {
      actions.push({
        description: `Recreate home directory for ${user.username}`,
        argv: createHomeCommand(user),
      });
    }
    actions.push(...(await planUserSsh(user)));
  }
  return actions;
}

// ---- network ----------------------------------------------------------------------

/** systemd-networkd DHCP config for wired interfaces. */
export function networkdDhcpContent(): string {
  return [
    "# exdbnein: DHCP on wired interfaces",
    "[Match]",
    "Name=en* eth*",
    "",
    "[Network]",
    "DHCP=ipv4",
    "LinkLocalAddressing=ipv6",
    "",
  ].join("\n");
}

/** The service is enabled in the target system (systemctl is-enabled). */
export async function isServiceEnabled(unit: string, root = TARGET_ROOT): Promise<boolean> {
  const result = await exec(inChroot(["systemctl", "is-enabled", unit], root), {
    allowFailure: true,
  });
  return result.code === 0;
}

/** Network: NetworkManager, systemd-networkd + resolved, or nothing (manager=none). */
export async function planNetwork(config: InstallConfig): Promise<PlannedAction[]> {
  const actions: PlannedAction[] = [];

  if (config.network.manager === "networkmanager") {
    if (!(await isServiceEnabled("NetworkManager"))) {
      actions.push({
        description: "Enable NetworkManager (systemctl enable)",
        argv: inChroot(["systemctl", "enable", "NetworkManager"]),
      });
    }
    return actions;
  }

  if (config.network.manager === "systemd-networkd") {
    const netFile = `${TARGET_ROOT}/etc/systemd/network/20-wired.network`;
    if (!(await Bun.file(netFile).exists())) {
      actions.push({
        description: "Write systemd-networkd DHCP config",
        file: { path: netFile, content: networkdDhcpContent(), mode: "0644" },
      });
    }
    for (const unit of ["systemd-networkd", "systemd-resolved"]) {
      if (!(await isServiceEnabled(unit))) {
        actions.push({
          description: `Enable ${unit}`,
          argv: inChroot(["systemctl", "enable", unit]),
        });
      }
    }
    const resolvLink = `${TARGET_ROOT}/etc/resolv.conf`;
    if ((await readlink(resolvLink).catch(() => "")) !== "/run/systemd/resolve/resolv.conf") {
      actions.push({
        description: "Point /etc/resolv.conf to systemd-resolved",
        argv: ["ln", "-sf", "/run/systemd/resolve/resolv.conf", resolvLink],
      });
    }
  }

  return actions;
}

// ---- bootloader -------------------------------------------------------------------

/** GRUB package by firmware. */
export function grubPackage(firmware: Firmware): string {
  return firmware === "uefi" ? "grub-efi-amd64" : "grub-pc";
}

/** /etc/default/grub: os-prober disabled by default (P6.2). */
export function grubDefaultsContent(osProber: boolean): string {
  return [
    "# /etc/default/grub — exdbnein",
    "GRUB_DEFAULT=0",
    "GRUB_TIMEOUT=5",
    "GRUB_DISTRIBUTOR=\"$(sed 's, release .*$,,g' /etc/debian_version)\"",
    'GRUB_CMDLINE_LINUX_DEFAULT="quiet"',
    'GRUB_CMDLINE_LINUX=""',
    `GRUB_DISABLE_OS_PROBER=${osProber ? "false" : "true"}`,
    "",
  ].join("\n");
}

/** grub-install command: BIOS — into the device, UEFI — into ESP with efi-directory. */
export function grubInstallCommand(firmware: Firmware, device: string): string[] {
  if (firmware === "uefi") {
    return inChroot([
      "grub-install",
      "--target=x86_64-efi",
      "--efi-directory=/boot/efi",
      "--bootloader-id=exdbnein",
      "--recheck",
    ]);
  }
  return inChroot(["grub-install", "--target=i386-pc", device]);
}

/**
 * GRUB is installed: for UEFI — the bootloader file in ESP, for BIOS — the generated
 * grub.cfg (after the grub-pc postinst with the install_devices preset).
 */
export async function isGrubInstalled(firmware: Firmware, root = TARGET_ROOT): Promise<boolean> {
  const version = await exec(inChroot(["grub-install", "--version"], root), { allowFailure: true });
  if (version.code !== 0) return false;
  if (firmware === "uefi") {
    return Bun.file(`${root}/boot/efi/EFI/exdbnein/grubx64.efi`).exists();
  }
  return Bun.file(`${root}/boot/grub/grub.cfg`).exists();
}

/** Bootloader: /etc/default/grub, grub-install, update-grub, UEFI fallback copy. */
export async function planBootloader(
  config: InstallConfig,
  firmware: Firmware,
): Promise<PlannedAction[]> {
  const actions: PlannedAction[] = [];
  const defaultsPath = `${TARGET_ROOT}/etc/default/grub`;
  const desired = grubDefaultsContent(config.bootloader.osProber);
  const current = await Bun.file(defaultsPath)
    .text()
    .catch(() => "");
  const defaultsChanged = current !== desired;

  if (defaultsChanged) {
    actions.push({
      description: "Write /etc/default/grub",
      file: { path: defaultsPath, content: desired, mode: "0644" },
    });
  }

  if (await isGrubInstalled(firmware)) {
    // The package already installed GRUB; rebuild is needed only when settings changed.
    if (defaultsChanged) {
      actions.push({
        description: "Rebuild GRUB configuration (update-grub)",
        argv: inChroot(["update-grub"]),
      });
    }
    return actions;
  }

  actions.push({
    description: `Install GRUB (${firmware === "uefi" ? "UEFI" : "BIOS"})`,
    argv: grubInstallCommand(firmware, config.disk.device),
  });
  if (firmware === "uefi") {
    // Fallback boot path — works in QEMU/OVMF even without NVRAM entries.
    actions.push(
      {
        description: "Create fallback EFI bootloader directory",
        argv: ["mkdir", "-p", `${TARGET_ROOT}/boot/efi/EFI/BOOT`],
      },
      {
        description: "Copy grubx64.efi to EFI/BOOT (fallback)",
        argv: [
          "cp",
          `${TARGET_ROOT}/boot/efi/EFI/exdbnein/grubx64.efi`,
          `${TARGET_ROOT}/boot/efi/EFI/BOOT/BOOTX64.EFI`,
        ],
      },
    );
  }
  actions.push({
    description: "Update GRUB configuration (update-grub)",
    argv: inChroot(["update-grub"]),
  });
  return actions;
}

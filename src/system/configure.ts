import { readlink } from "node:fs/promises";
import type { InstallConfig, UserConfig } from "../config/types.ts";
import { aptGet, isPackageInstalled, type PlannedAction } from "./base.ts";
import { inChroot, TARGET_ROOT } from "./chroot.ts";
import type { Firmware } from "./environment.ts";
import { exec } from "./exec.ts";

// ---- hostname ---------------------------------------------------------------

/** Содержимое /etc/hostname. */
export function hostnameFileContent(hostname: string): string {
  return `${hostname}\n`;
}

/** Содержимое /etc/hosts — localhost и статическая запись для hostname. */
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

/** hostname уже применён в целевой системе. */
export async function isHostnameConfigured(hostname: string, root = TARGET_ROOT): Promise<boolean> {
  const content = await Bun.file(`${root}/etc/hostname`)
    .text()
    .catch(() => "");
  return content.trim() === hostname;
}

/** /etc/hostname и /etc/hosts — только если hostname ещё не установлен. */
export async function planHostname(config: InstallConfig): Promise<PlannedAction[]> {
  const hostname = config.network.hostname;
  if (await isHostnameConfigured(hostname)) return [];
  return [
    {
      description: `Установить hostname ${hostname}`,
      file: {
        path: `${TARGET_ROOT}/etc/hostname`,
        content: hostnameFileContent(hostname),
        mode: "0644",
      },
    },
    {
      description: "Записать /etc/hosts",
      file: {
        path: `${TARGET_ROOT}/etc/hosts`,
        content: hostsFileContent(hostname),
        mode: "0644",
      },
    },
  ];
}

// ---- debconf-пресеты (P6.1) -------------------------------------------------

/** Разбивает часовой пояс на область и зону для вопросов debconf tzdata. */
export function tzdataAreaZone(timezone: string): [string, string] {
  const slash = timezone.indexOf("/");
  if (slash === -1) return ["Etc", timezone];
  return [timezone.slice(0, slash), timezone.slice(slash + 1)];
}

/**
 * Текст debconf-пресетов для locales/console-setup/keyboard-configuration/tzdata
 * и (BIOS) grub-pc. Без них chroot-установка зависнет на вопросах (P6.1).
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

/** Пресеты применяются до установки пакетов; повторное применение безопасно. */
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
      description: "Записать debconf-пресеты",
      file: { path: `${TARGET_ROOT}${PRESEED_PATH}`, content, mode: "0600" },
    },
    {
      description: "Применить debconf-пресеты (debconf-set-selections)",
      argv: inChroot(["debconf-set-selections", PRESEED_PATH]),
    },
    {
      description: "Удалить временный файл пресетов",
      argv: ["rm", "-f", `${TARGET_ROOT}${PRESEED_PATH}`],
    },
  ];
}

// ---- системные пакеты -------------------------------------------------------

/** Пакеты этапа 6 для целевой системы (зависят от сети/прошивки/загрузчика). */
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

/** Установка пропускается, если все нужные пакеты уже стоят (идемпотентность). */
export async function planSystemPackages(
  config: InstallConfig,
  firmware: Firmware,
): Promise<PlannedAction[]> {
  const packages = systemPackages(config, firmware);
  const installed = await Promise.all(packages.map((pkg) => isPackageInstalled(pkg)));
  if (installed.every(Boolean)) return [];
  return [
    {
      description: `Установить системные пакеты: ${packages.join(", ")}`,
      argv: aptGet("install", "--no-install-recommends", ...packages),
    },
  ];
}

// ---- локаль ----------------------------------------------------------------

/** /etc/locale.gen: генерируется только выбранная локаль. */
export function localeGenContent(locale: string): string {
  return [`# exdbnein: локали`, `${locale} UTF-8`, ""].join("\n");
}

/** /etc/default/locale. */
export function defaultLocaleContent(locale: string): string {
  return `LANG=${locale}\n`;
}

/** Локаль уже настроена (есть /etc/default/locale с нужным LANG). */
export async function isLocaleConfigured(locale: string, root = TARGET_ROOT): Promise<boolean> {
  const content = await Bun.file(`${root}/etc/default/locale`)
    .text()
    .catch(() => "");
  return content.includes(`LANG=${locale}`);
}

/** Генерация локали — только если она ещё не настроена. */
export async function planLocale(config: InstallConfig): Promise<PlannedAction[]> {
  const locale = config.locale.locale;
  if (await isLocaleConfigured(locale)) return [];
  return [
    {
      description: `Записать /etc/locale.gen (${locale})`,
      file: {
        path: `${TARGET_ROOT}/etc/locale.gen`,
        content: localeGenContent(locale),
        mode: "0644",
      },
    },
    {
      description: `Записать /etc/default/locale (${locale})`,
      file: {
        path: `${TARGET_ROOT}/etc/default/locale`,
        content: defaultLocaleContent(locale),
        mode: "0644",
      },
    },
    { description: "Сгенерировать локали (locale-gen)", argv: inChroot(["locale-gen"]) },
  ];
}

// ---- раскладка клавиатуры ---------------------------------------------------

/** /etc/default/keyboard — модель, раскладка и переключение (например, us,ru). */
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

/** Раскладка уже настроена (/etc/default/keyboard с нужным XKBLAYOUT). */
export async function isKeymapConfigured(keymap: string, root = TARGET_ROOT): Promise<boolean> {
  const content = await Bun.file(`${root}/etc/default/keyboard`)
    .text()
    .catch(() => "");
  return content.includes(`XKBLAYOUT="${keymap}"`);
}

/** Раскладка консоли и X11 — через /etc/default/keyboard (console-setup). */
export async function planKeyboard(config: InstallConfig): Promise<PlannedAction[]> {
  const keymap = config.locale.keymap;
  if (await isKeymapConfigured(keymap)) return [];
  return [
    {
      description: `Записать /etc/default/keyboard (${keymap})`,
      file: {
        path: `${TARGET_ROOT}/etc/default/keyboard`,
        content: keyboardContent(keymap),
        mode: "0644",
      },
    },
  ];
}

// ---- часовой пояс -----------------------------------------------------------

/** Путь к файлу зоны внутри целевой системы. */
export function timezonePath(timezone: string): string {
  return `/usr/share/zoneinfo/${timezone}`;
}

/** Часовой пояс уже настроен (симлинк /etc/localtime). */
export async function isTimezoneConfigured(timezone: string, root = TARGET_ROOT): Promise<boolean> {
  const target = await readlink(`${root}/etc/localtime`).catch(() => "");
  return target === timezonePath(timezone);
}

/** /etc/timezone + симлинк /etc/localtime на tzdata-зону. */
export async function planTimezone(config: InstallConfig): Promise<PlannedAction[]> {
  const timezone = config.locale.timezone;
  if (await isTimezoneConfigured(timezone)) return [];
  return [
    {
      description: `Записать /etc/timezone (${timezone})`,
      file: { path: `${TARGET_ROOT}/etc/timezone`, content: `${timezone}\n`, mode: "0644" },
    },
    {
      description: `Связать /etc/localtime с ${timezone}`,
      argv: ["ln", "-sf", timezonePath(timezone), `${TARGET_ROOT}/etc/localtime`],
    },
  ];
}

// ---- пароль root ------------------------------------------------------------

/** Хеш пароля root в целевой системе (из /etc/shadow); null — если не задан. */
export async function rootPasswordHashInSystem(root = TARGET_ROOT): Promise<string | null> {
  const result = await exec(inChroot(["getent", "shadow", "root"], root), { allowFailure: true });
  if (result.code !== 0) return null;
  return result.stdout.split(":")[1] ?? null;
}

/** Пароль root — только если хеш отличается от текущего (идемпотентность). */
export async function planRootPassword(config: InstallConfig): Promise<PlannedAction[]> {
  const hash = config.rootPasswordHash;
  if (!hash || (await rootPasswordHashInSystem()) === hash) return [];
  return [
    {
      description: "Установить пароль root",
      argv: inChroot(["usermod", "-p", hash, "root"]),
    },
  ];
}

// ---- пользователи и SSH-ключи (P6.3) ----------------------------------------

/** Пользователь уже существует в целевой системе. */
export async function isUserCreated(username: string, root = TARGET_ROOT): Promise<boolean> {
  const result = await exec(inChroot(["id", "-u", username], root), { allowFailure: true });
  return result.code === 0;
}

/** Команда useradd: home, bash, sudo-группа, полное имя, хеш пароля. */
export function useraddCommand(user: UserConfig): string[] {
  const args = ["useradd", "-m", "-s", "/bin/bash"];
  if (user.sudo) args.push("-G", "sudo");
  if (user.fullName) args.push("-c", user.fullName);
  args.push("-p", user.passwordHash ?? "", user.username);
  return inChroot(args);
}

/** Содержимое authorized_keys — по ключу на строку. */
export function authorizedKeysContent(keys: string[]): string {
  return `${keys
    .map((key) => key.trim())
    .filter(Boolean)
    .join("\n")}\n`;
}

/** SSH-ключи: ~/.ssh 700, authorized_keys 600, владелец — пользователь (P6.3). */
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
      description: `Записать ${sshDir}/authorized_keys`,
      file: { path: `${TARGET_ROOT}${sshDir}/authorized_keys`, content: keys, mode: "0600" },
    },
    { description: `Права 700 на ${sshDir}`, argv: ["chmod", "700", `${TARGET_ROOT}${sshDir}`] },
    {
      description: `Владелец ${home} — ${user.username}`,
      argv: ["chown", "-R", `${user.username}:${user.username}`, `${TARGET_ROOT}${home}`],
    },
  ];
}

/** Создание пользователей и их SSH-ключей. */
export async function planUsers(config: InstallConfig): Promise<PlannedAction[]> {
  const actions: PlannedAction[] = [];
  for (const user of config.users) {
    if (!user.passwordHash) continue;
    if (!(await isUserCreated(user.username))) {
      actions.push({
        description: `Создать пользователя ${user.username}`,
        argv: useraddCommand(user),
      });
    }
    actions.push(...(await planUserSsh(user)));
  }
  return actions;
}

// ---- сеть -------------------------------------------------------------------

/** DHCP-конфиг systemd-networkd для проводных интерфейсов. */
export function networkdDhcpContent(): string {
  return [
    "# exdbnein: DHCP на проводных интерфейсах",
    "[Match]",
    "Name=en* eth*",
    "",
    "[Network]",
    "DHCP=ipv4",
    "LinkLocalAddressing=ipv6",
    "",
  ].join("\n");
}

/** Сервис включён в целевой системе (systemctl is-enabled). */
export async function isServiceEnabled(unit: string, root = TARGET_ROOT): Promise<boolean> {
  const result = await exec(inChroot(["systemctl", "is-enabled", unit], root), {
    allowFailure: true,
  });
  return result.code === 0;
}

/** Сеть: NetworkManager, systemd-networkd + resolved, либо ничего (manager=none). */
export async function planNetwork(config: InstallConfig): Promise<PlannedAction[]> {
  const actions: PlannedAction[] = [];

  if (config.network.manager === "networkmanager") {
    if (!(await isServiceEnabled("NetworkManager"))) {
      actions.push({
        description: "Включить NetworkManager (systemctl enable)",
        argv: inChroot(["systemctl", "enable", "NetworkManager"]),
      });
    }
    return actions;
  }

  if (config.network.manager === "systemd-networkd") {
    const netFile = `${TARGET_ROOT}/etc/systemd/network/20-wired.network`;
    if (!(await Bun.file(netFile).exists())) {
      actions.push({
        description: "Записать DHCP-конфиг systemd-networkd",
        file: { path: netFile, content: networkdDhcpContent(), mode: "0644" },
      });
    }
    for (const unit of ["systemd-networkd", "systemd-resolved"]) {
      if (!(await isServiceEnabled(unit))) {
        actions.push({
          description: `Включить ${unit}`,
          argv: inChroot(["systemctl", "enable", unit]),
        });
      }
    }
    const resolvLink = `${TARGET_ROOT}/etc/resolv.conf`;
    if ((await readlink(resolvLink).catch(() => "")) !== "/run/systemd/resolve/resolv.conf") {
      actions.push({
        description: "Перенаправить /etc/resolv.conf на systemd-resolved",
        argv: ["ln", "-sf", "/run/systemd/resolve/resolv.conf", resolvLink],
      });
    }
  }

  return actions;
}

// ---- загрузчик --------------------------------------------------------------

/** Пакет GRUB по прошивке. */
export function grubPackage(firmware: Firmware): string {
  return firmware === "uefi" ? "grub-efi-amd64" : "grub-pc";
}

/** /etc/default/grub: os-prober выключен по умолчанию (P6.2). */
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

/** Команда grub-install: BIOS — в устройство, UEFI — в ESP с efi-directory. */
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
 * GRUB установлен: для UEFI — файл загрузчика в ESP, для BIOS — сгенерированный
 * grub.cfg (после postinst grub-pc с пресетом install_devices).
 */
export async function isGrubInstalled(firmware: Firmware, root = TARGET_ROOT): Promise<boolean> {
  const version = await exec(inChroot(["grub-install", "--version"], root), { allowFailure: true });
  if (version.code !== 0) return false;
  if (firmware === "uefi") {
    return Bun.file(`${root}/boot/efi/EFI/exdbnein/grubx64.efi`).exists();
  }
  return Bun.file(`${root}/boot/grub/grub.cfg`).exists();
}

/** Загрузчик: /etc/default/grub, grub-install, update-grub, fallback-копия для UEFI. */
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
      description: "Записать /etc/default/grub",
      file: { path: defaultsPath, content: desired, mode: "0644" },
    });
  }

  if (await isGrubInstalled(firmware)) {
    // Пакет уже поставил GRUB; пересборка нужна только при изменении настроек.
    if (defaultsChanged) {
      actions.push({
        description: "Пересобрать конфигурацию GRUB (update-grub)",
        argv: inChroot(["update-grub"]),
      });
    }
    return actions;
  }

  actions.push({
    description: `Установить GRUB (${firmware === "uefi" ? "UEFI" : "BIOS"})`,
    argv: grubInstallCommand(firmware, config.disk.device),
  });
  if (firmware === "uefi") {
    // Резервный путь загрузки — работает в QEMU/OVMF даже без записи в NVRAM.
    actions.push(
      {
        description: "Создать каталог резервного EFI-загрузчика",
        argv: ["mkdir", "-p", `${TARGET_ROOT}/boot/efi/EFI/BOOT`],
      },
      {
        description: "Скопировать grubx64.efi в EFI/BOOT (fallback)",
        argv: [
          "cp",
          `${TARGET_ROOT}/boot/efi/EFI/exdbnein/grubx64.efi`,
          `${TARGET_ROOT}/boot/efi/EFI/BOOT/BOOTX64.EFI`,
        ],
      },
    );
  }
  actions.push({
    description: "Обновить конфигурацию GRUB (update-grub)",
    argv: inChroot(["update-grub"]),
  });
  return actions;
}

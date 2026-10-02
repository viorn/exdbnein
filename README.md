# exdbnein — Console Debian Installer

An interactive TUI Debian installer (similar to `archinstall`) built with `Bun + TypeScript`. Ships inside its own LiveCD; the repository contains both the installer and LiveCD ISO build scripts.

- **Architecture:** `amd64` only.
- **Filesystems:** `btrfs` (subvolumes `@`, `@home`, `@snapshots`, `compress=zstd,noatime`) and `ext4`.
- **Partitioning by firmware:** BIOS → MBR, UEFI → GPT + ESP.
- **Bootloader:** GRUB (BIOS `i386-pc`, UEFI `x86_64-efi` + fallback `EFI/BOOT/BOOTX64.EFI`).
- **Profiles:** YAML with inheritance (`extends`): `base`, `server`, `desktop`, `dev`.
- **Two modes:** interactive wizard and fully unattended installation via JSON config (`--config … --unattended`).

## Features

| Area | Capabilities |
|---|---|
| Disk | `auto` (full wipe), `manual` (custom ESP/swap sizes), `keep` (mount existing without wiping); dry-run command plan before execution |
| System | `debootstrap` (minbase, stable), kernel `linux-image-amd64`, `fstab` by UUID |
| Configuration | locale, keymap, timezone, users + sudo, SSH keys, NetworkManager / systemd-networkd, GRUB |
| Profiles | packages, services, files, commands; idempotency via `/var/lib/exdbnein/applied.json` |
| Safety | refuses to run without root / outside LiveCD (marker `/etc/exdbnein-live`), protects against selecting the LiveCD drive |
| Automation | `--unattended` + full JSON config; QEMU runs BIOS/UEFI (`scripts/qemu-test.sh`) |

## Repository Structure

```
exdbnein/
├── src/                 # installer
│   ├── index.ts         # entry point (wizard → apply)
│   ├── cli.ts           # arguments: -c/--config, -p/--profiles-dir, -y/--unattended, -f/--force
│   ├── steps/           # wizard steps (Phase A — configuration only)
│   ├── install/         # apply runner (Phase B — system operations)
│   ├── system/          # wrappers around parted/mkfs/debootstrap/apt/chroot/GRUB
│   ├── config/          # InstallConfig, validation, save/load JSON
│   ├── profiles/        # YAML profile loading/resolving (extends)
│   └── ui/              # helpers over @clack/prompts
├── profiles/            # YAML profiles (base, server, desktop, dev)
├── livecd/              # LiveCD build: build.sh, packages.txt, overlay rootfs, grub.cfg
├── scripts/             # qemu-test.sh (QEMU e2e), embed-profiles.ts
├── plans/               # project plan and phase details (phase0–phase9)
├── tests/               # bun test
└── package.json
```

## Requirements

For development:

- [Bun](https://bun.sh) 1.4+
- For ISO build and QEMU tests — Linux x86_64, root/sudo, and host packages:
  `debootstrap`, `squashfs-tools`, `xorriso`, `grub-pc-bin`, `grub-efi-amd64-bin`,
  `mtools`, `debian-archive-keyring`, and for tests additionally `qemu-system-x86` and `ovmf`.

## Quick Start

```bash
bun install          # dependencies
bun run dev          # wizard in dev mode (requires --force outside LiveCD)
bun run check        # typecheck + lint + tests
bun run test         # tests only
```

Run the installer outside LiveCD (for development):

```bash
sudo -E bun run start -- --force
```

## Building the LiveCD

```bash
sudo bash livecd/build.sh
# output: out/exdbnein-stable.iso (hybrid BIOS+UEFI)
```

Build parameters via environment variables:

| Variable | Default | Description |
|---|---|---|
| `SUITE` | `stable` | Debian distribution for debootstrap |
| `MIRROR` | `http://deb.debian.org/debian` | mirror URL |
| `COMPONENTS` | `main,contrib,non-free-firmware` | components (WiFi firmware in non-free-firmware) |
| `ISO_NAME` | `exdbnein-stable.iso` | ISO filename |
| `VOLID` | `EXDBNEIN_LIVE` | volume label |
| `KEEP_WORK` | `0` | skip rebuilding live-root (speeds up iterations) |
| `AUTOTEST` | `0` | `1` — adds `exdbnein.config=auto` to kernel cmdline (QEMU automation) |

Inside LiveCD the installer auto-starts on tty1 (override `getty@tty1`);
debugging is available on tty2 (user `live`/`live`, passwordless sudo) and on
the serial port (`console=ttyS0,115200`, serial-getty).

## Running the Installer

### Interactive (in LiveCD)

1. Boot from the ISO in BIOS or UEFI mode.
2. The installer starts automatically: select disk, locale, network, users, and profiles.
3. At the review step a command plan is shown; confirm to proceed — then the
   system is applied (partitioning, debootstrap, configuration, profiles) with
   dry-run plans before destructive steps.

### Unattended (`--unattended`)

A full config can be saved by the wizard (`-c config.json`) or written manually —
example: [`scripts/qemu/unattended.json`](scripts/qemu/unattended.json).

```bash
exdbnein -c /path/to/config.json -y
# or: exdbnein --config /path/to/config.json --unattended
```

Notes:

- In `--unattended` all wizard steps are skipped (via `Step.skip` hook), the review
  step validates the config and auto-confirms the installation;
- an incomplete config produces an error with a list of validation issues;
- after installation the system does **not** reboot automatically (for CI/scripts);
- passwords are stored only as sha512-crypt hashes (`passwordHash`); plain-text
  passwords are never written to the config file (`redact`).

## QEMU Testing (Phase 9)

`scripts/qemu-test.sh` runs the full cycle: ISO → install in QEMU → reboot →
SSH login → system verification (hostname, btrfs subvolumes, disk layout,
user accounts, SSH service, install log) → clean shutdown.

```bash
scripts/qemu-test.sh                     # BIOS + UEFI
scripts/qemu-test.sh --firmware uefi     # UEFI only
scripts/qemu-test.sh --iso out/exdbnein-autotest.iso
scripts/qemu-test.sh --skip-build        # skip ISO build
scripts/qemu-test.sh --timeout 3600      # install phase timeout, seconds
scripts/qemu-test.sh --keep-vm           # leave QEMU running on failure
```

How it works:

1. If the ISO is missing — it is built with `AUTOTEST=1` (requires root; the
   script re-executes itself via `sudo`).
2. An ephemeral SSH key is generated; its public key is injected into the config
   (placeholder `@@PUBKEY@@` in [`scripts/qemu/unattended.json`](scripts/qemu/unattended.json)).
3. A seed disk (FAT, label `EXDBNEINCFG`) is created with the config.
4. QEMU boots the ISO; automated mode (`exdbnein.config=auto` in cmdline) mounts
   the seed disk and runs `exdbnein --config … --unattended`; the result
   (`RESULT=OK|FAIL`) is written to ttyS0 (`-serial stdio`).
5. After a successful install the VM powers off, the test boots from the target
   disk and verifies SSH (`localhost:2222`).

Verification checks:

- Hostname matches the config
- Root filesystem is btrfs with subvolume `@`
- btrfs subvolumes `@home` and `@snapshots` exist and `@home` is mounted
- `/dev/sda` exists, ESP (vfat) is present, swap is active
- `root` and `tester` users exist, `/home/tester/.ssh` is present
- SSH service is active, install log exists

Logs and artifacts are in `out/qemu/<bios|uefi>/`.

## Tests and CI

- `bun run check` — typecheck + lint + tests (129+ tests: lsblk, fstab, profiles,
  partition names, config validation, install stages, etc.).
- PR checks (`.github/workflows/ci.yml`): typecheck, lint, test,
  embedded profiles consistency.
- QEMU runs (`.github/workflows/qemu-nightly.yml`): nightly job (and
  `workflow_dispatch`) — BIOS + UEFI, does not block reviews.

## Project Plan

- [`plans/plan.md`](plans/plan.md) — decisions, principles, phase status.
- [`plans/phase0.md`…`plans/phase9.md`](plans/) — detailed phase specifications.

#!/usr/bin/env bash
# exdbnein — LiveCD build (stage 8).
#
# Builds a hybrid ISO (BIOS+UEFI) with a Debian live system and the installer:
#   1. compile the installer (bun build --compile, embedded profiles, P8.1);
#   2. debootstrap live-root with packages from packages.txt (incl. non-free-firmware);
#   3. customization: marker /etc/exdbnein-live (P8.2), auto-start on tty1 (P8.3),
#      NetworkManager + nmtui (WiFi firmware), live user, initramfs with live-boot;
#   4. squashfs (zstd) + grub-mkrescue (xorriso) — hybrid BIOS+UEFI.
#
# Host requirements: root, amd64, packages debootstrap, squashfs-tools, xorriso,
# grub-pc-bin, grub-efi-amd64-bin, mtools, debian-archive-keyring; bun runtime.
#
# Parameters via environment (all optional):
#   SUITE=stable MIRROR=http://deb.debian.org/debian WORK=out/livecd OUT=out
#   ISO_NAME=exdbnein-stable.iso VOLID=EXDBNEIN_LIVE KEEP_WORK=0
#   COMPONENTS=main,contrib,non-free-firmware (WiFi firmware lives in non-free-firmware)
#   BUN=/path/to/bun (by default searched in PATH, ~/.bun/bin and ~/.local/bin)
#
# The build requires root. Important: run `sudo bash livecd/build.sh`,
# NOT `sudo bun run build:live` — sudo looks for bun in secure_path and does not
# find it in ~/.bun/bin. The script finds the user's bun itself (resolve_bun) and
# runs the compilation as that user (runuser), preserving file ownership:
#   sudo bash livecd/build.sh
#   KEEP_WORK=1 sudo bash livecd/build.sh   # reuse an existing live-root
#   BUN=/path/to/bun sudo -E bash livecd/build.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SUITE="${SUITE:-stable}"
MIRROR="${MIRROR:-http://deb.debian.org/debian}"
ARCH="amd64"
COMPONENTS="${COMPONENTS:-main,contrib,non-free-firmware}"
WORK="${WORK:-$REPO_ROOT/out/livecd}"
OUT="${OUT:-$REPO_ROOT/out}"
ISO_NAME="${ISO_NAME:-exdbnein-$SUITE.iso}"
VOLID="${VOLID:-EXDBNEIN_LIVE}"
KEEP_WORK="${KEEP_WORK:-0}"
# Path to bun; if not set — searched in resolve_bun().
BUN="${BUN:-}"
# For reproducible builds (grub-mkrescue reads SOURCE_DATE_EPOCH).
SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-$(git -C "$REPO_ROOT" log -1 --format=%ct 2>/dev/null || date +%s)}"

LIVE_ROOT="$WORK/live-root"
ISO_ROOT="$WORK/iso"
PACKAGES_FILE="$SCRIPT_DIR/packages.txt"
OVERLAY="$SCRIPT_DIR/rootfs"
GRUB_CFG="$SCRIPT_DIR/grub.cfg"

export DEBIAN_FRONTEND=noninteractive

info() { printf '\033[1;34m[build]\033[0m %s\n' "$*"; }
die() {
  printf '\033[1;31m[build][error]\033[0m %s\n' "$*" >&2
  exit 1
}

# --- bun runtime lookup --------------------------------------------------------
#
# The build runs as root (sudo), where secure_path does not contain ~/.bun/bin.
# Order: explicit $BUN → command -v bun → ~/.bun/bin and ~/.local/bin of the
# current user and of SUDO_USER → /usr/local/bin, /usr/bin.
resolve_bun() {
  if [[ -n "$BUN" ]]; then
    [[ -x "$BUN" ]] || die "BUN=$BUN is not an executable"
    return
  fi

  if command -v bun >/dev/null 2>&1; then
    BUN="$(command -v bun)"
    return
  fi

  local home candidates=()
  for home in "${HOME:-}" "$(getent passwd "${SUDO_USER:-}" 2>/dev/null | cut -d: -f6)"; do
    [[ -n "$home" ]] || continue
    candidates+=("$home/.bun/bin/bun" "$home/.local/bin/bun")
  done
  candidates+=("/usr/local/bin/bun" "/usr/bin/bun")

  local cand
  for cand in "${candidates[@]}"; do
    if [[ -x "$cand" ]]; then
      BUN="$cand"
      return
    fi
  done

  # Last attempt: login shell of SUDO_USER — there the real PATH from the profile
  # is available (bun may be installed via asdf/mise etc.).
  if [[ -n "${SUDO_USER:-}" ]]; then
    local user_bun
    user_bun="$(runuser -u "$SUDO_USER" -l -- sh -lc 'command -v bun' 2>/dev/null || true)"
    if [[ -n "$user_bun" && -x "$user_bun" ]]; then
      BUN="$user_bun"
      return
    fi
  fi

  die "bun not found. Run one of these ways:
    sudo bash $0                  (bun will be found in the sudo user's ~/.bun/bin)
    sudo env \"PATH=\$PATH\" bash $0
    BUN=/path/to/bun sudo -E bash $0"
}

# --- Preflight: root, amd64, host tools --------------------------------------

preflight() {
  [[ "$(id -u)" -eq 0 ]] || die "Root privileges are required (debootstrap and squashfs)."
  [[ "$(uname -m)" == "x86_64" ]] || die "Only amd64 is supported, current: $(uname -m)"

  local tool
  for tool in debootstrap mksquashfs xorriso grub-mkrescue mformat; do
    command -v "$tool" >/dev/null 2>&1 || die "Build tool not found: $tool"
  done

  # The bun runtime is looked up separately: under sudo it is usually not in secure_path.
  resolve_bun

  # P5.1/P8: Debian archive keys are required to verify Release during debootstrap.
  if [[ ! -f /usr/share/keyrings/debian-archive-keyring.gpg ]] &&
    [[ ! -f /usr/share/debian-archive-keyring.gpg ]]; then
    die "debian-archive-keyring missing on host — install the debian-archive-keyring package"
  fi

  info "Parameters: suite=$SUITE mirror=$MIRROR arch=$ARCH components=$COMPONENTS"
  info "bun: $BUN"
}

# --- 1. Installer compilation -------------------------------------------------
#
# Under sudo, bun runs as SUDO_USER through runuser: it has the right PATH
# (bun in ~/.bun/bin) and generated repository files keep their owner. Without
# sudo (root directly) it runs as-is.

stage_compile() {
  info "Compiling the installer (bun build --compile)..."
  mkdir -p "$WORK"

  local runner=()
  if [[ -n "${SUDO_USER:-}" ]]; then
    chown "${SUDO_USER}:${SUDO_USER}" "$WORK" 2>/dev/null || true
    runner=(runuser -u "$SUDO_USER" --)
  fi

  # Embedded profiles (P8.1): data is generated before compilation to end up in the binary.
  (cd "$REPO_ROOT" && "${runner[@]}" "$BUN" run embed:profiles)

  (cd "$REPO_ROOT" && "${runner[@]}" "$BUN" build --compile --minify ./src/index.ts --outfile "$WORK/exdbnein")

  info "Binary: $WORK/exdbnein ($(du -h "$WORK/exdbnein" | cut -f1))"
}

# --- 2. debootstrap live-root ------------------------------------------------

stage_debootstrap() {
  if [[ "$KEEP_WORK" == "1" ]] && [[ -f "$LIVE_ROOT/etc/os-release" ]]; then
    info "live-root already built — skipping debootstrap (KEEP_WORK=1)"
    return
  fi

  rm -rf "$LIVE_ROOT"
  mkdir -p "$LIVE_ROOT"

  # Comments and empty lines from packages.txt are not passed to --include.
  local include
  include="$(sed -e 's/#.*//' -e '/^[[:space:]]*$/d' "$PACKAGES_FILE" | tr '\n' ',' | sed 's/,$//')"
  [[ -n "$include" ]] || die "packages.txt is empty"

  info "debootstrap: suite=$SUITE arch=$ARCH (this takes a few minutes)..."
  debootstrap \
    --arch="$ARCH" \
    --variant=minbase \
    --components="$COMPONENTS" \
    --include="$include" \
    "$SUITE" "$LIVE_ROOT" "$MIRROR"
}

# --- Pseudo-filesystems for working inside chroot ------------------------------

mount_pseudo() {
  findmnt -M "$LIVE_ROOT/proc" >/dev/null 2>&1 || mount --bind /proc "$LIVE_ROOT/proc"
  findmnt -M "$LIVE_ROOT/sys" >/dev/null 2>&1 || mount --bind /sys "$LIVE_ROOT/sys"
  findmnt -M "$LIVE_ROOT/dev" >/dev/null 2>&1 || mount --bind /dev "$LIVE_ROOT/dev"
}

unmount_pseudo() {
  umount "$LIVE_ROOT/dev" 2>/dev/null || true
  umount "$LIVE_ROOT/sys" 2>/dev/null || true
  umount "$LIVE_ROOT/proc" 2>/dev/null || true
}

# --- 3. Customizing live-root --------------------------------------------------

stage_customize() {
  info "Customizing live-root..."

  # LiveCD marker (P8.2): checked by stage 3 (src/system/environment.ts).
  touch "$LIVE_ROOT/etc/exdbnein-live"

  # Installer + profiles. Embedded in the binary — for runtime; YAML next to it — for debugging.
  mkdir -p "$LIVE_ROOT/opt/exdbnein/profiles"
  install -m 0755 "$WORK/exdbnein" "$LIVE_ROOT/opt/exdbnein/exdbnein"
  cp -a "$REPO_ROOT"/profiles/*.yaml "$LIVE_ROOT/opt/exdbnein/profiles/"

  # Overlay: auto-start on tty1 (P8.3).
  cp -a "$OVERLAY/." "$LIVE_ROOT/"

  # Actions inside chroot — in a subshell with trap, so pseudo-FS get unmounted
  # even on error (similar to P7.3).
  (
    trap unmount_pseudo EXIT
    mount_pseudo

    # resolv.conf → systemd-resolved stub (network out of the box).
    ln -sfn /run/systemd/resolve/stub-resolv.conf "$LIVE_ROOT/etc/resolv.conf"

    # Live user for debugging on tty2 (not present in the installed system).
    chroot "$LIVE_ROOT" useradd -m -s /bin/bash live || true
    chroot "$LIVE_ROOT" sh -c "echo 'live:live' | chpasswd"
    chroot "$LIVE_ROOT" sh -c "echo 'live ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/live"
    chroot "$LIVE_ROOT" chmod 440 /etc/sudoers.d/live

    # Services: NetworkManager (wired + WiFi, nmtui), resolved for DNS,
    # tty2 for debugging (tty1 is taken by the installer).
    chroot "$LIVE_ROOT" systemctl enable NetworkManager.service systemd-resolved.service getty@tty2.service

    # initramfs is rebuilt to include live-boot hooks.
    chroot "$LIVE_ROOT" update-initramfs -u -k all

    # Cleanup.
    chroot "$LIVE_ROOT" apt-get clean
    rm -rf "$LIVE_ROOT"/var/cache/apt/archives/*.deb
    rm -rf "$LIVE_ROOT"/tmp/*
  )
}

# --- 4. squashfs ---------------------------------------------------------------

stage_squashfs() {
  info "Building filesystem.squashfs (zstd)..."
  mkdir -p "$ISO_ROOT/live"

  mksquashfs "$LIVE_ROOT" "$ISO_ROOT/live/filesystem.squashfs" \
    -noappend -comp zstd -Xcompression-level 12 -processors "$(nproc)"

  info "squashfs: $(du -h "$ISO_ROOT/live/filesystem.squashfs" | cut -f1)"
}

# --- 5. Kernel, initramfs and grub.cfg for the ISO ----------------------------

stage_boot_files() {
  info "Copying kernel and initramfs into the ISO structure..."

  local kernel initrd
  kernel="$(find "$LIVE_ROOT/boot" -maxdepth 1 -name 'vmlinuz-*' -type f -print -quit)"
  initrd="$(find "$LIVE_ROOT/boot" -maxdepth 1 -name 'initrd.img-*' -type f -print -quit)"
  [[ -n "$kernel" ]] || die "No vmlinuz-* in live-root — linux-image-amd64 did not install"
  [[ -n "$initrd" ]] || die "No initrd.img-* in live-root — initramfs-tools did not run"

  mkdir -p "$ISO_ROOT/live" "$ISO_ROOT/boot/grub"
  install -m 0644 "$kernel" "$ISO_ROOT/live/vmlinuz"
  install -m 0644 "$initrd" "$ISO_ROOT/live/initrd.img"
  cp "$GRUB_CFG" "$ISO_ROOT/boot/grub/grub.cfg"
}

# --- 6. Hybrid ISO (BIOS+UEFI) -------------------------------------------------

stage_iso() {
  info "Building hybrid ISO via grub-mkrescue (xorriso)..."
  mkdir -p "$OUT"

  SOURCE_DATE_EPOCH="$SOURCE_DATE_EPOCH" grub-mkrescue \
    -o "$OUT/$ISO_NAME" \
    "$ISO_ROOT" \
    -- -volid "$VOLID" -padding 0 -joliet on

  info "Done: $OUT/$ISO_NAME ($(du -h "$OUT/$ISO_NAME" | cut -f1))"
}

main() {
  preflight
  stage_compile
  stage_debootstrap
  stage_customize
  stage_squashfs
  stage_boot_files
  stage_iso

  cat <<EOF

LiveCD built: $OUT/$ISO_NAME
Testing in QEMU (stage 9):
  qemu-system-x86_64 -m 2048 -boot d -cdrom "$OUT/$ISO_NAME"
EOF
}

main "$@"
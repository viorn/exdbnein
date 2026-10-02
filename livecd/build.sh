#!/usr/bin/env bash
# exdbnein — сборка LiveCD (этап 8).
#
# Собирает гибридный ISO (BIOS+UEFI) с live-системой Debian и установщиком:
#   1. компиляция установщика (bun build --compile, профили встроены, P8.1);
#   2. debootstrap live-root с пакетами из packages.txt (включая non-free-firmware);
#   3. кастомизация: маркер /etc/exdbnein-live (P8.2), автозапуск на tty1 (P8.3),
#      NetworkManager + nmtui (WiFi-прошивки), live-пользователь, initramfs с live-boot;
#   4. squashfs (zstd) + grub-mkrescue (xorriso) — гибрид BIOS+UEFI.
#
# Требования к хосту: root, amd64, пакеты debootstrap, squashfs-tools, xorriso,
# grub-pc-bin, grub-efi-amd64-bin, mtools, debian-archive-keyring; рантайм bun.
#
# Параметры через окружение (все опциональны):
#   SUITE=stable MIRROR=http://deb.debian.org/debian WORK=out/livecd OUT=out
#   ISO_NAME=exdbnein-stable.iso VOLID=EXDBNEIN_LIVE KEEP_WORK=0
#   COMPONENTS=main,contrib,non-free-firmware (WiFi-прошивки живут в non-free-firmware)
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
# Для воспроизводимой сборки (grub-mkrescue читает SOURCE_DATE_EPOCH).
SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-$(git -C "$REPO_ROOT" log -1 --format=%ct 2>/dev/null || date +%s)}"

LIVE_ROOT="$WORK/live-root"
ISO_ROOT="$WORK/iso"
PACKAGES_FILE="$SCRIPT_DIR/packages.txt"
OVERLAY="$SCRIPT_DIR/rootfs"
GRUB_CFG="$SCRIPT_DIR/grub.cfg"

export DEBIAN_FRONTEND=noninteractive

info() { printf '\033[1;34m[build]\033[0m %s\n' "$*"; }
die() {
  printf '\033[1;31m[build][ошибка]\033[0m %s\n' "$*" >&2
  exit 1
}

# --- Preflight: root, amd64, инструменты хоста ------------------------------

preflight() {
  [[ "$(id -u)" -eq 0 ]] || die "Нужны права root (debootstrap и squashfs)."
  [[ "$(uname -m)" == "x86_64" ]] || die "Поддерживается только amd64, сейчас: $(uname -m)"

  local tool
  for tool in debootstrap mksquashfs xorriso grub-mkrescue mformat bun; do
    command -v "$tool" >/dev/null 2>&1 || die "Не найден инструмент сборки: $tool"
  done

  # P5.1/P8: ключи архива Debian нужны для верификации Release при debootstrap.
  if [[ ! -f /usr/share/keyrings/debian-archive-keyring.gpg ]] &&
    [[ ! -f /usr/share/debian-archive-keyring.gpg ]]; then
    die "Нет debian-archive-keyring на хосте — установите пакет debian-archive-keyring"
  fi

  info "Параметры: suite=$SUITE mirror=$MIRROR arch=$ARCH components=$COMPONENTS"
}

# --- 1. Компиляция установщика ----------------------------------------------

stage_compile() {
  info "Компиляция установщика (bun build --compile)..."
  mkdir -p "$WORK"

  # Встроенные профили (P8.1): данные генерируются до компиляции, чтобы попасть в бинарь.
  (cd "$REPO_ROOT" && bun run embed:profiles)

  (cd "$REPO_ROOT" && bun build --compile --minify ./src/index.ts --outfile "$WORK/exdbnein")

  info "Бинарь: $WORK/exdbnein ($(du -h "$WORK/exdbnein" | cut -f1))"
}

# --- 2. debootstrap live-root ------------------------------------------------

stage_debootstrap() {
  if [[ "$KEEP_WORK" == "1" ]] && [[ -f "$LIVE_ROOT/etc/os-release" ]]; then
    info "live-root уже собран — пропуск debootstrap (KEEP_WORK=1)"
    return
  fi

  rm -rf "$LIVE_ROOT"
  mkdir -p "$LIVE_ROOT"

  # Комментарии и пустые строки из packages.txt не передаём в --include.
  local include
  include="$(sed -e 's/#.*//' -e '/^[[:space:]]*$/d' "$PACKAGES_FILE" | tr '\n' ',' | sed 's/,$//')"
  [[ -n "$include" ]] || die "packages.txt пуст"

  info "debootstrap: suite=$SUITE arch=$ARCH (это займёт несколько минут)..."
  debootstrap \
    --arch="$ARCH" \
    --variant=minbase \
    --components="$COMPONENTS" \
    --include="$include" \
    "$SUITE" "$LIVE_ROOT" "$MIRROR"
}

# --- Псевдо-ФС для работы внутри chroot --------------------------------------

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

# --- 3. Кастомизация live-root -----------------------------------------------

stage_customize() {
  info "Кастомизация live-root..."

  # Маркер LiveCD (P8.2): его проверяет этап 3 (src/system/environment.ts).
  touch "$LIVE_ROOT/etc/exdbnein-live"

  # Установщик + профили. Встроенные в бинарь — для рантайма; YAML рядом — для отладки.
  mkdir -p "$LIVE_ROOT/opt/exdbnein/profiles"
  install -m 0755 "$WORK/exdbnein" "$LIVE_ROOT/opt/exdbnein/exdbnein"
  cp -a "$REPO_ROOT"/profiles/*.yaml "$LIVE_ROOT/opt/exdbnein/profiles/"

  # Overlay: автозапуск на tty1 (P8.3).
  cp -a "$OVERLAY/." "$LIVE_ROOT/"

  # Действия внутри chroot — в subshell с trap, чтобы псевдо-ФС размонтировались
  # даже при ошибке (аналогично P7.3).
  (
    trap unmount_pseudo EXIT
    mount_pseudo

    # resolv.conf → stub systemd-resolved (сеть из коробки).
    ln -sfn /run/systemd/resolve/stub-resolv.conf "$LIVE_ROOT/etc/resolv.conf"

    # Live-пользователь для отладки на tty2 (в установленной системе его нет).
    chroot "$LIVE_ROOT" useradd -m -s /bin/bash live || true
    chroot "$LIVE_ROOT" sh -c "echo 'live:live' | chpasswd"
    chroot "$LIVE_ROOT" sh -c "echo 'live ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/live"
    chroot "$LIVE_ROOT" chmod 440 /etc/sudoers.d/live

    # Сервисы: NetworkManager (проводные + WiFi, nmtui), resolved для DNS,
    # tty2 для отладки (tty1 занимает установщик).
    chroot "$LIVE_ROOT" systemctl enable NetworkManager.service systemd-resolved.service getty@tty2.service

    # initramfs пересобирается, чтобы включить хуки live-boot.
    chroot "$LIVE_ROOT" update-initramfs -u -k all

    # Очистка.
    chroot "$LIVE_ROOT" apt-get clean
    rm -rf "$LIVE_ROOT"/var/cache/apt/archives/*.deb
    rm -rf "$LIVE_ROOT"/tmp/*
  )
}

# --- 4. squashfs ---------------------------------------------------------------

stage_squashfs() {
  info "Сборка filesystem.squashfs (zstd)..."
  mkdir -p "$ISO_ROOT/live"

  mksquashfs "$LIVE_ROOT" "$ISO_ROOT/live/filesystem.squashfs" \
    -noappend -comp zstd -Xcompression-level 12 -processors "$(nproc)"

  info "squashfs: $(du -h "$ISO_ROOT/live/filesystem.squashfs" | cut -f1)"
}

# --- 5. Ядро, initramfs и grub.cfg для ISO ------------------------------------

stage_boot_files() {
  info "Копирование ядра и initramfs в структуру ISO..."

  local kernel initrd
  kernel="$(find "$LIVE_ROOT/boot" -maxdepth 1 -name 'vmlinuz-*' -type f -print -quit)"
  initrd="$(find "$LIVE_ROOT/boot" -maxdepth 1 -name 'initrd.img-*' -type f -print -quit)"
  [[ -n "$kernel" ]] || die "Нет vmlinuz-* в live-root — linux-image-amd64 не установился"
  [[ -n "$initrd" ]] || die "Нет initrd.img-* в live-root — initramfs-tools не сработал"

  mkdir -p "$ISO_ROOT/live" "$ISO_ROOT/boot/grub"
  install -m 0644 "$kernel" "$ISO_ROOT/live/vmlinuz"
  install -m 0644 "$initrd" "$ISO_ROOT/live/initrd.img"
  cp "$GRUB_CFG" "$ISO_ROOT/boot/grub/grub.cfg"
}

# --- 6. Гибридный ISO (BIOS+UEFI) ----------------------------------------------

stage_iso() {
  info "Сборка гибридного ISO через grub-mkrescue (xorriso)..."
  mkdir -p "$OUT"

  SOURCE_DATE_EPOCH="$SOURCE_DATE_EPOCH" grub-mkrescue \
    -o "$OUT/$ISO_NAME" \
    "$ISO_ROOT" \
    -- -volid "$VOLID" -padding 0 -joliet on

  info "Готово: $OUT/$ISO_NAME ($(du -h "$OUT/$ISO_NAME" | cut -f1))"
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

LiveCD собран: $OUT/$ISO_NAME
Проверка в QEMU (этап 9):
  qemu-system-x86_64 -m 2048 -boot d -cdrom "$OUT/$ISO_NAME"
EOF
}

main "$@"
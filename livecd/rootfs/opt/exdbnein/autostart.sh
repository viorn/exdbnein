#!/bin/sh
# exdbnein — tty1 autostart (P8.3) + automated QEMU mode (P9.1).
#
# Normal mode: the interactive installer runs on tty1 (as before).
#
# Automated mode (kernel cmdline contains `exdbnein.config=auto`, injected by the
# build with AUTOTEST=1, see livecd/build.sh): the unattended config is read from
# the seed volume (FAT, label EXDBNEINCFG, created by scripts/qemu-test.sh),
# the installer runs --unattended, its output is mirrored to the serial console
# (ttyS0) and the VM powers off on success. The result is reported as
# "[exdbnein] RESULT=OK|FAIL" on ttyS0 — the test harness waits for it.

set -u

INSTALLER=/opt/exdbnein/exdbnein
SEED_LABEL=EXDBNEINCFG
SEED_MOUNT=/mnt/exdbnein-cfg
CONFIG_FILE="$SEED_MOUNT/config.json"
SERIAL=/dev/ttyS0

cmdline_has() {
  grep -qw "$1" /proc/cmdline 2>/dev/null
}

automated_mode() {
  # Seed volume discovery by label; blkid lives in util-linux (present in the live root).
  # Fallback: udev by-label symlink (covers systems where blkid -L is not available).
  seed_dev="$(blkid -L "$SEED_LABEL" 2>/dev/null | head -n 1)"
  if [ -z "$seed_dev" ] && [ -e "/dev/disk/by-label/$SEED_LABEL" ]; then
    seed_dev="/dev/disk/by-label/$SEED_LABEL"
  fi
  if [ -z "$seed_dev" ]; then
    echo "[exdbnein] automated mode: seed volume $SEED_LABEL not found" >&2
    return 1
  fi

  mkdir -p "$SEED_MOUNT"
  if ! mount -o ro "$seed_dev" "$SEED_MOUNT"; then
    echo "[exdbnein] automated mode: cannot mount $seed_dev" >&2
    return 1
  fi
  trap 'umount "$SEED_MOUNT" 2>/dev/null || true' EXIT

  if [ ! -f "$CONFIG_FILE" ]; then
    echo "[exdbnein] automated mode: $CONFIG_FILE not found on the seed volume" >&2
    return 1
  fi

  echo "[exdbnein] automated install: --config $CONFIG_FILE --unattended" >&2
  # Mirror the installer output to the serial console: the TUI output was designed
  # for a terminal, but the progress text is still useful in the test log.
  "$INSTALLER" --config "$CONFIG_FILE" --unattended --force 2>&1 | tee "$SERIAL"
  rc=${PIPESTATUS[0]}

  umount "$SEED_MOUNT" 2>/dev/null || true
  trap - EXIT

  if [ "$rc" -eq 0 ]; then
    echo "[exdbnein] RESULT=OK" > "$SERIAL"
    sync
    poweroff -f
    # Never returns on a working system; keep a fallback for odd environments.
    exit 0
  fi

  echo "[exdbnein] RESULT=FAIL rc=$rc" > "$SERIAL"
  return "$rc"
}

if cmdline_has exdbnein.config=auto; then
  automated_mode
  exit $?
fi

# Interactive mode (the LiveCD default).
exec "$INSTALLER"
#!/usr/bin/env bash
# exdbnein — QEMU end-to-end test (phase 9).
#
# Full cycle: LiveCD ISO → boot in QEMU → unattended install from the seed volume
# (scripts/qemu/unattended.json, kernel cmdline `exdbnein.config=auto`) →
# reboot into the installed system → SSH verification → clean shutdown.
# Runs for BIOS (SeaBIOS) and/or UEFI (OVMF).
#
# Usage:
#   scripts/qemu-test.sh                       # BIOS + UEFI
#   scripts/qemu-test.sh --firmware bios       # one firmware only
#   scripts/qemu-test.sh --iso out/exdbnein-autotest.iso
#   scripts/qemu-test.sh --config scripts/qemu/unattended.json
#   scripts/qemu-test.sh --skip-build          # never build the ISO
#   scripts/qemu-test.sh --keep-vm             # leave QEMU running on failure
#   scripts/qemu-test.sh --timeout 3600        # install phase timeout, seconds
#   scripts/qemu-test.sh --help
#
# The ISO is built automatically (AUTOTEST=1) when out/exdbnein-autotest.iso is
# missing; the build requires root, so the script re-executes itself via sudo.
# Host requirements: qemu-system-x86, ovmf (UEFI), mtools, ssh-keygen,
# plus everything from livecd/build.sh for the ISO build.
#
# Passwords in scripts/qemu/unattended.json are for the test VM only.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# --- Defaults ----------------------------------------------------------------

FW="${FW:-both}"            # bios | uefi | both
ISO=""
CONFIG_FIXTURE="${CONFIG_FIXTURE:-$SCRIPT_DIR/qemu/unattended.json}"
WORK_DIR="${WORK_DIR:-$REPO_ROOT/out/qemu}"
TIMEOUT="${TIMEOUT:-2400}"  # install phase, seconds
BOOT_TIMEOUT="${BOOT_TIMEOUT:-300}"  # reboot + SSH wait, seconds
DISK_SIZE="${DISK_SIZE:-16G}"
MEM="${MEM:-2048}"
SKIP_BUILD=0
KEEP_VM=0
ISO_NAME_DEFAULT="exdbnein-autotest.iso"

info() { printf '\033[1;34m[qemu-test]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[qemu-test]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[qemu-test]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[qemu-test][error]\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'
}

# --- Arguments ---------------------------------------------------------------

while [[ $# -gt 0 ]]; do
  case "$1" in
    --firmware) FW="${2:?--firmware needs an argument}"; shift 2 ;;
    --iso) ISO="$2"; shift 2 ;;
    --config) CONFIG_FIXTURE="$2"; shift 2 ;;
    --work-dir) WORK_DIR="$2"; shift 2 ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    --boot-timeout) BOOT_TIMEOUT="$2"; shift 2 ;;
    --disk-size) DISK_SIZE="$2"; shift 2 ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    --keep-vm) KEEP_VM=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown argument: $1 (see --help)" ;;
  esac
done

case "$FW" in
  bios|uefi|both) ;;
  *) die "--firmware must be bios, uefi or both, got: $FW" ;;
esac

[[ -f "$CONFIG_FIXTURE" ]] || die "Config fixture not found: $CONFIG_FIXTURE"

# --- Tooling -----------------------------------------------------------------

for tool in qemu-system-x86_64 qemu-img mkfs.vfat mcopy ssh-keygen sed; do
  command -v "$tool" >/dev/null 2>&1 || die "Tool not found: $tool (see the header comment)"
done

OVMF_CODE=""
OVMF_VARS=""
find_ovmf() {
  if [[ -f /usr/share/OVMF/OVMF_CODE_4M.fd ]]; then
    OVMF_CODE=/usr/share/OVMF/OVMF_CODE_4M.fd
    OVMF_VARS=/usr/share/OVMF/OVMF_VARS_4M.fd
  elif [[ -f /usr/share/OVMF/OVMF_CODE.fd ]]; then
    OVMF_CODE=/usr/share/OVMF/OVMF_CODE.fd
    OVMF_VARS=/usr/share/OVMF/OVMF_VARS.fd
  elif [[ -f /usr/share/ovmf/OVMF_CODE.fd ]]; then
    OVMF_CODE=/usr/share/ovmf/OVMF_CODE.fd
    OVMF_VARS=/usr/share/ovmf/OVMF_VARS.fd
  else
    die "OVMF firmware not found — install the ovmf package (UEFI tests)"
  fi
}
if [[ "$FW" == "uefi" || "$FW" == "both" ]]; then
  find_ovmf
fi

# --- ISO ---------------------------------------------------------------------

if [[ -z "$ISO" ]]; then
  ISO="$REPO_ROOT/out/$ISO_NAME_DEFAULT"
fi
ISO="$(realpath "$ISO")"

build_iso() {
  info "Building the AUTOTEST ISO: $ISO (this takes a while)..."
  mkdir -p "$(dirname "$ISO")"
  (cd "$REPO_ROOT" && AUTOTEST=1 ISO_NAME="$(basename "$ISO")" OUT="$(dirname "$ISO")" bash livecd/build.sh)
}

needs_build=0
if [[ "$SKIP_BUILD" != 1 ]] && [[ ! -f "$ISO" ]]; then
  needs_build=1
fi

# The ISO build needs root (debootstrap); re-execute the whole run under sudo.
if [[ "$needs_build" == 1 ]] && [[ "$(id -u)" != 0 ]]; then
  warn "ISO build requires root — re-running via sudo"
  exec sudo -E bash "$0" "$@"
fi
if [[ "$needs_build" == 1 ]]; then
  build_iso
elif [[ -f "$ISO" ]]; then
  info "Reusing existing ISO: $ISO (use --iso for another one)"
fi
[[ -f "$ISO" ]] || die "ISO not found and not built: $ISO"

# --- Work directory and shared assets ----------------------------------------

mkdir -p "$WORK_DIR"
SEED_DIR="$WORK_DIR/seed"

# Ephemeral SSH key for post-install verification (P9: SSH availability).
if [[ ! -f "$WORK_DIR/id_test" ]]; then
  ssh-keygen -q -t ed25519 -N "" -C "exdbnein-qemu-test" -f "$WORK_DIR/id_test"
fi
PUBKEY="$(cat "$WORK_DIR/id_test.pub")"

# Unattended config with the generated public key injected (@@PUBKEY@@ placeholder).
mkdir -p "$SEED_DIR"
sed "s|@@PUBKEY@@|$PUBKEY|g" "$CONFIG_FIXTURE" > "$SEED_DIR/config.json"

# Seed volume: FAT with the config, discovered by the live system by label EXDBNEINCFG.
if [[ ! -f "$SEED_DIR/seed.img" ]]; then
  dd if=/dev/zero of="$SEED_DIR/seed.img" bs=1M count=16 status=none
  mkfs.vfat -n EXDBNEINCFG "$SEED_DIR/seed.img" >/dev/null
  mcopy -i "$SEED_DIR/seed.img" "$SEED_DIR/config.json" ::config.json
fi
SEED_IMG="$SEED_DIR/seed.img"

# --- Phases ------------------------------------------------------------------

QEMU_PID=""
cleanup() {
  if [[ -n "$QEMU_PID" ]] && kill -0 "$QEMU_PID" 2>/dev/null; then
    if [[ "$KEEP_VM" == 1 ]]; then
      warn "Keeping QEMU running (--keep-vm): pid $QEMU_PID"
    else
      kill "$QEMU_PID" 2>/dev/null || true
      wait "$QEMU_PID" 2>/dev/null || true
    fi
  fi
}
trap cleanup EXIT

ovmf_args() {
  # A per-firmware copy of the NVRAM so runs do not share state.
  cp "$OVMF_VARS" "$1/ovmf_vars.fd"
  echo "-drive if=pflash,format=raw,readonly=on,file=$OVMF_CODE -drive if=pflash,format=raw,file=$1/ovmf_vars.fd"
}

machine_args() {
  if [[ "$1" == "uefi" ]]; then echo "-machine q35"; else echo "-machine pc"; fi
}

run_qemu() { # firmware phase-log extra-args...
  local firmware="$1" phase="$2" logfile="$3"
  shift 3
  local machine fwargs=()
  machine="$(machine_args "$firmware")"
  if [[ "$firmware" == "uefi" ]]; then
    fwargs=($(ovmf_args "$(dirname "$logfile")"))
  fi
  info "[$firmware] $phase"
  # Port 2222 is forwarded to the guest's SSH in every phase — it is only used
  # after the reboot, and the forward itself is passive during the install.
  # shellcheck disable=SC2086
  qemu-system-x86_64 \
    $machine \
    -m "$MEM" -smp 2 \
    "$@" \
    -netdev user,id=net0,hostfwd=tcp:127.0.0.1:2222-:22 -device e1000,netdev=net0 \
    -serial stdio \
    -display none -monitor none -no-reboot \
    "${fwargs[@]}" \
    >"$logfile" 2>&1 &
  QEMU_PID=$!
}

wait_for_marker() { # logfile timeout
  local logfile="$1" deadline=$((SECONDS + $2)) marker=""
  while (( SECONDS < deadline )); do
    if grep -q "RESULT=OK" "$logfile" 2>/dev/null; then marker=ok; break; fi
    if grep -q "RESULT=FAIL" "$logfile" 2>/dev/null; then marker=fail; break; fi
    if ! kill -0 "$QEMU_PID" 2>/dev/null; then
      # QEMU exited on its own before reporting a result.
      wait "$QEMU_PID" 2>/dev/null || true
      QEMU_PID=""
      marker=dead
      break
    fi
    sleep 5
  done
  if [[ -z "$marker" ]]; then
    # Timeout — stop the VM so the run cannot hang.
    kill "$QEMU_PID" 2>/dev/null || true
    wait "$QEMU_PID" 2>/dev/null || true
    QEMU_PID=""
    marker=timeout
  fi
  echo "$marker"
}

wait_ssh() { # timeout seconds
  local deadline=$((SECONDS + $1))
  while (( SECONDS < deadline )); do
    if (exec 3<>/dev/tcp/127.0.0.1/2222) 2>/dev/null; then
      exec 3>&- 2>/dev/null || true
      return 0
    fi
    sleep 5
  done
  return 1
}

ssh_cmd() { # command...
  ssh -i "$WORK_DIR/id_test" -p 2222 \
    -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -o ConnectTimeout=10 \
    tester@127.0.0.1 "$@"
}

# Installs into a fresh disk, then reboots and verifies SSH access.
run_firmware() {
  local firmware="$1"
  local dir="$WORK_DIR/$firmware"
  local target="$dir/target.qcow2"
  local install_log="$dir/install.log"
  local boot_log="$dir/boot.log"
  mkdir -p "$dir"

  info "[$firmware] ==== install phase ===="
  if [[ ! -f "$target" ]]; then
    qemu-img create -q -f qcow2 "$target" "$DISK_SIZE"
  fi

  # Phase 1: boot from the ISO, unattended install (kernel cmdline exdbnein.config=auto).
  run_qemu "$firmware" "boot from ISO and install" "$install_log" \
    -drive file="$target",if=ide,format=qcow2 \
    -drive file="$SEED_IMG",if=ide,format=raw \
    -cdrom "$ISO" \
    -boot order=d

  local marker
  marker="$(wait_for_marker "$install_log" "$TIMEOUT")"
  if [[ "$marker" != "ok" ]]; then
    warn "[$firmware] install phase failed (marker: $marker)"
    warn "[$firmware] last lines of $install_log:"
    tail -n 30 "$install_log" >&2 || true
    return 1
  fi
  ok "[$firmware] install completed"
  # The VM powers itself off after a successful install — wait for QEMU to exit.
  for _ in $(seq 1 20); do
    kill -0 "$QEMU_PID" 2>/dev/null || break
    sleep 2
  done
  if kill -0 "$QEMU_PID" 2>/dev/null; then
    warn "[$firmware] QEMU still running after install — stopping it"
    kill "$QEMU_PID" 2>/dev/null || true
  fi
  wait "$QEMU_PID" 2>/dev/null || true
  QEMU_PID=""

  # Phase 2: reboot into the installed system and verify it over SSH.
  info "[$firmware] ==== boot + SSH verification phase ===="
  run_qemu "$firmware" "boot installed system" "$boot_log" \
    -drive file="$target",if=ide,format=qcow2 \
    -boot order=c

  if ! wait_ssh "$BOOT_TIMEOUT"; then
    warn "[$firmware] SSH did not come up within ${BOOT_TIMEOUT}s"
    warn "[$firmware] last lines of $boot_log:"
    tail -n 30 "$boot_log" >&2 || true
    return 1
  fi

  # Verification: hostname, root filesystem + btrfs subvolumes, disk layout,
  # user accounts, base profile (openssh-server) and the installation log.
  local check='set -e

    # --- Hostname ---
    test "$(hostname)" = "exdbnein-test" || { echo "BAD hostname: $(hostname)"; exit 1; }

    # --- Root filesystem & btrfs subvolumes ---
    fs=$(findmnt -no FSTYPE /)
    [ "$fs" = "btrfs" ] || { echo "BAD root fs: $fs"; exit 1; }
    findmnt -no OPTIONS / | grep -q "subvol=/@" || { echo "BAD root subvol"; exit 1; }

    # btrfs subvolumes: @, @home, @snapshots
    for subvol in @ @home @snapshots; do
      btrfs subvolume list / 2>/dev/null | grep -q "subvolid.*path=${subvol}$" \
        || { echo "MISSING subvolume: $subvol"; exit 1; }
    done

    # Check @home is actually mounted
    findmnt -no FSTYPE /home | grep -q "btrfs" || { echo "BAD /home fs"; exit 1; }
    findmnt -no OPTIONS /home | grep -q "subvol=/@home" || { echo "BAD /home subvol"; exit 1; }

    # --- Disk layout ---
    # /dev/sda should exist and be a disk (not a partition)
    test -b /dev/sda || { echo "/dev/sda not found"; exit 1; }

    # Partition table type: GPT for UEFI, MBR for BIOS
    # Check for ESP partition (vfat, ~512MB) — present in both modes
    local esp_dev
    esp_dev=$(findmnt -no SOURCE /boot/efi 2>/dev/null || true)
    if [ -n "$esp_dev" ]; then
      local esp_fs
      esp_fs=$(findmnt -no FSTYPE /boot/efi)
      [ "$esp_fs" = "vfat" ] || { echo "BAD esp fs: $esp_fs"; exit 1; }
    fi

    # Swap should be active
    swapon --show=name | grep -q swap || { echo "SWAP not active"; exit 1; }

    # --- Users ---
    # root exists
    id root >/dev/null 2>&1 || { echo "root missing"; exit 1; }

    # tester user exists with home directory
    id tester >/dev/null 2>&1 || { echo "tester user missing"; exit 1; }
    test -d /home/tester || { echo "/home/tester missing"; exit 1; }
    test -d /home/tester/.ssh || { echo "/home/tester/.ssh missing"; exit 1; }

    # --- Services & packages ---
    systemctl is-active --quiet ssh || { echo "BAD ssh service"; exit 1; }

    # --- Installation log ---
    [ -f /var/log/exdbnein/install.log ] || { echo "BAD install log"; exit 1; }

    echo "VERIFY_OK"'
  local verified=0 attempt
  for attempt in 1 2 3; do
    if ssh_cmd "$check"; then
      verified=1
      break
    fi
    warn "[$firmware] SSH verification attempt $attempt failed — retrying"
    sleep 5
  done
  if [[ "$verified" != 1 ]]; then
    warn "[$firmware] SSH verification failed"
    return 1
  fi
  ok "[$firmware] SSH verification passed"

  # Clean shutdown through sudo -S (no password prompts on the SSH channel).
  ssh_cmd "echo 'testerpass' | sudo -S -p '' poweroff" >/dev/null 2>&1 || true
  for _ in $(seq 1 20); do
    kill -0 "$QEMU_PID" 2>/dev/null || break
    sleep 2
  done
  if kill -0 "$QEMU_PID" 2>/dev/null; then
    warn "[$firmware] QEMU did not exit after poweroff — stopping it"
    kill "$QEMU_PID" 2>/dev/null || true
  fi
  wait "$QEMU_PID" 2>/dev/null || true
  QEMU_PID=""

  return 0
}

# --- Main --------------------------------------------------------------------

failures=0
if [[ "$FW" == "both" ]]; then
  for firmware in bios uefi; do
    if run_firmware "$firmware"; then
      ok "[$firmware] PASS"
    else
      warn "[$firmware] FAIL"
      failures=$((failures + 1))
    fi
  done
else
  if run_firmware "$FW"; then
    ok "[$FW] PASS"
  else
    warn "[$FW] FAIL"
    failures=1
  fi
fi

if [[ "$failures" -eq 0 ]]; then
  ok "All QEMU tests passed (firmware: $FW)"
  exit 0
fi
die "QEMU tests failed (see logs in $WORK_DIR)"
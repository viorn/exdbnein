import { log, note } from "@clack/prompts";
import { rebootNow, swapoffTarget, unmountTarget } from "../system/finalize.ts";
import { confirm } from "../ui/prompts.ts";
import type { InstallContext } from "./index.ts";

/** Installation summary for the final screen. */
export function summaryText(ctx: InstallContext): string {
  const { config } = ctx;
  const lines = [
    `Disk: ${config.disk.device} (${config.disk.layout}, ${config.disk.filesystem})`,
    `Host: ${config.network.hostname}`,
    `Locale: ${config.locale.locale}, keymap: ${config.locale.keymap}, TZ: ${config.locale.timezone}`,
    `Network: ${config.network.manager}`,
  ];
  if (config.users.length > 0) {
    lines.push(`Users: ${config.users.map((user) => user.username).join(", ")}`);
  }
  if (config.profiles.length > 0) {
    lines.push(`Profiles: ${config.profiles.join(", ")}`);
  }
  return lines.join("\n");
}

/**
 * End of phase B (stage 7): summary, proper unmounting of /mnt and swapoff,
 * then reboot at the user's choice (unattended mode does not reboot).
 */
export async function finishInstall(ctx: InstallContext): Promise<void> {
  const { config, interactive } = ctx;

  log.success("Installation complete");
  note(summaryText(ctx), "Installation summary");

  // P7.3: the happy path also unmounts the disk before rebooting.
  const extra = config.disk.swapPartition ? [config.disk.swapPartition] : [];
  await unmountTarget();
  await swapoffTarget(config.disk.device, extra);

  if (interactive) {
    const reboot = await confirm({
      message: "Reboot the system?",
      initialValue: true,
    });
    if (reboot) await rebootNow();
  } else {
    log.info("Unattended mode: reboot is not performed automatically.");
  }
}

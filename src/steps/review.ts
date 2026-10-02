import { note } from "@clack/prompts";
import type { DiskConfig, InstallConfig } from "../config/types.ts";
import { validateConfig } from "../config/validate.ts";
import { checkNetwork } from "../system/environment.ts";
import { backOption, isBack, select } from "../ui/prompts.ts";
import type { Step, StepResult } from "../ui/wizard.ts";

function formatDisk(disk: DiskConfig): string {
  if (disk.layout === "keep") {
    const esp = disk.espPartition ? `, ESP ${disk.espPartition}` : "";
    return `${disk.device} → root ${disk.rootPartition ?? "?"}${esp}`;
  }
  return `${disk.device} (${disk.filesystem}, ${disk.layout})`;
}

function formatSummary(config: InstallConfig): string {
  const lines = [
    `Disk:        ${formatDisk(config.disk)}`,
    `Swap:        ${config.disk.swap ? `${config.disk.swapSizeGiB} GiB` : "none"}`,
    `Hostname:    ${config.network.hostname}`,
    `Network:     ${config.network.manager}`,
    `Locale:      ${config.locale.locale}`,
    `Keymap:      ${config.locale.keymap}`,
    `Time zone:   ${config.locale.timezone}`,
    `Profiles:    ${config.profiles.length ? config.profiles.join(", ") : "none"}`,
    `Users:       ${config.users.map((u) => u.username).join(", ") || "none"}`,
    `Bootloader:  ${config.bootloader.type}`,
    `Mirror:      ${config.mirror}`,
  ];
  return lines.join("\n");
}

export const reviewStep: Step = {
  id: "review",
  title: "Review",
  async run({ config }): Promise<StepResult> {
    const issues = validateConfig(config);
    if (issues.length > 0) {
      const text = issues.map((i) => `• ${i.path}: ${i.message}`).join("\n");
      const hint = config.unattended
        ? "\n\nIn unattended mode a complete config is required (--config <file>)."
        : "";
      throw new Error(`Invalid configuration:\n${text}${hint}`);
    }

    // Soft warning about an unreachable mirror (does not block the installation).
    const reachable = await checkNetwork(config.mirror, 5000);
    if (!reachable) {
      note("Mirror is unreachable — check the network or use another mirror.", "Warning");
    }

    note(formatSummary(config), "Installation plan");

    // In unattended mode the review is confirmed automatically.
    if (config.unattended) return { type: "continue" };

    const choice = await select<string>({
      message: "Start installation?",
      initialValue: "install",
      options: [{ value: "install", label: "Start installation" }, backOption()],
    });

    return isBack(choice) ? { type: "back" } : { type: "continue" };
  },
};

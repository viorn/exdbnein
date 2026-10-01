import { note } from "@clack/prompts";
import { validateConfig } from "../config/validate.ts";
import { confirm } from "../ui/prompts.ts";
import type { Step, StepResult } from "../ui/wizard.ts";

function formatSummary(config: import("../config/types.ts").InstallConfig): string {
  const lines = [
    `Диск:        ${config.disk.device} (${config.disk.filesystem}, layout: ${config.disk.layout})`,
    `Swap:        ${config.disk.swap ? `${config.disk.swapSizeGiB} GiB` : "нет"}`,
    `Hostname:    ${config.network.hostname}`,
    `Сеть:        ${config.network.manager}`,
    `Локаль:      ${config.locale.locale}`,
    `Раскладка:   ${config.locale.keymap}`,
    `Часовой пояс:${config.locale.timezone}`,
    `Профили:     ${config.profiles.length ? config.profiles.join(", ") : "нет"}`,
    `Пользователи:${config.users.map((u) => u.username).join(", ") || "нет"}`,
    `Загрузчик:   ${config.bootloader.type}`,
    `Зеркало:     ${config.mirror}`,
  ];
  return lines.join("\n");
}

export const reviewStep: Step = {
  id: "review",
  title: "Проверка",
  async run({ config }): Promise<StepResult> {
    const issues = validateConfig(config);
    if (issues.length > 0) {
      const text = issues.map((i) => `• ${i.path}: ${i.message}`).join("\n");
      throw new Error(`Конфигурация невалидна:\n${text}`);
    }

    note(formatSummary(config), "План установки");

    if (config.unattended) return { type: "continue" };

    const ok = await confirm({ message: "Начать установку?", initialValue: false });
    if (!ok) {
      throw new Error("Установка отменена пользователем");
    }

    return { type: "continue" };
  },
};

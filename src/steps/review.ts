import { note } from "@clack/prompts";
import { validateConfig } from "../config/validate.ts";
import { backOption, isBack, select } from "../ui/prompts.ts";
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
      const hint = config.unattended
        ? "\n\nВ авторежиме требуется полный конфиг (--config <file>)."
        : "";
      throw new Error(`Конфигурация невалидна:\n${text}${hint}`);
    }

    note(formatSummary(config), "План установки");

    // В авторежиме ревью подтверждается автоматически.
    if (config.unattended) return { type: "continue" };

    const choice = await select<string>({
      message: "Начать установку?",
      initialValue: "install",
      options: [{ value: "install", label: "Начать установку" }, backOption()],
    });

    return isBack(choice) ? { type: "back" } : { type: "continue" };
  },
};

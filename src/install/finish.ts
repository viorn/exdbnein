import { log, note } from "@clack/prompts";
import { rebootNow, swapoffTarget, unmountTarget } from "../system/finalize.ts";
import { confirm } from "../ui/prompts.ts";
import type { InstallContext } from "./index.ts";

/** Сводка установки для финального экрана. */
export function summaryText(ctx: InstallContext): string {
  const { config } = ctx;
  const lines = [
    `Диск: ${config.disk.device} (${config.disk.layout}, ${config.disk.filesystem})`,
    `Хост: ${config.network.hostname}`,
    `Локаль: ${config.locale.locale}, раскладка: ${config.locale.keymap}, TZ: ${config.locale.timezone}`,
    `Сеть: ${config.network.manager}`,
  ];
  if (config.users.length > 0) {
    lines.push(`Пользователи: ${config.users.map((user) => user.username).join(", ")}`);
  }
  if (config.profiles.length > 0) {
    lines.push(`Профили: ${config.profiles.join(", ")}`);
  }
  return lines.join("\n");
}

/**
 * Финал фазы B (этап 7): сводка, корректное размонтирование /mnt и swapoff,
 * затем reboot по выбору пользователя (в авторежиме перезагрузка не выполняется).
 */
export async function finishInstall(ctx: InstallContext): Promise<void> {
  const { config, interactive } = ctx;

  log.success("Установка завершена");
  note(summaryText(ctx), "Итог установки");

  // P7.3: happy-path тоже размонтирует диск перед перезагрузкой.
  const extra = config.disk.swapPartition ? [config.disk.swapPartition] : [];
  await unmountTarget();
  await swapoffTarget(config.disk.device, extra);

  if (interactive) {
    const reboot = await confirm({
      message: "Перезагрузить систему?",
      initialValue: true,
    });
    if (reboot) await rebootNow();
  } else {
    log.info("Авторежим: перезагрузка не выполняется автоматически.");
  }
}

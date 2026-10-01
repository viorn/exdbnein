import type { NetworkConfig } from "../config/types.ts";
import { backOption, isBack, select, text } from "../ui/prompts.ts";
import type { Step, StepResult } from "../ui/wizard.ts";

export const networkStep: Step = {
  id: "network",
  title: "Сеть",
  async run({ config }): Promise<StepResult> {
    config.network.hostname = await text({
      message: "Имя компьютера (hostname)",
      defaultValue: config.network.hostname,
      validate: (value) => {
        if (!value) return "Укажите hostname";
        if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(value)) {
          return "Некорректный hostname";
        }
        return undefined;
      },
    });

    const manager = await select<string>({
      message: "Менеджер сети",
      initialValue: config.network.manager,
      options: [
        { value: "networkmanager", label: "NetworkManager", hint: "для десктопа" },
        { value: "systemd-networkd", label: "systemd-networkd", hint: "минималистично" },
        { value: "none", label: "Не настраивать" },
        backOption(),
      ],
    });

    if (isBack(manager)) return { type: "back" };
    config.network.manager = manager as NetworkConfig["manager"];

    return { type: "continue" };
  },
};

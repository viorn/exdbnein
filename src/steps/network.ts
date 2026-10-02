import type { NetworkConfig } from "../config/types.ts";
import { backOption, isBack, select, text } from "../ui/prompts.ts";
import type { Step, StepResult } from "../ui/wizard.ts";

export const networkStep: Step = {
  id: "network",
  title: "Network",
  async run({ config }): Promise<StepResult> {
    config.network.hostname = await text({
      message: "Hostname",
      defaultValue: config.network.hostname,
      validate: (value) => {
        if (!value) return "Provide a hostname";
        if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(value)) {
          return "Invalid hostname";
        }
        return undefined;
      },
    });

    const manager = await select<string>({
      message: "Network manager",
      initialValue: config.network.manager,
      options: [
        { value: "networkmanager", label: "NetworkManager", hint: "for desktop" },
        { value: "systemd-networkd", label: "systemd-networkd", hint: "minimal" },
        { value: "none", label: "Do not configure" },
        backOption(),
      ],
    });

    if (isBack(manager)) return { type: "back" };
    config.network.manager = manager as NetworkConfig["manager"];

    return { type: "continue" };
  },
};

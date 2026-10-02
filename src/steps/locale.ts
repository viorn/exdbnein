import { backOption, isBack, select, text } from "../ui/prompts.ts";
import type { Step, StepResult } from "../ui/wizard.ts";

export const localeStep: Step = {
  id: "locale",
  title: "Locale & time",
  async run({ config }): Promise<StepResult> {
    config.locale.locale = await text({
      message: "Locale",
      defaultValue: config.locale.locale,
      placeholder: "en_US.UTF-8",
    });

    config.locale.keymap = await text({
      message: "Keyboard layout",
      defaultValue: config.locale.keymap,
      placeholder: "us",
    });

    config.locale.timezone = await text({
      message: "Time zone",
      defaultValue: config.locale.timezone,
      placeholder: "UTC",
    });

    const next = await select<string>({
      message: "Continue?",
      options: [{ value: "next", label: "Continue" }, backOption()],
    });
    return isBack(next) ? { type: "back" } : { type: "continue" };
  },
};

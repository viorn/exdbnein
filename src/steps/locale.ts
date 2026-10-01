import { backOption, isBack, select, text } from "../ui/prompts.ts";
import type { Step, StepResult } from "../ui/wizard.ts";

export const localeStep: Step = {
  id: "locale",
  title: "Локаль и время",
  async run({ config }): Promise<StepResult> {
    config.locale.locale = await text({
      message: "Локаль",
      defaultValue: config.locale.locale,
      placeholder: "ru_RU.UTF-8",
    });

    config.locale.keymap = await text({
      message: "Раскладка клавиатуры",
      defaultValue: config.locale.keymap,
      placeholder: "us,ru",
    });

    config.locale.timezone = await text({
      message: "Часовой пояс",
      defaultValue: config.locale.timezone,
      placeholder: "Europe/Moscow",
    });

    const next = await select<string>({
      message: "Продолжить?",
      options: [{ value: "next", label: "Продолжить" }, backOption()],
    });
    return isBack(next) ? { type: "back" } : { type: "continue" };
  },
};

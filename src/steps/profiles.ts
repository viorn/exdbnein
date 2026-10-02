import { note } from "@clack/prompts";
import type { Profile } from "../profiles/index.ts";
import { loadProfilesOrDefault, resolveProfiles } from "../profiles/index.ts";
import { backOption, isBack, multiselect, select } from "../ui/prompts.ts";
import type { Step, StepResult } from "../ui/wizard.ts";

export interface ProfilesStepOptions {
  /** Каталог с YAML-профилями. */
  dir: string;
}

export function profilesStep(options: ProfilesStepOptions): Step {
  return {
    id: "profiles",
    title: "Профили",
    async run({ config }): Promise<StepResult> {
      let profiles: Map<string, Profile>;
      try {
        // P8.1: каталог profiles/ есть в dev, в LiveCD работают встроенные профили.
        profiles = await loadProfilesOrDefault(options.dir);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Ошибка загрузки профилей: ${message}`);
      }

      if (profiles.size === 0) return { type: "continue" };

      const selected = await multiselect({
        message: "Наборы софта",
        options: [...profiles.values()].map((profile) => ({
          value: profile.name,
          label: profile.name,
          hint: profile.description,
        })),
        initialValues: config.profiles.filter((name) => profiles.has(name)),
        required: false,
      });
      config.profiles = selected;

      // Предпросмотр итогового набора после резолва наследования.
      const merged = resolveProfiles(config.profiles, profiles);
      const packages = merged.packages.length ? merged.packages.join(", ") : "нет";
      const commands = merged.commands.length ? `${merged.commands.length} команд(ы)` : "нет";
      const files = merged.files.length ? `${merged.files.length} файл(а)` : "нет";
      note(`Пакеты: ${packages}\nКоманды: ${commands}\nФайлы: ${files}`, "Итоговый набор профилей");

      const next = await select<string>({
        message: "Продолжить?",
        options: [{ value: "next", label: "Продолжить" }, backOption()],
      });
      return isBack(next) ? { type: "back" } : { type: "continue" };
    },
  };
}

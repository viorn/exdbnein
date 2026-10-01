import { multiselect } from "../ui/prompts.ts";
import type { Step, StepResult } from "../ui/wizard.ts";

export interface ProfilesStepOptions {
  /** Каталог с YAML-профилями. */
  dir: string;
}

/** Читает имена профилей из каталога (без резолва наследования — это этап 2). */
async function listProfiles(dir: string): Promise<string[]> {
  const glob = new Bun.Glob("*.{yaml,yml}");
  const names: string[] = [];
  for await (const file of glob.scan({ cwd: dir, onlyFiles: true })) {
    names.push(file.replace(/\.(yaml|yml)$/, ""));
  }
  return names.sort();
}

export function profilesStep(options: ProfilesStepOptions): Step {
  return {
    id: "profiles",
    title: "Профили",
    async run({ config }): Promise<StepResult> {
      const available = await listProfiles(options.dir);
      if (available.length === 0) return { type: "continue" };

      config.profiles = await multiselect({
        message: "Наборы софта",
        options: available.map((name) => ({ value: name, label: name })),
        initialValues: config.profiles,
        required: false,
      });

      return { type: "continue" };
    },
  };
}

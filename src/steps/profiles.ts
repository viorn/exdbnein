import { note } from "@clack/prompts";
import type { Profile } from "../profiles/index.ts";
import { loadProfilesOrDefault, resolveProfiles } from "../profiles/index.ts";
import { backOption, isBack, multiselect, select } from "../ui/prompts.ts";
import type { Step, StepResult } from "../ui/wizard.ts";

export interface ProfilesStepOptions {
  /** Directory with YAML profiles. */
  dir: string;
}

export function profilesStep(options: ProfilesStepOptions): Step {
  return {
    id: "profiles",
    title: "Profiles",
    async run({ config }): Promise<StepResult> {
      let profiles: Map<string, Profile>;
      try {
        // P8.1: the profiles/ directory exists in dev; the LiveCD uses embedded profiles.
        profiles = await loadProfilesOrDefault(options.dir);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to load profiles: ${message}`);
      }

      if (profiles.size === 0) return { type: "continue" };

      const selected = await multiselect({
        message: "Software sets",
        options: [...profiles.values()].map((profile) => ({
          value: profile.name,
          label: profile.name,
          hint: profile.description,
        })),
        initialValues: config.profiles.filter((name) => profiles.has(name)),
        required: false,
      });
      config.profiles = selected;

      // Preview of the merged set after resolving inheritance.
      const merged = resolveProfiles(config.profiles, profiles);
      const packages = merged.packages.length ? merged.packages.join(", ") : "none";
      const commands = merged.commands.length ? `${merged.commands.length} command(s)` : "none";
      const files = merged.files.length ? `${merged.files.length} file(s)` : "none";
      note(`Packages: ${packages}\nCommands: ${commands}\nFiles: ${files}`, "Merged profile set");

      const next = await select<string>({
        message: "Continue?",
        options: [{ value: "next", label: "Continue" }, backOption()],
      });
      return isBack(next) ? { type: "back" } : { type: "continue" };
    },
  };
}

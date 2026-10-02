import { intro, note, outro } from "@clack/prompts";
import type { InstallConfig } from "../config/types.ts";
import { CancelledError } from "./errors.ts";

export type StepResult = { type: "continue" } | { type: "back" };

export interface StepContext {
  config: InstallConfig;
  /** 1-based step index and the total number of steps. */
  index: number;
  total: number;
}

export interface Step {
  id: string;
  title: string;
  /** Returns true if the step must be skipped with the current config. */
  skip?: (config: InstallConfig) => boolean;
  run: (ctx: StepContext) => Promise<StepResult>;
}

export interface WizardOptions {
  title: string;
  steps: Step[];
  config: InstallConfig;
  /** Called after every step — e.g. to auto-save the config. */
  onStepDone?: (step: Step, config: InstallConfig) => Promise<void> | void;
}

/** Runs the wizard steps sequentially, mutating the shared config. */
export async function runWizard(options: WizardOptions): Promise<InstallConfig> {
  const { title, steps, config } = options;
  const active = steps.filter((step) => !step.skip?.(config));

  intro(title);

  /** Stack: on back we return to the step with this index. */
  const stack: number[] = [];

  let i = 0;
  while (i < active.length) {
    const step = active[i];
    if (!step) {
      i++;
      continue;
    }
    note(`Step ${i + 1} of ${active.length}`, step.title);
    const result = await step.run({ config, index: i + 1, total: active.length });

    await options.onStepDone?.(step, config);

    if (result.type === "back") {
      // On the first step there is nowhere to go back — just restart it.
      const prev = stack.pop();
      if (prev !== undefined) i = prev;
    } else {
      // On a successful step push the *current* step onto the stack (where back returns).
      stack.push(i);
      i++;
    }
  }

  outro("Done");
  return config;
}

export { CancelledError };

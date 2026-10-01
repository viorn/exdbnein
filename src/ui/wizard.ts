import { intro, note, outro } from "@clack/prompts";
import type { InstallConfig } from "../config/types.ts";
import { CancelledError } from "./errors.ts";

export type StepResult = { type: "continue" } | { type: "back" };

export interface StepContext {
  config: InstallConfig;
  /** Номер шага (1-based) и общее число шагов. */
  index: number;
  total: number;
}

export interface Step {
  id: string;
  title: string;
  /** Возвращает true, если шаг нужно пропустить при текущем конфиге. */
  skip?: (config: InstallConfig) => boolean;
  run: (ctx: StepContext) => Promise<StepResult>;
}

export interface WizardOptions {
  title: string;
  steps: Step[];
  config: InstallConfig;
  /** Вызывается после каждого шага — например, для автосохранения конфига. */
  onStepDone?: (step: Step, config: InstallConfig) => Promise<void> | void;
}

/** Последовательно выполняет шаги визарда, мутируя общий конфиг. */
export async function runWizard(options: WizardOptions): Promise<InstallConfig> {
  const { title, steps, config } = options;
  const active = steps.filter((step) => !step.skip?.(config));

  intro(title);

  /** Стек: при back возвращаемся к шагу с этим индексом. */
  const stack: number[] = [];

  let i = 0;
  while (i < active.length) {
    const step = active[i];
    if (!step) {
      i++;
      continue;
    }
    note(`Шаг ${i + 1} из ${active.length}`, step.title);
    const result = await step.run({ config, index: i + 1, total: active.length });

    await options.onStepDone?.(step, config);

    if (result.type === "back") {
      // На первом шаге возвращаться некуда — просто перезапускаем его.
      const prev = stack.pop();
      if (prev !== undefined) i = prev;
    } else {
      // При успешном шаге кладём в стек *текущий* шаг (куда вернёмся при back)
      stack.push(i);
      i++;
    }
  }

  outro("Готово");
  return config;
}

export { CancelledError };

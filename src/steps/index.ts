import type { Step } from "../ui/wizard.ts";
import { diskStep } from "./disk.ts";
import { localeStep } from "./locale.ts";
import { networkStep } from "./network.ts";
import { profilesStep } from "./profiles.ts";
import { reviewStep } from "./review.ts";
import { usersStep } from "./users.ts";

export * from "./disk.ts";
export * from "./locale.ts";
export * from "./network.ts";
export * from "./profiles.ts";
export * from "./review.ts";
export * from "./users.ts";

export interface BuildStepsOptions {
  /** Каталог с YAML-профилями. */
  profilesDir: string;
}

/**
 * В авторежиме шаги сбора конфигурации пропускаются целиком:
 * при полном конфиге вопросов не будет, при неполном — ревью упадёт со списком проблем.
 */
function skipWhenUnattended(step: Step): Step {
  return {
    ...step,
    skip: (config) => (config.unattended ? true : (step.skip?.(config) ?? false)),
  };
}

/** Собирает список шагов визарда в порядке выполнения. */
export function buildSteps(options: BuildStepsOptions): Step[] {
  const steps: Step[] = [
    diskStep,
    localeStep,
    networkStep,
    usersStep,
    profilesStep({ dir: options.profilesDir }),
    reviewStep,
  ];

  // Ревью в авторежиме выполняет проверку и авто-подтверждение, его не пропускаем.
  return steps.map((step) => (step.id === "review" ? step : skipWhenUnattended(step)));
}

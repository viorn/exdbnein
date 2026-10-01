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

/** Собирает список шагов визарда в порядке выполнения. */
export function buildSteps(options: BuildStepsOptions): Step[] {
  return [
    diskStep,
    localeStep,
    networkStep,
    usersStep,
    profilesStep({ dir: options.profilesDir }),
    reviewStep,
  ];
}

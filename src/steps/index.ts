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
  /** Directory with YAML profiles. */
  profilesDir: string;
}

/**
 * In unattended mode the config-collecting steps are skipped entirely:
 * with a complete config there are no questions, with an incomplete one
 * the review fails with the list of issues.
 */
function skipWhenUnattended(step: Step): Step {
  return {
    ...step,
    skip: (config) => (config.unattended ? true : (step.skip?.(config) ?? false)),
  };
}

/** Builds the wizard step list in execution order. */
export function buildSteps(options: BuildStepsOptions): Step[] {
  const steps: Step[] = [
    diskStep,
    localeStep,
    networkStep,
    usersStep,
    profilesStep({ dir: options.profilesDir }),
    reviewStep,
  ];

  // In unattended mode the review performs validation and auto-confirmation, don't skip it.
  return steps.map((step) => (step.id === "review" ? step : skipWhenUnattended(step)));
}

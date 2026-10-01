import { describe, expect, test } from "bun:test";
import { defaultConfig } from "../src/config/types.ts";
import { runWizard, type Step, type StepResult } from "../src/ui/wizard.ts";

describe("wizard back navigation", () => {
  test("шаг с result.back возвращает к предыдущему шагу", async () => {
    const callCount = new Map<string, number>();

    const stepA: Step = {
      id: "a",
      title: "Шаг A",
      async run() {
        callCount.set("a", (callCount.get("a") ?? 0) + 1);
        // Первый вызов — назад, второй — дальше
        return callCount.get("a")! <= 1
          ? ({ type: "back" } satisfies StepResult)
          : ({ type: "continue" } satisfies StepResult);
      },
    };

    const stepB: Step = {
      id: "b",
      title: "Шаг B",
      async run() {
        callCount.set("b", (callCount.get("b") ?? 0) + 1);
        return { type: "continue" } satisfies StepResult;
      },
    };

    await runWizard({
      title: "test",
      steps: [stepA, stepB],
      config: defaultConfig(),
    });

    // Шаг A вызван дважды (первый раз → back, второй раз → continue)
    expect(callCount.get("a")).toBe(2);
    expect(callCount.get("b")).toBe(1);
  });

  test("назад с первого шага — перезапускаем его", async () => {
    const callCount = new Map<string, number>();

    const stepA: Step = {
      id: "a",
      title: "Шаг A",
      async run() {
        callCount.set("a", (callCount.get("a") ?? 0) + 1);
        return callCount.get("a")! <= 1
          ? ({ type: "back" } satisfies StepResult)
          : ({ type: "continue" } satisfies StepResult);
      },
    };

    await runWizard({
      title: "test",
      steps: [stepA],
      config: defaultConfig(),
    });

    // Единственный шаг: back → перезапуск → continue
    expect(callCount.get("a")).toBe(2);
  });

  test("цепочка назад: C → B → A", async () => {
    const callCount = new Map<string, number>();

    const stepA: Step = {
      id: "a",
      title: "Шаг A",
      async run() {
        callCount.set("a", (callCount.get("a") ?? 0) + 1);
        return { type: "continue" } satisfies StepResult;
      },
    };

    const stepB: Step = {
      id: "b",
      title: "Шаг B",
      async run() {
        callCount.set("b", (callCount.get("b") ?? 0) + 1);
        return callCount.get("b")! <= 1
          ? ({ type: "back" } satisfies StepResult)
          : ({ type: "continue" } satisfies StepResult);
      },
    };

    const stepC: Step = {
      id: "c",
      title: "Шаг C",
      async run() {
        callCount.set("c", (callCount.get("c") ?? 0) + 1);
        return callCount.get("c")! <= 1
          ? ({ type: "back" } satisfies StepResult)
          : ({ type: "continue" } satisfies StepResult);
      },
    };

    await runWizard({
      title: "test",
      steps: [stepA, stepB, stepC],
      config: defaultConfig(),
    });

    // A(1, cont) → B(1, back→A) → A(2, cont) → B(2, cont) → C(1, back→B) → B(3, cont) → C(2, cont) → end
    expect(callCount.get("a")).toBe(2);
    expect(callCount.get("b")).toBe(3);
    expect(callCount.get("c")).toBe(2);
  });

  test("onStepDone вызывается при каждом выполнении шага", async () => {
    const doneCalls: string[] = [];
    const callCount = { value: 0 };

    const step: Step = {
      id: "s",
      title: "Шаг",
      async run() {
        callCount.value++;
        // Первый раз — back (перезапуск), второй раз — continue
        return callCount.value <= 1
          ? ({ type: "back" } satisfies StepResult)
          : ({ type: "continue" } satisfies StepResult);
      },
    };

    await runWizard({
      title: "test",
      steps: [step],
      config: defaultConfig(),
      onStepDone: (s) => {
        doneCalls.push(s.id);
      },
    });

    // onStepDone вызывается дважды (два выполнения шага)
    expect(doneCalls).toEqual(["s", "s"]);
  });
});

import type { UserConfig } from "../config/types.ts";
import { confirm, password, text } from "../ui/prompts.ts";
import type { Step, StepResult } from "../ui/wizard.ts";
import { hashPassword } from "../utils/password.ts";

export const usersStep: Step = {
  id: "users",
  title: "Пользователи",
  async run({ config }): Promise<StepResult> {
    const rootPassword = await password({
      message: "Пароль root",
      validate: (value) => (value && value.length >= 4 ? undefined : "Минимум 4 символа"),
    });

    const users: UserConfig[] = [];
    let more = true;

    while (more) {
      const username = await text({
        message: "Имя пользователя",
        validate: (value) => {
          if (!value) return "Укажите имя";
          if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(value)) return "Некорректное имя";
          if (users.some((u) => u.username === value)) return "Уже добавлен";
          return undefined;
        },
      });

      const userPassword = await password({
        message: `Пароль для ${username}`,
        validate: (value) => (value && value.length >= 4 ? undefined : "Минимум 4 символа"),
      });

      const sudo = await confirm({
        message: `Добавить ${username} в группу sudo?`,
        initialValue: true,
      });

      users.push({
        username,
        passwordHash: await hashPassword(userPassword),
        sudo,
        sshKeys: [],
      });

      const result = await confirm({
        message: "Добавить ещё пользователя?",
        initialValue: false,
      });

      if (!result) {
        const back = await confirm({
          message: "← Назад к паролю root?",
          initialValue: false,
        });
        if (back) return { type: "back" };
      }

      more = result;
    }

    config.users = users;
    config.rootPasswordHash = await hashPassword(rootPassword);
    return { type: "continue" };
  },
};

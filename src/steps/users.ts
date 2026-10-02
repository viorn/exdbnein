import type { UserConfig } from "../config/types.ts";
import { confirm, password, text } from "../ui/prompts.ts";
import type { Step, StepResult } from "../ui/wizard.ts";
import { hashPassword } from "../utils/password.ts";

export const usersStep: Step = {
  id: "users",
  title: "Users",
  async run({ config }): Promise<StepResult> {
    const rootPassword = await password({
      message: "Root password",
      validate: (value) => (value && value.length >= 4 ? undefined : "At least 4 characters"),
    });

    const users: UserConfig[] = [];
    let more = true;

    while (more) {
      const username = await text({
        message: "Username",
        validate: (value) => {
          if (!value) return "Provide a name";
          if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(value)) return "Invalid name";
          if (users.some((u) => u.username === value)) return "Already added";
          return undefined;
        },
      });

      const userPassword = await password({
        message: `Password for ${username}`,
        validate: (value) => (value && value.length >= 4 ? undefined : "At least 4 characters"),
      });

      const sudo = await confirm({
        message: `Add ${username} to the sudo group?`,
        initialValue: true,
      });

      users.push({
        username,
        passwordHash: await hashPassword(userPassword),
        sudo,
        sshKeys: [],
      });

      const result = await confirm({
        message: "Add another user?",
        initialValue: false,
      });

      if (!result) {
        const back = await confirm({
          message: "Go back to the previous step?",
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

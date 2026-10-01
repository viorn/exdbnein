export interface ProfileIssue {
  profile: string;
  path: string;
  message: string;
}

const ALLOWED_KEYS = new Set([
  "name",
  "description",
  "extends",
  "packages",
  "services",
  "commands",
  "files",
]);

/** Проверяет сырое значение YAML-профиля и возвращает список проблем. Пустой список — валиден. */
export function validateProfile(name: string, raw: unknown): ProfileIssue[] {
  const issues: ProfileIssue[] = [];
  const add = (path: string, message: string) => issues.push({ profile: name, path, message });

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    add("", "профиль должен быть объектом YAML");
    return issues;
  }

  const p = raw as Record<string, unknown>;

  for (const key of Object.keys(p)) {
    if (!ALLOWED_KEYS.has(key)) add(key, "неизвестное поле");
  }

  if (typeof p.name !== "string" || !p.name) {
    add("name", "обязательное непустое поле");
  }

  if (p.description !== undefined && typeof p.description !== "string") {
    add("description", "должно быть строкой");
  }

  if (p.extends !== undefined) {
    const valid =
      typeof p.extends === "string" ||
      (Array.isArray(p.extends) && p.extends.every((item) => typeof item === "string"));
    if (!valid) add("extends", "должно быть строкой или списком строк");
  }

  for (const key of ["packages", "services"] as const) {
    if (p[key] !== undefined && !isStringArray(p[key])) {
      add(key, "должен быть списком строк");
    }
  }

  if (p.commands !== undefined) {
    if (!Array.isArray(p.commands)) {
      add("commands", "должен быть списком");
    } else {
      p.commands.forEach((command, index) => {
        if (typeof command !== "object" || command === null) {
          add(`commands[${index}]`, "должен быть объектом");
          return;
        }
        const entry = command as Record<string, unknown>;
        if (typeof entry.cmd !== "string" || !entry.cmd) {
          add(`commands[${index}].cmd`, "обязательное непустое поле");
        }
        if (entry.description !== undefined && typeof entry.description !== "string") {
          add(`commands[${index}].description`, "должно быть строкой");
        }
        if (entry.optional !== undefined && typeof entry.optional !== "boolean") {
          add(`commands[${index}].optional`, "должно быть boolean");
        }
      });
    }
  }

  if (p.files !== undefined) {
    if (!Array.isArray(p.files)) {
      add("files", "должен быть списком");
    } else {
      p.files.forEach((file, index) => {
        if (typeof file !== "object" || file === null) {
          add(`files[${index}]`, "должен быть объектом");
          return;
        }
        const entry = file as Record<string, unknown>;
        if (typeof entry.path !== "string" || !entry.path) {
          add(`files[${index}].path`, "обязательное непустое поле");
        }
        if (typeof entry.content !== "string") {
          add(`files[${index}].content`, "обязательное строковое поле");
        }
        if (entry.mode !== undefined && typeof entry.mode !== "string") {
          add(`files[${index}].mode`, "должно быть строкой");
        }
      });
    }
  }

  return issues;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

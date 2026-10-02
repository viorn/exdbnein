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

/** Validates a raw YAML profile value and returns a list of issues. An empty list — valid. */
export function validateProfile(name: string, raw: unknown): ProfileIssue[] {
  const issues: ProfileIssue[] = [];
  const add = (path: string, message: string) => issues.push({ profile: name, path, message });

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    add("", "profile must be a YAML object");
    return issues;
  }

  const p = raw as Record<string, unknown>;

  for (const key of Object.keys(p)) {
    if (!ALLOWED_KEYS.has(key)) add(key, "unknown field");
  }

  if (typeof p.name !== "string" || !p.name) {
    add("name", "required non-empty field");
  }

  if (p.description !== undefined && typeof p.description !== "string") {
    add("description", "must be a string");
  }

  if (p.extends !== undefined) {
    const valid =
      typeof p.extends === "string" ||
      (Array.isArray(p.extends) && p.extends.every((item) => typeof item === "string"));
    if (!valid) add("extends", "must be a string or a list of strings");
  }

  for (const key of ["packages", "services"] as const) {
    if (p[key] !== undefined && !isStringArray(p[key])) {
      add(key, "must be a list of strings");
    }
  }

  if (p.commands !== undefined) {
    if (!Array.isArray(p.commands)) {
      add("commands", "must be a list");
    } else {
      p.commands.forEach((command, index) => {
        if (typeof command !== "object" || command === null) {
          add(`commands[${index}]`, "must be an object");
          return;
        }
        const entry = command as Record<string, unknown>;
        if (typeof entry.cmd !== "string" || !entry.cmd) {
          add(`commands[${index}].cmd`, "required non-empty field");
        }
        if (entry.description !== undefined && typeof entry.description !== "string") {
          add(`commands[${index}].description`, "must be a string");
        }
        if (entry.optional !== undefined && typeof entry.optional !== "boolean") {
          add(`commands[${index}].optional`, "must be a boolean");
        }
      });
    }
  }

  if (p.files !== undefined) {
    if (!Array.isArray(p.files)) {
      add("files", "must be a list");
    } else {
      p.files.forEach((file, index) => {
        if (typeof file !== "object" || file === null) {
          add(`files[${index}]`, "must be an object");
          return;
        }
        const entry = file as Record<string, unknown>;
        if (typeof entry.path !== "string" || !entry.path) {
          add(`files[${index}].path`, "required non-empty field");
        }
        if (typeof entry.content !== "string") {
          add(`files[${index}].content`, "required string field");
        }
        if (entry.mode !== undefined && typeof entry.mode !== "string") {
          add(`files[${index}].mode`, "must be a string");
        }
      });
    }
  }

  return issues;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

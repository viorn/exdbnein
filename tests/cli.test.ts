import { describe, expect, test } from "bun:test";
import { parseArgs } from "../src/cli.ts";

describe("parseArgs", () => {
  test("значения по умолчанию", () => {
    const options = parseArgs([]);
    expect(options).toEqual({
      profilesDir: "profiles",
      unattended: false,
      force: false,
      help: false,
    });
  });

  test("короткие и длинные флаги", () => {
    expect(parseArgs(["-c", "cfg.json"]).config).toBe("cfg.json");
    expect(parseArgs(["--config", "cfg.json"]).config).toBe("cfg.json");
    expect(parseArgs(["-p", "my-profiles"]).profilesDir).toBe("my-profiles");
    expect(parseArgs(["--profiles-dir", "my-profiles"]).profilesDir).toBe("my-profiles");
    expect(parseArgs(["-y"]).unattended).toBe(true);
    expect(parseArgs(["--unattended"]).unattended).toBe(true);
    expect(parseArgs(["-f"]).force).toBe(true);
    expect(parseArgs(["--force"]).force).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
  });

  test("бросает ошибку на неизвестный аргумент", () => {
    expect(() => parseArgs(["--nope"])).toThrow("Unknown argument");
  });
});

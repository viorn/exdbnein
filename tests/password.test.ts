import { describe, expect, test } from "bun:test";
import { hashPassword, verifyPassword } from "../src/utils/password.ts";

describe("password", () => {
  test("хеш имеет формат sha512-crypt", async () => {
    const hash = await hashPassword("secret");
    expect(hash.startsWith("$6$")).toBe(true);
  });

  test("verifyPassword принимает верный пароль", async () => {
    const hash = await hashPassword("secret");
    expect(await verifyPassword("secret", hash)).toBe(true);
  });

  test("verifyPassword отвергает неверный пароль", async () => {
    const hash = await hashPassword("secret");
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  test("одинаковые пароли дают разные хеши (случайная соль)", async () => {
    expect(await hashPassword("secret")).not.toBe(await hashPassword("secret"));
  });
});

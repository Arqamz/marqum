import { describe, expect, it } from "vitest";
import {
  fromBase64Url,
  fromHex,
  hashPasscode,
  randomToken,
  safeEqual,
  toBase64Url,
  toHex,
  tokenHash,
  verifyPasscode,
} from "../src/lib/crypto.ts";

describe("auth hashing", () => {
  it("hashes and verifies passcodes with PBKDF2 + pepper", async () => {
    const stored = await hashPasscode("123456", "pepper", 1000);
    expect(stored).toMatch(/^pbkdf2\$1000\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
    expect(await verifyPasscode("123456", stored, "pepper")).toBe(true);
    expect(await verifyPasscode("123457", stored, "pepper")).toBe(false);
    expect(await verifyPasscode("123456", stored, "other-pepper")).toBe(false);
    expect(await verifyPasscode("123456", "garbage", "pepper")).toBe(false);
  });

  it("salts every hash", async () => {
    expect(await hashPasscode("123456", "p", 1000)).not.toBe(await hashPasscode("123456", "p", 1000));
  });

  it("token hashes depend on the pepper and are stable", async () => {
    const t = randomToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await tokenHash(t, "a")).toBe(await tokenHash(t, "a"));
    expect(await tokenHash(t, "a")).not.toBe(await tokenHash(t, "b"));
  });

  it("safeEqual compares exactly", async () => {
    expect(await safeEqual("abc", "abc")).toBe(true);
    expect(await safeEqual("abc", "abd")).toBe(false);
    expect(await safeEqual("abc", "abcd")).toBe(false);
  });

  it("round-trips hex and base64url", () => {
    const bytes = new Uint8Array([0, 1, 250, 255, 62, 63]);
    expect(fromHex(toHex(bytes))).toEqual(bytes);
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
    for (let n = 0; n < 6; n++)
      expect(fromBase64Url(toBase64Url(bytes.slice(0, n)))).toEqual(bytes.slice(0, n));
  });
});

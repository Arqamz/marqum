// Small WebCrypto helpers (pure; run in Workers and Node).

const enc = new TextEncoder();

export const toHex = (buf: ArrayBuffer | Uint8Array): string =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

export async function sha256Hex(s: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}

/** A random opaque token (32 bytes, base64url). */
export function randomToken(bytes = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** What we store for a bearer / step-up / biometric secret: sha256(token + pepper). */
export const tokenHash = (token: string, pepper: string): Promise<string> => sha256Hex(`${token}${pepper}`);

/** Constant-time string comparison (compares fixed-length digests, so input length doesn't leak). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([sha256Hex(`cmp|${a}`), sha256Hex(`cmp|${b}`)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

/** Workers cap PBKDF2 at 100k iterations. */
export const PBKDF2_ITERATIONS = 100_000;

async function pbkdf2(
  passcode: string,
  salt: Uint8Array,
  iterations: number,
  pepper: string,
): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(`${passcode}${pepper}`), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    256,
  );
  return toHex(bits);
}

/** `pbkdf2$<iterations>$<salt hex>$<hash hex>` */
export async function hashPasscode(
  passcode: string,
  pepper: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${iterations}$${toHex(salt)}$${await pbkdf2(passcode, salt, iterations, pepper)}`;
}

export async function verifyPasscode(passcode: string, stored: string, pepper: string): Promise<boolean> {
  const [scheme, iter, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2" || !iter || !salt || !hash) return false;
  return safeEqual(await pbkdf2(passcode, fromHex(salt), Number(iter), pepper), hash);
}

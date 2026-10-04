import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Bank access tokens never expire, so they are encrypted at rest with
// AES-256-GCM under PLAID_TOKEN_KEY (32 random bytes, base64). Stored as
// "v1.<iv>.<tag>.<ciphertext>" in base64url, so a later key rotation can tell
// formats apart. A leaked database row is useless without the key.

const VERSION = "v1";

function key(): Buffer {
  const k = Buffer.from(process.env.PLAID_TOKEN_KEY ?? "", "base64");
  if (k.length !== 32) {
    throw new Error("PLAID_TOKEN_KEY must be 32 random bytes, base64-encoded (openssl rand -base64 32).");
  }
  return k;
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), data]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

export function decryptToken(stored: string): string {
  const [version, iv, tag, data] = stored.split(".");
  if (version !== VERSION || !iv || !tag || !data) {
    throw new Error("Unrecognized encrypted token format.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(data, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

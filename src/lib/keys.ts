import { errorResponse } from "./http";

// Cloudflare Workers KV enforces a 512-byte limit on stored keys.
// Internal keys are prefixed with "data:" / "meta:" (5 bytes), so the public key must fit within 507 bytes.
const KEY_MAX_BYTES = 507;
const RESERVED_PREFIXES = ["data:", "meta:"];

export const dataKey = (key: string) => `data:${key}`;
export const metaKey = (key: string) => `meta:${key}`;

export const parseCacheKey = (encodedKey: string) => {
  if (!encodedKey) {
    return {
      ok: false as const,
      response: errorResponse(400, "INVALID_KEY", "Cache key must not be empty"),
    };
  }

  let key: string;

  try {
    key = decodeURIComponent(encodedKey);
  } catch {
    return {
      ok: false as const,
      response: errorResponse(400, "INVALID_KEY", "Cache key must be valid URL encoding"),
    };
  }

  if (RESERVED_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    return {
      ok: false as const,
      response: errorResponse(400, "INVALID_KEY", "Cache key uses a reserved prefix"),
    };
  }

  if (new TextEncoder().encode(key).byteLength > KEY_MAX_BYTES) {
    return {
      ok: false as const,
      response: errorResponse(400, "INVALID_KEY", "Cache key exceeds 507 bytes"),
    };
  }

  return {
    ok: true as const,
    key,
  };
};

import { errorResponse } from "./http";

const KEY_MAX_BYTES = 512;
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
      response: errorResponse(400, "INVALID_KEY", "Cache key exceeds 512 bytes"),
    };
  }

  return {
    ok: true as const,
    key,
  };
};

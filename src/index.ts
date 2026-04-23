import { isAuthorized } from "./lib/auth";
import { errorResponse, json, readJson, readOptionalJson } from "./lib/http";
import { parseCacheKey } from "./lib/keys";
import { putCache, readCache, touchCache } from "./lib/store";

type PutBody = {
  ttl: number;
  value: string;
};

type TouchBody = {
  ttl?: number;
};

const CACHE_ROUTE = /^\/v1\/cache\/([^/]+)$/;
const TOUCH_ROUTE = /^\/v1\/cache\/([^/]+)\/touch$/;

const isObjectBody = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export const fetchHandler: ExportedHandler<Env>["fetch"] = async (request, env) => {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/health") {
    return Response.json({ ok: true });
  }

  const touchMatch = url.pathname.match(TOUCH_ROUTE);
  const cacheMatch = url.pathname.match(CACHE_ROUTE);
  const routeMatch = touchMatch ?? cacheMatch;

  if (!routeMatch) {
    return errorResponse(404, "NOT_FOUND", "Route not found");
  }

  if (!isAuthorized(request, env)) {
    return errorResponse(401, "UNAUTHORIZED", "Missing or invalid bearer token");
  }

  const parsedKey = parseCacheKey(routeMatch[1]);
  if (!parsedKey.ok) {
    return parsedKey.response;
  }

  if (touchMatch) {
    if (request.method !== "POST") {
      return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed");
    }

    const parsedBody = await readOptionalJson<TouchBody>(request);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }

    if (!isObjectBody(parsedBody.value)) {
      return errorResponse(400, "INVALID_BODY", "Request body must be an object");
    }

    const { ttl } = parsedBody.value;

    if (ttl !== undefined && (!Number.isInteger(ttl) || ttl <= 0)) {
      return errorResponse(400, "INVALID_TTL", "ttl must be a positive integer");
    }

    const result = await touchCache(env.CACHE_KV, parsedKey.key, ttl);

    if (!result.ok) {
      if (result.status === 400) {
        return errorResponse(400, "INVALID_TTL", "touch requires ttl when metadata is missing");
      }

      return new Response(null, { status: 404 });
    }

    return new Response(null, { status: 204 });
  }

  if (request.method === "GET") {
    const result = await readCache(env.CACHE_KV, parsedKey.key);
    if (!result.hit) {
      return json(result.expired ? { hit: false, expired: true } : { hit: false }, { status: 404 });
    }
    return json({ hit: true, value: result.value });
  }

  if (request.method === "HEAD") {
    const result = await readCache(env.CACHE_KV, parsedKey.key);
    return new Response(null, { status: result.hit ? 204 : 404 });
  }

  if (request.method === "PUT") {
    const parsedBody = await readJson<PutBody>(request);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }

    if (!isObjectBody(parsedBody.value)) {
      return errorResponse(400, "INVALID_BODY", "Request body must be an object");
    }

    const { ttl, value } = parsedBody.value;

    if (!Number.isInteger(ttl) || ttl <= 0) {
      return errorResponse(400, "INVALID_TTL", "ttl must be a positive integer");
    }

    if (typeof value !== "string") {
      return errorResponse(400, "INVALID_VALUE", "value must be a string");
    }

    await putCache(env.CACHE_KV, parsedKey.key, value, ttl);
    return new Response(null, { status: 204 });
  }

  return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed");
};

export default {
  fetch: fetchHandler,
} satisfies ExportedHandler<Env>;

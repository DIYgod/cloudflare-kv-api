import { isAuthorized } from "./lib/auth";
import { errorResponse } from "./lib/http";

export const fetchHandler: ExportedHandler<Env>["fetch"] = async (request, env) => {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/health") {
    return Response.json({ ok: true });
  }

  if (!url.pathname.startsWith("/v1/cache/")) {
    return errorResponse(404, "NOT_FOUND", "Route not found");
  }

  if (!isAuthorized(request, env)) {
    return errorResponse(401, "UNAUTHORIZED", "Missing or invalid bearer token");
  }

  return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed");
};

export default {
  fetch: fetchHandler,
} satisfies ExportedHandler<Env>;

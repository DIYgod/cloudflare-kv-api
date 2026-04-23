import { describe, expect, it } from "vitest";

import { fetchHandler } from "../src/index";

const env = {} as Env;
const ctx = {
  passThroughOnException() {},
  waitUntil() {},
} as unknown as ExecutionContext;

describe("GET /health", () => {
  it("returns an unauthenticated readiness payload", async () => {
    const request = new Request("https://example.com/health") as Request<unknown, IncomingRequestCfProperties<unknown>>;
    const response = await fetchHandler!(request, env, ctx);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});

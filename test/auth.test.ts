import { describe, expect, it } from "vitest";

import { fetchHandler } from "../src/index";

const asWorkerRequest = (request: Request) =>
  request as Request<unknown, IncomingRequestCfProperties<unknown>>;

const asEnv = (env: Record<string, unknown>) => env as unknown as Env;

const ctx = {
  passThroughOnException() {},
  waitUntil() {},
} as unknown as ExecutionContext;

describe("cache route authentication", () => {
  it("rejects cache requests without a bearer token", async () => {
    const request = asWorkerRequest(new Request("https://example.com/v1/cache/article%3A1"));
    const response = await fetchHandler!(request, asEnv({ API_TOKEN: "test-token" }), ctx);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "Missing or invalid bearer token",
      },
    });
  });

  it("returns 405 for unsupported cache methods after auth succeeds", async () => {
    const request = asWorkerRequest(
      new Request("https://example.com/v1/cache/article%3A1", {
        method: "DELETE",
        headers: {
          Authorization: "Bearer test-token",
        },
      })
    );

    const response = await fetchHandler!(request, asEnv({ API_TOKEN: "test-token" }), ctx);

    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Method not allowed",
      },
    });
  });

  it("fails closed when the api token is missing", async () => {
    const request = asWorkerRequest(
      new Request("https://example.com/v1/cache/article%3A1", {
        headers: {
          Authorization: "Bearer undefined",
        },
      })
    );
    const response = await fetchHandler!(request, asEnv({}), ctx);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "Missing or invalid bearer token",
      },
    });
  });
});

describe("unknown route responses", () => {
  it("returns a json 404 for non-cache routes", async () => {
    const request = asWorkerRequest(new Request("https://example.com/missing"));
    const response = await fetchHandler!(request, asEnv({ API_TOKEN: "test-token" }), ctx);

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await response.json()).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Route not found",
      },
    });
  });
});

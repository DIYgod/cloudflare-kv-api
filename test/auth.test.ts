import { describe, expect, it } from "vitest";

import { fetchHandler } from "../src/index";

const ctx = {
  passThroughOnException() {},
  waitUntil() {},
} as unknown as ExecutionContext;

describe("cache route authentication", () => {
  it("rejects cache requests without a bearer token", async () => {
    const request =
      new Request(
        "https://example.com/v1/cache/article%3A1"
      ) as Request<unknown, IncomingRequestCfProperties<unknown>>;
    const response = await fetchHandler!(
      request,
      { API_TOKEN: "test-token" } as unknown as Env,
      ctx
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "Missing or invalid bearer token",
      },
    });
  });

  it("returns 405 for unsupported cache methods after auth succeeds", async () => {
    const request = new Request("https://example.com/v1/cache/article%3A1", {
      method: "DELETE",
      headers: {
        Authorization: "Bearer test-token",
      },
    }) as Request<unknown, IncomingRequestCfProperties<unknown>>;

    const response = await fetchHandler!(
      request,
      { API_TOKEN: "test-token" } as unknown as Env,
      ctx
    );

    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Method not allowed",
      },
    });
  });
});

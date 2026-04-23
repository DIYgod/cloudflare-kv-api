import { describe, expect, it } from "vitest";

import { authHeaders, createHarness } from "./helpers/worker";

describe("basic cache operations", () => {
  it("stores and fetches a string value with a normal TTL", async () => {
    const harness = createHarness();

    const putResponse = await harness.fetch("/v1/cache/article%3A1", {
      method: "PUT",
      headers: {
        ...authHeaders(),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        value: "payload",
        ttl: 3600,
      }),
    });

    expect(putResponse.status).toBe(204);
    expect(harness.kv.snapshot("data:article:1")).toEqual({
      expirationTtl: 3600,
      value: "payload",
    });
    expect(harness.kv.snapshot("meta:article:1")).toEqual({
      expirationTtl: 3600,
      value: expect.any(String),
    });
    expect(JSON.parse(harness.kv.snapshot("meta:article:1")!.value)).toEqual({
      ttl: 3600,
      logicalExpireAt: expect.any(Number),
      updatedAt: expect.any(Number),
    });

    const getResponse = await harness.fetch("/v1/cache/article%3A1", {
      headers: authHeaders(),
    });

    expect(getResponse.status).toBe(200);
    expect(await getResponse.json()).toEqual({
      hit: true,
      value: "payload",
    });
  });

  it("returns 204 for HEAD hits and 404 for misses", async () => {
    const harness = createHarness();

    await harness.fetch("/v1/cache/article%3A1", {
      method: "PUT",
      headers: {
        ...authHeaders(),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        value: "payload",
        ttl: 3600,
      }),
    });

    const hit = await harness.fetch("/v1/cache/article%3A1", {
      method: "HEAD",
      headers: authHeaders(),
    });
    const miss = await harness.fetch("/v1/cache/article%3A2", {
      method: "HEAD",
      headers: authHeaders(),
    });

    expect(hit.status).toBe(204);
    expect(miss.status).toBe(404);
  });

  it("rejects reserved prefixes and invalid payload types", async () => {
    const harness = createHarness();

    const badKey = await harness.fetch("/v1/cache/data%3Aunsafe", {
      method: "PUT",
      headers: {
        ...authHeaders(),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        value: "payload",
        ttl: 3600,
      }),
    });

    expect(badKey.status).toBe(400);
    expect(await badKey.json()).toEqual({
      error: {
        code: "INVALID_KEY",
        message: "Cache key uses a reserved prefix",
      },
    });

    const badValue = await harness.fetch("/v1/cache/article%3A3", {
      method: "PUT",
      headers: {
        ...authHeaders(),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        value: { invalid: true },
        ttl: 3600,
      }),
    });

    expect(badValue.status).toBe(400);
    expect(await badValue.json()).toEqual({
      error: {
        code: "INVALID_VALUE",
        message: "value must be a string",
      },
    });
  });

  it("rejects null payload bodies with a 400 response", async () => {
    const harness = createHarness();

    const response = await harness.fetch("/v1/cache/article%3A4", {
      method: "PUT",
      headers: {
        ...authHeaders(),
        "content-type": "application/json",
      },
      body: "null",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "INVALID_BODY",
        message: "Request body must be an object",
      },
    });
  });
});

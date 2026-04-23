import { describe, expect, it } from "vitest";

import { authHeaders, createHarness } from "./helpers/worker";

describe("cache lifecycle", () => {
  it("stores short TTL keys with a 60-second KV expiry but short logical expiry", async () => {
    const harness = createHarness();

    const response = await harness.fetch("/v1/cache/twitter%3Alock", {
      method: "PUT",
      headers: {
        ...authHeaders(),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        value: "1",
        ttl: 20,
      }),
    });

    expect(response.status).toBe(204);
    expect(harness.kv.snapshot("data:twitter:lock")).toEqual({
      expirationTtl: 60,
      value: "1",
    });

    const metadata = JSON.parse(harness.kv.snapshot("meta:twitter:lock")!.value);
    expect(metadata.ttl).toBe(20);
  });

  it("treats logically expired keys as misses", async () => {
    const harness = createHarness();

    await harness.kv.put("data:expired:key", "payload", { expirationTtl: 60 });
    await harness.kv.put(
      "meta:expired:key",
      JSON.stringify({
        ttl: 20,
        logicalExpireAt: 1,
        updatedAt: 0,
      }),
      { expirationTtl: 60 }
    );

    const getResponse = await harness.fetch("/v1/cache/expired%3Akey", {
      headers: authHeaders(),
    });
    const headResponse = await harness.fetch("/v1/cache/expired%3Akey", {
      method: "HEAD",
      headers: authHeaders(),
    });

    expect(getResponse.status).toBe(404);
    expect(await getResponse.json()).toEqual({
      hit: false,
      expired: true,
    });
    expect(headResponse.status).toBe(404);
  });

  it("refreshes an existing key with POST /touch", async () => {
    const harness = createHarness();

    await harness.fetch("/v1/cache/article%3A1", {
      method: "PUT",
      headers: {
        ...authHeaders(),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        value: "payload",
        ttl: 120,
      }),
    });

    const response = await harness.fetch("/v1/cache/article%3A1/touch", {
      method: "POST",
      headers: {
        ...authHeaders(),
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(204);
    const metadata = JSON.parse(harness.kv.snapshot("meta:article:1")!.value);
    expect(metadata.ttl).toBe(120);
  });

  it("returns 400 when touch cannot infer ttl from missing metadata", async () => {
    const harness = createHarness();

    await harness.kv.put("data:orphan:key", "payload", { expirationTtl: 60 });

    const response = await harness.fetch("/v1/cache/orphan%3Akey/touch", {
      method: "POST",
      headers: {
        ...authHeaders(),
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "INVALID_TTL",
        message: "touch requires ttl when metadata is missing",
      },
    });
  });
});

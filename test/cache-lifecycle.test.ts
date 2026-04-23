import { afterEach, describe, expect, it, vi } from "vitest";

import { authHeaders, createHarness } from "./helpers/worker";

afterEach(() => {
  vi.useRealTimers();
});

describe("cache lifecycle", () => {
  it("stores short TTL keys with a 60-second KV expiry but short logical expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

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
    expect(metadata.updatedAt).toBe(Date.parse("2026-01-01T00:00:00.000Z"));
    expect(metadata.logicalExpireAt).toBe(Date.parse("2026-01-01T00:00:20.000Z"));
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
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

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

    const before = JSON.parse(harness.kv.snapshot("meta:article:1")!.value);

    vi.setSystemTime(new Date("2026-01-01T00:01:00.000Z"));

    const response = await harness.fetch("/v1/cache/article%3A1/touch", {
      method: "POST",
      headers: {
        ...authHeaders(),
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(204);
    const after = JSON.parse(harness.kv.snapshot("meta:article:1")!.value);
    expect(after.ttl).toBe(120);
    expect(after.updatedAt).toBe(Date.parse("2026-01-01T00:01:00.000Z"));
    expect(after.logicalExpireAt).toBe(Date.parse("2026-01-01T00:03:00.000Z"));
    expect(after.updatedAt).toBeGreaterThan(before.updatedAt);
    expect(after.logicalExpireAt).toBeGreaterThan(before.logicalExpireAt);
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

  it("treats malformed metadata as missing instead of crashing", async () => {
    const harness = createHarness();

    await harness.kv.put("data:broken:key", "payload", { expirationTtl: 60 });
    await harness.kv.put("meta:broken:key", "{not-json", { expirationTtl: 60 });

    const getResponse = await harness.fetch("/v1/cache/broken%3Akey", {
      headers: authHeaders(),
    });

    expect(getResponse.status).toBe(200);
    expect(await getResponse.json()).toEqual({
      hit: true,
      value: "payload",
    });
  });

  it("treats invalid logicalExpireAt as missing metadata instead of crashing", async () => {
    const harness = createHarness();

    await harness.kv.put("data:invalid:key", "payload", { expirationTtl: 60 });
    await harness.kv.put(
      "meta:invalid:key",
      JSON.stringify({
        ttl: 20,
        logicalExpireAt: "tomorrow",
        updatedAt: 0,
      }),
      { expirationTtl: 60 }
    );

    const getResponse = await harness.fetch("/v1/cache/invalid%3Akey", {
      headers: authHeaders(),
    });

    expect(getResponse.status).toBe(200);
    expect(await getResponse.json()).toEqual({
      hit: true,
      value: "payload",
    });
  });

  it("returns json 404 bodies for touch misses and logical expiry", async () => {
    const harness = createHarness();

    const missResponse = await harness.fetch("/v1/cache/missing%3Akey/touch", {
      method: "POST",
      headers: {
        ...authHeaders(),
        "content-type": "application/json",
      },
      body: JSON.stringify({ ttl: 60 }),
    });

    await harness.kv.put("data:expired:touch", "payload", { expirationTtl: 60 });
    await harness.kv.put(
      "meta:expired:touch",
      JSON.stringify({
        ttl: 20,
        logicalExpireAt: 1,
        updatedAt: 0,
      }),
      { expirationTtl: 60 }
    );

    const expiredResponse = await harness.fetch("/v1/cache/expired%3Atouch/touch", {
      method: "POST",
      headers: {
        ...authHeaders(),
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });

    expect(missResponse.status).toBe(404);
    expect(await missResponse.json()).toEqual({
      hit: false,
    });

    expect(expiredResponse.status).toBe(404);
    expect(await expiredResponse.json()).toEqual({
      hit: false,
      expired: true,
    });
  });
});

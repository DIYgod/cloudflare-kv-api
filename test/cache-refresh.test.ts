import { afterEach, describe, expect, it, vi } from "vitest";

import { putCache } from "../src/lib/store";
import { authHeaders, createHarness } from "./helpers/worker";

describe("GET refresh semantics", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes logical expiry in the background when refresh=1", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-23T00:00:10.000Z"));

    const harness = createHarness();
    await putCache(harness.env.CACHE_KV, "refresh:key", "payload", 120, Date.now());

    vi.setSystemTime(new Date("2026-04-23T00:01:00.000Z"));

    const response = await harness.fetch("/v1/cache/refresh%3Akey?refresh=1", {
      headers: authHeaders(),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      hit: true,
      value: "payload",
    });

    await harness.waitOnExecutionContext();

    const metadata = JSON.parse(harness.kv.snapshot("meta:refresh:key")!.value);
    expect(metadata.logicalExpireAt).toBe(Date.now() + 120_000);
  });

  it("returns the value without scheduling refresh when metadata is missing", async () => {
    const harness = createHarness();

    await harness.kv.put("data:refresh:orphan", "payload", { expirationTtl: 60 });

    const response = await harness.fetch("/v1/cache/refresh%3Aorphan?refresh=1", {
      headers: authHeaders(),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      hit: true,
      value: "payload",
    });

    await harness.waitOnExecutionContext();
    expect(harness.kv.snapshot("meta:refresh:orphan")).toBeNull();
  });
});

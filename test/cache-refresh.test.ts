import { afterEach, describe, expect, it, vi } from "vitest";

import { putCache } from "../src/lib/store";
import { authHeaders, createHarness } from "./helpers/worker";

const createDeferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
};

describe("GET refresh semantics", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes logical expiry asynchronously in the background when refresh=1", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-23T00:00:10.000Z"));

    const harness = createHarness();
    await putCache(harness.env.CACHE_KV, "refresh:key", "payload", 120, Date.now());
    const originalMetadata = JSON.parse(harness.kv.snapshot("meta:refresh:key")!.value);

    const originalPut = harness.kv.put.bind(harness.kv);
    const metadataRefresh = createDeferred();
    let delayMetadataWrite = true;

    harness.kv.put = vi.fn(async (key, value, options) => {
      if (delayMetadataWrite && key === "meta:refresh:key") {
        await metadataRefresh.promise;
      }

      return originalPut(key, value, options);
    });

    vi.setSystemTime(new Date("2026-04-23T00:01:00.000Z"));

    const response = await harness.fetch("/v1/cache/refresh%3Akey?refresh=1", {
      headers: authHeaders(),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      hit: true,
      value: "payload",
    });

    let backgroundDone = false;
    const backgroundWork = harness.waitOnExecutionContext().then(() => {
      backgroundDone = true;
    });

    await Promise.resolve();
    expect(backgroundDone).toBe(false);
    expect(JSON.parse(harness.kv.snapshot("meta:refresh:key")!.value)).toEqual(originalMetadata);

    delayMetadataWrite = false;
    metadataRefresh.resolve();
    await backgroundWork;

    const metadata = JSON.parse(harness.kv.snapshot("meta:refresh:key")!.value);
    expect(metadata.logicalExpireAt).toBe(Date.now() + 120_000);
  });

  it("returns the value without scheduling refresh when metadata is missing", async () => {
    const harness = createHarness();

    await harness.kv.put("data:refresh:orphan", "payload", { expirationTtl: 60 });
    const originalPut = harness.kv.put.bind(harness.kv);
    let writesAfterGet = 0;

    harness.kv.put = vi.fn(async (key, value, options) => {
      writesAfterGet += 1;
      return originalPut(key, value, options);
    });

    const response = await harness.fetch("/v1/cache/refresh%3Aorphan?refresh=1", {
      headers: authHeaders(),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      hit: true,
      value: "payload",
    });

    await harness.waitOnExecutionContext();
    expect(writesAfterGet).toBe(0);
    expect(harness.kv.snapshot("meta:refresh:orphan")).toBeNull();
  });

  it("re-reads the latest cache value before refreshing ttl", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-23T00:00:10.000Z"));

    const harness = createHarness();
    await putCache(harness.env.CACHE_KV, "refresh:race", "stale", 120, Date.now());

    const originalGet = harness.kv.get.bind(harness.kv);
    const originalPut = harness.kv.put.bind(harness.kv);
    const refreshRead = createDeferred();
    const refreshWrites = createDeferred();
    let blockRefreshRead = false;
    let blockRefreshWrites = false;
    let allowConcurrentPut = false;
    const targetKeys = new Set(["data:refresh:race", "meta:refresh:race"]);
    const readCounts = new Map<string, number>();

    harness.kv.get = vi.fn(async (key) => {
      const nextReadCount = (readCounts.get(key) ?? 0) + 1;
      readCounts.set(key, nextReadCount);

      if (blockRefreshRead && targetKeys.has(key) && nextReadCount >= 2) {
        await refreshRead.promise;
      }

      return originalGet(key);
    });

    harness.kv.put = vi.fn(async (key, value, options) => {
      if (blockRefreshWrites && targetKeys.has(key) && !allowConcurrentPut) {
        await refreshWrites.promise;
      }

      return originalPut(key, value, options);
    });

    vi.setSystemTime(new Date("2026-04-23T00:01:00.000Z"));
    blockRefreshRead = true;
    blockRefreshWrites = true;

    const response = await harness.fetch("/v1/cache/refresh%3Arace?refresh=1", {
      headers: authHeaders(),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      hit: true,
      value: "stale",
    });

    vi.setSystemTime(new Date("2026-04-23T00:01:30.000Z"));
    allowConcurrentPut = true;
    await putCache(harness.env.CACHE_KV, "refresh:race", "newer", 300, Date.now());
    allowConcurrentPut = false;

    blockRefreshRead = false;
    refreshRead.resolve();
    blockRefreshWrites = false;
    refreshWrites.resolve();
    await harness.waitOnExecutionContext();

    const finalMetadata = JSON.parse(harness.kv.snapshot("meta:refresh:race")!.value);
    expect(harness.kv.snapshot("data:refresh:race")).toEqual({
      expirationTtl: 300,
      value: "newer",
    });
    expect(finalMetadata.ttl).toBe(300);
  });
});

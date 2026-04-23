import { dataKey, metaKey } from "./keys";

export type CacheMetadata = {
  ttl: number;
  logicalExpireAt: number;
  updatedAt: number;
};

const kvExpirationTtl = (ttl: number) => Math.max(ttl, 60);

const buildMetadata = (ttl: number, now: number): CacheMetadata => ({
  ttl,
  logicalExpireAt: now + ttl * 1000,
  updatedAt: now,
});

const parseMetadata = (metadataRaw: string): CacheMetadata | null => {
  try {
    const metadata = JSON.parse(metadataRaw) as Partial<CacheMetadata>;

    if (typeof metadata.logicalExpireAt !== "number" || !Number.isFinite(metadata.logicalExpireAt)) {
      return null;
    }

    return metadata as CacheMetadata;
  } catch {
    return null;
  }
};

export const putCache = async (kv: KVNamespace, key: string, value: string, ttl: number, now = Date.now()) => {
  const metadata = buildMetadata(ttl, now);
  const expirationTtl = kvExpirationTtl(ttl);

  await Promise.all([
    kv.put(dataKey(key), value, { expirationTtl }),
    kv.put(metaKey(key), JSON.stringify(metadata), { expirationTtl }),
  ]);
};

export const readCache = async (kv: KVNamespace, key: string, now = Date.now()) => {
  const [value, metadataRaw] = await Promise.all([kv.get(dataKey(key)), kv.get(metaKey(key))]);

  if (value === null) {
    return {
      hit: false as const,
      expired: false,
    };
  }

  if (!metadataRaw) {
    return {
      hit: true as const,
      metadata: null,
      value,
    };
  }

  const metadata = parseMetadata(metadataRaw);

  if (!metadata) {
    return {
      hit: true as const,
      metadata: null,
      value,
    };
  }

  if (metadata.logicalExpireAt <= now) {
    return {
      hit: false as const,
      expired: true,
    };
  }

  return {
    hit: true as const,
    metadata,
    value,
  };
};

export const touchCache = async (kv: KVNamespace, key: string, ttl: number | undefined, now = Date.now()) => {
  const current = await readCache(kv, key, now);

  if (!current.hit) {
    return {
      ok: false as const,
      status: 404,
      expired: current.expired,
    };
  }

  const nextTtl = ttl ?? current.metadata?.ttl;

  if (!nextTtl) {
    return {
      ok: false as const,
      status: 400,
    };
  }

  await putCache(kv, key, current.value, nextTtl, now);
  return { ok: true as const };
};

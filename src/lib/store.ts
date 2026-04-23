import { dataKey, metaKey } from "./keys";

export type CacheMetadata = {
  ttl: number;
  logicalExpireAt: number;
  updatedAt: number;
};

export const putCache = async (kv: KVNamespace, key: string, value: string, ttl: number, now = Date.now()) => {
  const metadata: CacheMetadata = {
    ttl,
    logicalExpireAt: now + ttl * 1000,
    updatedAt: now,
  };

  await Promise.all([
    kv.put(dataKey(key), value, { expirationTtl: ttl }),
    kv.put(metaKey(key), JSON.stringify(metadata), { expirationTtl: ttl }),
  ]);
};

export const readCache = async (kv: KVNamespace, key: string) => {
  const [value, metadataValue] = await Promise.all([kv.get(dataKey(key)), kv.get(metaKey(key))]);

  if (value === null) {
    return {
      hit: false as const,
      expired: false,
    };
  }

  return {
    hit: true as const,
    metadata: metadataValue === null ? null : (JSON.parse(metadataValue) as CacheMetadata),
    value,
  };
};

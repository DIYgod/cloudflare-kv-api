type StoredValue = {
  expirationTtl?: number;
  value: string;
};

export class FakeKVNamespace {
  private readonly store = new Map<string, StoredValue>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key)?.value ?? null;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    this.store.set(key, { value, expirationTtl: options?.expirationTtl });
  }

  snapshot(key: string) {
    return this.store.get(key) ?? null;
  }
}

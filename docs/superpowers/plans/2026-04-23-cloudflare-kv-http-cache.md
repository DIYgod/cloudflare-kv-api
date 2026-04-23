# Cloudflare KV HTTP Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Cloudflare Worker with authenticated KV-backed HTTP cache endpoints that match RSSHub's current cache semantics, including logical-expiry compatibility for TTL values below 60 seconds.

**Architecture:** Keep the Worker narrow. [`src/index.ts`](/Users/diygod/Code/Projects/cloudflare-kv-api/src/index.ts) owns routing and delegates to focused helpers for auth, JSON/error responses, key validation, and KV lifecycle. Tests call the exported `fetchHandler` directly with a deterministic in-memory KV double, and `wrangler` is used for type generation and deployment validation.

**Tech Stack:** TypeScript 6.0.3, Vitest 4.1.5, Wrangler 4.84.1, Cloudflare Workers, Cloudflare Workers KV

---

## File Structure

- [`package.json`](/Users/diygod/Code/Projects/cloudflare-kv-api/package.json): pinned toolchain, scripts, and dev dependencies
- [`.gitignore`](/Users/diygod/Code/Projects/cloudflare-kv-api/.gitignore): ignore local build artifacts, secrets, and dependencies
- [`tsconfig.json`](/Users/diygod/Code/Projects/cloudflare-kv-api/tsconfig.json): strict TypeScript configuration for Worker code and tests
- [`wrangler.jsonc`](/Users/diygod/Code/Projects/cloudflare-kv-api/wrangler.jsonc): Worker entrypoint, compatibility date, and KV binding declaration
- [`worker-configuration.d.ts`](/Users/diygod/Code/Projects/cloudflare-kv-api/worker-configuration.d.ts): generated Cloudflare binding types from `wrangler types`
- [`src/index.ts`](/Users/diygod/Code/Projects/cloudflare-kv-api/src/index.ts): exported `fetchHandler`, route matching, request validation, and endpoint orchestration
- [`src/lib/http.ts`](/Users/diygod/Code/Projects/cloudflare-kv-api/src/lib/http.ts): JSON response helpers and request-body parsing helpers
- [`src/lib/auth.ts`](/Users/diygod/Code/Projects/cloudflare-kv-api/src/lib/auth.ts): bearer-token validation
- [`src/lib/keys.ts`](/Users/diygod/Code/Projects/cloudflare-kv-api/src/lib/keys.ts): cache-key decoding, validation, and internal key prefix helpers
- [`src/lib/store.ts`](/Users/diygod/Code/Projects/cloudflare-kv-api/src/lib/store.ts): KV read/write/touch helpers and metadata handling
- [`test/health.test.ts`](/Users/diygod/Code/Projects/cloudflare-kv-api/test/health.test.ts): readiness endpoint coverage
- [`test/auth.test.ts`](/Users/diygod/Code/Projects/cloudflare-kv-api/test/auth.test.ts): authentication and method-guard coverage
- [`test/cache-basic.test.ts`](/Users/diygod/Code/Projects/cloudflare-kv-api/test/cache-basic.test.ts): `PUT`/`GET`/`HEAD`, input validation, and normal TTL storage
- [`test/cache-lifecycle.test.ts`](/Users/diygod/Code/Projects/cloudflare-kv-api/test/cache-lifecycle.test.ts): short TTL compatibility, logical expiry, and `touch`
- [`test/cache-refresh.test.ts`](/Users/diygod/Code/Projects/cloudflare-kv-api/test/cache-refresh.test.ts): `GET ?refresh=1` background refresh behavior
- [`test/helpers/fake-kv.ts`](/Users/diygod/Code/Projects/cloudflare-kv-api/test/helpers/fake-kv.ts): deterministic in-memory KV double with TTL inspection hooks
- [`test/helpers/worker.ts`](/Users/diygod/Code/Projects/cloudflare-kv-api/test/helpers/worker.ts): Worker test harness and reusable auth header builder
- [`README.md`](/Users/diygod/Code/Projects/cloudflare-kv-api/README.md): setup, API contract, local development, and Cloudflare deployment notes

### Task 1: Bootstrap Tooling and Health Route

**Files:**
- Create: [`package.json`](/Users/diygod/Code/Projects/cloudflare-kv-api/package.json)
- Create: [`.gitignore`](/Users/diygod/Code/Projects/cloudflare-kv-api/.gitignore)
- Create: [`tsconfig.json`](/Users/diygod/Code/Projects/cloudflare-kv-api/tsconfig.json)
- Create: [`wrangler.jsonc`](/Users/diygod/Code/Projects/cloudflare-kv-api/wrangler.jsonc)
- Create: [`src/index.ts`](/Users/diygod/Code/Projects/cloudflare-kv-api/src/index.ts)
- Create: [`test/health.test.ts`](/Users/diygod/Code/Projects/cloudflare-kv-api/test/health.test.ts)
- Generate: [`worker-configuration.d.ts`](/Users/diygod/Code/Projects/cloudflare-kv-api/worker-configuration.d.ts)

- [ ] **Step 1: Write the bootstrap files and a compile-only Worker shell**

`/Users/diygod/Code/Projects/cloudflare-kv-api/package.json`

```json
{
  "name": "cloudflare-kv-api",
  "private": true,
  "type": "module",
  "scripts": {
    "check": "tsc --noEmit",
    "dev": "wrangler dev",
    "deploy:dry-run": "wrangler deploy --dry-run",
    "test": "vitest run",
    "test:watch": "vitest",
    "types": "wrangler types ./worker-configuration.d.ts"
  },
  "devDependencies": {
    "typescript": "6.0.3",
    "vitest": "4.1.5",
    "wrangler": "4.84.1"
  }
}
```

`/Users/diygod/Code/Projects/cloudflare-kv-api/.gitignore`

```gitignore
.wrangler/
.dev.vars
node_modules/
coverage/
dist/
```

`/Users/diygod/Code/Projects/cloudflare-kv-api/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "isolatedModules": true,
    "noEmit": true,
    "lib": ["ES2023", "WebWorker"],
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "worker-configuration.d.ts"]
}
```

`/Users/diygod/Code/Projects/cloudflare-kv-api/wrangler.jsonc`

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "cloudflare-kv-api",
  "main": "src/index.ts",
  "compatibility_date": "2026-04-23",
  "kv_namespaces": [
    {
      "binding": "CACHE_KV",
      "id": "00000000000000000000000000000000",
      "preview_id": "00000000000000000000000000000000"
    }
  ]
}
```

`/Users/diygod/Code/Projects/cloudflare-kv-api/src/index.ts`

```ts
export const fetchHandler: ExportedHandler<Env>["fetch"] = async () => new Response("Not Found", { status: 404 });

export default {
  fetch: fetchHandler,
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 2: Install the pinned toolchain**

Run:

```bash
npm install
```

Expected: `package-lock.json` is created and the install completes without errors.

- [ ] **Step 3: Generate Worker binding types from Wrangler config**

Run:

```bash
npm run types
```

Expected: [`worker-configuration.d.ts`](/Users/diygod/Code/Projects/cloudflare-kv-api/worker-configuration.d.ts) is created successfully.

- [ ] **Step 4: Write the failing health-route test**

`/Users/diygod/Code/Projects/cloudflare-kv-api/test/health.test.ts`

```ts
import { describe, expect, it } from "vitest";

import { fetchHandler } from "../src/index";

const env = {} as Env;
const ctx = {
  passThroughOnException() {},
  waitUntil() {},
} as unknown as ExecutionContext;

describe("GET /health", () => {
  it("returns an unauthenticated readiness payload", async () => {
    const request = new Request("https://example.com/health") as Request<unknown, IncomingRequestCfProperties<unknown>>;
    const response = await fetchHandler!(request, env, ctx);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});
```

- [ ] **Step 5: Run the test to verify it fails for the right reason**

Run:

```bash
npm test -- test/health.test.ts
```

Expected: FAIL with an assertion like `Expected: 200, Received: 404`.

- [ ] **Step 6: Write the minimal health implementation**

Replace [`src/index.ts`](/Users/diygod/Code/Projects/cloudflare-kv-api/src/index.ts) with:

```ts
export const fetchHandler: ExportedHandler<Env>["fetch"] = async (request) => {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/health") {
    return Response.json({ ok: true });
  }

  return new Response("Not Found", { status: 404 });
};

export default {
  fetch: fetchHandler,
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 7: Run the health test and typecheck**

Run:

```bash
npm test -- test/health.test.ts
npm run check
```

Expected:

- `test/health.test.ts` passes
- `tsc --noEmit` exits cleanly

- [ ] **Step 8: Commit the bootstrap**

Run:

```bash
git add .gitignore package.json package-lock.json tsconfig.json wrangler.jsonc worker-configuration.d.ts src/index.ts test/health.test.ts
git commit -m "chore: bootstrap Cloudflare Worker cache service"
```

### Task 2: Add Authentication Guards and JSON Error Helpers

**Files:**
- Create: [`src/lib/http.ts`](/Users/diygod/Code/Projects/cloudflare-kv-api/src/lib/http.ts)
- Create: [`src/lib/auth.ts`](/Users/diygod/Code/Projects/cloudflare-kv-api/src/lib/auth.ts)
- Create: [`test/auth.test.ts`](/Users/diygod/Code/Projects/cloudflare-kv-api/test/auth.test.ts)
- Modify: [`src/index.ts`](/Users/diygod/Code/Projects/cloudflare-kv-api/src/index.ts)

- [ ] **Step 1: Write failing auth and method-guard tests**

`/Users/diygod/Code/Projects/cloudflare-kv-api/test/auth.test.ts`

```ts
import { describe, expect, it } from "vitest";

import { fetchHandler } from "../src/index";

const ctx: ExecutionContext = {
  passThroughOnException() {},
  waitUntil() {},
};

describe("cache route authentication", () => {
  it("rejects cache requests without a bearer token", async () => {
    const request = new Request("https://example.com/v1/cache/article%3A1");
    const response = await fetchHandler(request, { API_TOKEN: "test-token" } as Env, ctx);

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
    });

    const response = await fetchHandler(request, { API_TOKEN: "test-token" } as Env, ctx);

    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Method not allowed",
      },
    });
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run:

```bash
npm test -- test/auth.test.ts
```

Expected: FAIL because the Worker still returns `404` or non-JSON responses for cache routes.

- [ ] **Step 3: Implement JSON helpers, bearer auth, and route guards**

`/Users/diygod/Code/Projects/cloudflare-kv-api/src/lib/http.ts`

```ts
export const json = (body: unknown, init: ResponseInit = {}) => {
  const response = new Response(JSON.stringify(body), init);
  response.headers.set("content-type", "application/json; charset=utf-8");
  return response;
};

export const errorResponse = (status: number, code: string, message: string) =>
  json(
    {
      error: {
        code,
        message,
      },
    },
    { status }
  );
```

`/Users/diygod/Code/Projects/cloudflare-kv-api/src/lib/auth.ts`

```ts
export const isAuthorized = (request: Request, env: Env) =>
  request.headers.get("authorization") === `Bearer ${env.API_TOKEN}`;
```

Replace [`src/index.ts`](/Users/diygod/Code/Projects/cloudflare-kv-api/src/index.ts) with:

```ts
import { isAuthorized } from "./lib/auth";
import { errorResponse } from "./lib/http";

export const fetchHandler: ExportedHandler<Env>["fetch"] = async (request, env) => {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/health") {
    return Response.json({ ok: true });
  }

  if (!url.pathname.startsWith("/v1/cache/")) {
    return errorResponse(404, "NOT_FOUND", "Route not found");
  }

  if (!isAuthorized(request, env)) {
    return errorResponse(401, "UNAUTHORIZED", "Missing or invalid bearer token");
  }

  return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed");
};

export default {
  fetch: fetchHandler,
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 4: Run the focused tests and the existing health test**

Run:

```bash
npm test -- test/auth.test.ts test/health.test.ts
npm run check
```

Expected:

- both test files pass
- `tsc --noEmit` exits cleanly

- [ ] **Step 5: Commit the route guards**

Run:

```bash
git add src/index.ts src/lib/http.ts src/lib/auth.ts test/auth.test.ts
git commit -m "feat: add authenticated cache route guards"
```

### Task 3: Add `PUT` / `GET` / `HEAD`, Input Validation, and Normal TTL Storage

**Files:**
- Create: [`src/lib/keys.ts`](/Users/diygod/Code/Projects/cloudflare-kv-api/src/lib/keys.ts)
- Create: [`src/lib/store.ts`](/Users/diygod/Code/Projects/cloudflare-kv-api/src/lib/store.ts)
- Create: [`test/helpers/fake-kv.ts`](/Users/diygod/Code/Projects/cloudflare-kv-api/test/helpers/fake-kv.ts)
- Create: [`test/helpers/worker.ts`](/Users/diygod/Code/Projects/cloudflare-kv-api/test/helpers/worker.ts)
- Create: [`test/cache-basic.test.ts`](/Users/diygod/Code/Projects/cloudflare-kv-api/test/cache-basic.test.ts)
- Modify: [`src/lib/http.ts`](/Users/diygod/Code/Projects/cloudflare-kv-api/src/lib/http.ts)
- Modify: [`src/index.ts`](/Users/diygod/Code/Projects/cloudflare-kv-api/src/index.ts)

- [ ] **Step 1: Write failing tests for `PUT`, `GET`, `HEAD`, and basic validation**

`/Users/diygod/Code/Projects/cloudflare-kv-api/test/helpers/fake-kv.ts`

```ts
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
```

`/Users/diygod/Code/Projects/cloudflare-kv-api/test/helpers/worker.ts`

```ts
import { fetchHandler } from "../../src/index";
import { FakeKVNamespace } from "./fake-kv";

export const authHeaders = () => ({
  Authorization: "Bearer test-token",
});

export const createHarness = () => {
  const CACHE_KV = new FakeKVNamespace();
  const env = {
    API_TOKEN: "test-token",
    CACHE_KV: CACHE_KV as unknown as KVNamespace,
  } as Env;

  const tasks: Promise<unknown>[] = [];
  const ctx: ExecutionContext = {
    passThroughOnException() {},
    waitUntil(promise) {
      tasks.push(promise);
    },
  };

  return {
    env,
    kv: CACHE_KV,
    fetch(path: string, init?: RequestInit) {
      return fetchHandler(new Request(`https://example.com${path}`, init), env, ctx);
    },
    waitOnExecutionContext() {
      return Promise.all(tasks);
    },
  };
};
```

`/Users/diygod/Code/Projects/cloudflare-kv-api/test/cache-basic.test.ts`

```ts
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
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run:

```bash
npm test -- test/cache-basic.test.ts
```

Expected: FAIL because the Worker still returns `405 Method Not Allowed` for authorized cache routes.

- [ ] **Step 3: Implement key validation, JSON body parsing, and normal TTL storage**

Replace [`src/lib/http.ts`](/Users/diygod/Code/Projects/cloudflare-kv-api/src/lib/http.ts) with:

```ts
export const json = (body: unknown, init: ResponseInit = {}) => {
  const response = new Response(JSON.stringify(body), init);
  response.headers.set("content-type", "application/json; charset=utf-8");
  return response;
};

export const errorResponse = (status: number, code: string, message: string) =>
  json(
    {
      error: {
        code,
        message,
      },
    },
    { status }
  );

export const readJson = async <T>(request: Request) => {
  try {
    return { ok: true as const, value: (await request.json()) as T };
  } catch {
    return {
      ok: false as const,
      response: errorResponse(400, "INVALID_JSON", "Request body must be valid JSON"),
    };
  }
};
```

`/Users/diygod/Code/Projects/cloudflare-kv-api/src/lib/keys.ts`

```ts
import { errorResponse } from "./http";

const KEY_MAX_BYTES = 512;
const RESERVED_PREFIXES = ["data:", "meta:"];

export const dataKey = (key: string) => `data:${key}`;
export const metaKey = (key: string) => `meta:${key}`;

export const parseCacheKey = (encodedKey: string) => {
  if (!encodedKey) {
    return {
      ok: false as const,
      response: errorResponse(400, "INVALID_KEY", "Cache key must not be empty"),
    };
  }

  let key: string;

  try {
    key = decodeURIComponent(encodedKey);
  } catch {
    return {
      ok: false as const,
      response: errorResponse(400, "INVALID_KEY", "Cache key must be valid URL encoding"),
    };
  }

  if (RESERVED_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    return {
      ok: false as const,
      response: errorResponse(400, "INVALID_KEY", "Cache key uses a reserved prefix"),
    };
  }

  if (new TextEncoder().encode(key).byteLength > KEY_MAX_BYTES) {
    return {
      ok: false as const,
      response: errorResponse(400, "INVALID_KEY", "Cache key exceeds 512 bytes"),
    };
  }

  return {
    ok: true as const,
    key,
  };
};
```

`/Users/diygod/Code/Projects/cloudflare-kv-api/src/lib/store.ts`

```ts
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
  const [value] = await Promise.all([kv.get(dataKey(key)), kv.get(metaKey(key))]);

  if (value === null) {
    return {
      hit: false as const,
      expired: false,
    };
  }

  return {
    hit: true as const,
    value,
  };
};
```

Replace [`src/index.ts`](/Users/diygod/Code/Projects/cloudflare-kv-api/src/index.ts) with:

```ts
import { isAuthorized } from "./lib/auth";
import { errorResponse, json, readJson } from "./lib/http";
import { parseCacheKey } from "./lib/keys";
import { putCache, readCache } from "./lib/store";

type PutBody = {
  ttl: number;
  value: string;
};

const CACHE_ROUTE = /^\/v1\/cache\/([^/]+)$/;

export const fetchHandler: ExportedHandler<Env>["fetch"] = async (request, env) => {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/health") {
    return Response.json({ ok: true });
  }

  const cacheMatch = url.pathname.match(CACHE_ROUTE);

  if (!cacheMatch) {
    return errorResponse(404, "NOT_FOUND", "Route not found");
  }

  if (!isAuthorized(request, env)) {
    return errorResponse(401, "UNAUTHORIZED", "Missing or invalid bearer token");
  }

  const parsedKey = parseCacheKey(cacheMatch[1]);
  if (!parsedKey.ok) {
    return parsedKey.response;
  }

  if (request.method === "GET") {
    const result = await readCache(env.CACHE_KV, parsedKey.key);
    if (!result.hit) {
      return json({ hit: false }, { status: 404 });
    }
    return json({ hit: true, value: result.value });
  }

  if (request.method === "HEAD") {
    const result = await readCache(env.CACHE_KV, parsedKey.key);
    return new Response(null, { status: result.hit ? 204 : 404 });
  }

  if (request.method === "PUT") {
    const parsedBody = await readJson<PutBody>(request);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }

    const { ttl, value } = parsedBody.value;

    if (!Number.isInteger(ttl) || ttl <= 0) {
      return errorResponse(400, "INVALID_TTL", "ttl must be a positive integer");
    }

    if (typeof value !== "string") {
      return errorResponse(400, "INVALID_VALUE", "value must be a string");
    }

    await putCache(env.CACHE_KV, parsedKey.key, value, ttl);
    return new Response(null, { status: 204 });
  }

  return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed");
};

export default {
  fetch: fetchHandler,
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 4: Run the targeted tests and existing coverage**

Run:

```bash
npm test -- test/cache-basic.test.ts test/auth.test.ts test/health.test.ts
npm run check
```

Expected:

- all three test files pass
- `tsc --noEmit` exits cleanly

- [ ] **Step 5: Commit the basic cache API**

Run:

```bash
git add src/index.ts src/lib/http.ts src/lib/keys.ts src/lib/store.ts test/helpers/fake-kv.ts test/helpers/worker.ts test/cache-basic.test.ts
git commit -m "feat: add KV-backed get put and head endpoints"
```

### Task 4: Add Short-TTL Compatibility, Logical Expiry, and `touch`

**Files:**
- Create: [`test/cache-lifecycle.test.ts`](/Users/diygod/Code/Projects/cloudflare-kv-api/test/cache-lifecycle.test.ts)
- Modify: [`src/lib/http.ts`](/Users/diygod/Code/Projects/cloudflare-kv-api/src/lib/http.ts)
- Modify: [`src/lib/store.ts`](/Users/diygod/Code/Projects/cloudflare-kv-api/src/lib/store.ts)
- Modify: [`src/index.ts`](/Users/diygod/Code/Projects/cloudflare-kv-api/src/index.ts)

- [ ] **Step 1: Write failing tests for short TTLs, logical expiry, and `touch`**

`/Users/diygod/Code/Projects/cloudflare-kv-api/test/cache-lifecycle.test.ts`

```ts
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
```

- [ ] **Step 2: Run the lifecycle tests to verify they fail**

Run:

```bash
npm test -- test/cache-lifecycle.test.ts
```

Expected: FAIL because short TTLs still use the raw KV expiry, expired metadata is ignored, and `/touch` does not exist yet.

- [ ] **Step 3: Implement logical-expiry reads, short-TTL writes, and `touch`**

Replace [`src/lib/http.ts`](/Users/diygod/Code/Projects/cloudflare-kv-api/src/lib/http.ts) with:

```ts
export const json = (body: unknown, init: ResponseInit = {}) => {
  const response = new Response(JSON.stringify(body), init);
  response.headers.set("content-type", "application/json; charset=utf-8");
  return response;
};

export const errorResponse = (status: number, code: string, message: string) =>
  json(
    {
      error: {
        code,
        message,
      },
    },
    { status }
  );

export const readJson = async <T>(request: Request) => {
  try {
    return { ok: true as const, value: (await request.json()) as T };
  } catch {
    return {
      ok: false as const,
      response: errorResponse(400, "INVALID_JSON", "Request body must be valid JSON"),
    };
  }
};

export const readOptionalJson = async <T>(request: Request) => {
  if (!request.body) {
    return { ok: true as const, value: {} as T };
  }

  const text = await request.text();
  if (!text) {
    return { ok: true as const, value: {} as T };
  }

  try {
    return { ok: true as const, value: JSON.parse(text) as T };
  } catch {
    return {
      ok: false as const,
      response: errorResponse(400, "INVALID_JSON", "Request body must be valid JSON"),
    };
  }
};
```

Replace [`src/lib/store.ts`](/Users/diygod/Code/Projects/cloudflare-kv-api/src/lib/store.ts) with:

```ts
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

  const metadata = JSON.parse(metadataRaw) as CacheMetadata;

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
    return current.expired ? { ok: false as const, status: 404, expired: true } : { ok: false as const, status: 404, expired: false };
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
```

Replace [`src/index.ts`](/Users/diygod/Code/Projects/cloudflare-kv-api/src/index.ts) with:

```ts
import { isAuthorized } from "./lib/auth";
import { errorResponse, json, readJson, readOptionalJson } from "./lib/http";
import { parseCacheKey } from "./lib/keys";
import { putCache, readCache, touchCache } from "./lib/store";

type PutBody = {
  ttl: number;
  value: string;
};

type TouchBody = {
  ttl?: number;
};

const CACHE_ROUTE = /^\/v1\/cache\/([^/]+)$/;
const TOUCH_ROUTE = /^\/v1\/cache\/([^/]+)\/touch$/;

export const fetchHandler: ExportedHandler<Env>["fetch"] = async (request, env) => {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/health") {
    return Response.json({ ok: true });
  }

  const touchMatch = url.pathname.match(TOUCH_ROUTE);
  const cacheMatch = url.pathname.match(CACHE_ROUTE);

  if (!touchMatch && !cacheMatch) {
    return errorResponse(404, "NOT_FOUND", "Route not found");
  }

  if (!isAuthorized(request, env)) {
    return errorResponse(401, "UNAUTHORIZED", "Missing or invalid bearer token");
  }

  if (touchMatch && request.method === "POST") {
    const parsedKey = parseCacheKey(touchMatch[1]);
    if (!parsedKey.ok) {
      return parsedKey.response;
    }

    const parsedBody = await readOptionalJson<TouchBody>(request);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }

    if (parsedBody.value.ttl !== undefined && (!Number.isInteger(parsedBody.value.ttl) || parsedBody.value.ttl <= 0)) {
      return errorResponse(400, "INVALID_TTL", "ttl must be a positive integer");
    }

    const result = await touchCache(env.CACHE_KV, parsedKey.key, parsedBody.value.ttl);
    if (!result.ok && result.status === 400) {
      return errorResponse(400, "INVALID_TTL", "touch requires ttl when metadata is missing");
    }
    if (!result.ok) {
      return json({ hit: false, expired: result.expired }, { status: 404 });
    }

    return new Response(null, { status: 204 });
  }

  if (!cacheMatch) {
    return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed");
  }

  const parsedKey = parseCacheKey(cacheMatch[1]);
  if (!parsedKey.ok) {
    return parsedKey.response;
  }

  if (request.method === "GET") {
    const result = await readCache(env.CACHE_KV, parsedKey.key);
    if (!result.hit) {
      return json(result.expired ? { hit: false, expired: true } : { hit: false }, { status: 404 });
    }
    return json({ hit: true, value: result.value });
  }

  if (request.method === "HEAD") {
    const result = await readCache(env.CACHE_KV, parsedKey.key);
    return new Response(null, { status: result.hit ? 204 : 404 });
  }

  if (request.method === "PUT") {
    const parsedBody = await readJson<PutBody>(request);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }

    const { ttl, value } = parsedBody.value;

    if (!Number.isInteger(ttl) || ttl <= 0) {
      return errorResponse(400, "INVALID_TTL", "ttl must be a positive integer");
    }

    if (typeof value !== "string") {
      return errorResponse(400, "INVALID_VALUE", "value must be a string");
    }

    await putCache(env.CACHE_KV, parsedKey.key, value, ttl);
    return new Response(null, { status: 204 });
  }

  return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed");
};

export default {
  fetch: fetchHandler,
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 4: Run lifecycle tests plus the earlier suites**

Run:

```bash
npm test -- test/cache-lifecycle.test.ts test/cache-basic.test.ts test/auth.test.ts test/health.test.ts
npm run check
```

Expected:

- all listed tests pass
- `tsc --noEmit` exits cleanly

- [ ] **Step 5: Commit lifecycle behavior**

Run:

```bash
git add src/index.ts src/lib/http.ts src/lib/store.ts test/cache-lifecycle.test.ts
git commit -m "feat: add logical expiry and touch semantics"
```

### Task 5: Add `GET ?refresh=1` Background Refresh

**Files:**
- Create: [`test/cache-refresh.test.ts`](/Users/diygod/Code/Projects/cloudflare-kv-api/test/cache-refresh.test.ts)
- Modify: [`src/index.ts`](/Users/diygod/Code/Projects/cloudflare-kv-api/src/index.ts)

- [ ] **Step 1: Write failing tests for refresh-on-read**

`/Users/diygod/Code/Projects/cloudflare-kv-api/test/cache-refresh.test.ts`

```ts
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
```

- [ ] **Step 2: Run the refresh tests to verify they fail**

Run:

```bash
npm test -- test/cache-refresh.test.ts
```

Expected: FAIL because `GET` currently ignores the `refresh=1` query parameter and never schedules a background rewrite.

- [ ] **Step 3: Implement background refresh with `ctx.waitUntil(...)`**

Replace [`src/index.ts`](/Users/diygod/Code/Projects/cloudflare-kv-api/src/index.ts) with:

```ts
import { isAuthorized } from "./lib/auth";
import { errorResponse, json, readJson, readOptionalJson } from "./lib/http";
import { parseCacheKey } from "./lib/keys";
import { putCache, readCache, touchCache } from "./lib/store";

type PutBody = {
  ttl: number;
  value: string;
};

type TouchBody = {
  ttl?: number;
};

const CACHE_ROUTE = /^\/v1\/cache\/([^/]+)$/;
const TOUCH_ROUTE = /^\/v1\/cache\/([^/]+)\/touch$/;

export const fetchHandler: ExportedHandler<Env>["fetch"] = async (request, env, ctx) => {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/health") {
    return Response.json({ ok: true });
  }

  const touchMatch = url.pathname.match(TOUCH_ROUTE);
  const cacheMatch = url.pathname.match(CACHE_ROUTE);

  if (!touchMatch && !cacheMatch) {
    return errorResponse(404, "NOT_FOUND", "Route not found");
  }

  if (!isAuthorized(request, env)) {
    return errorResponse(401, "UNAUTHORIZED", "Missing or invalid bearer token");
  }

  if (touchMatch && request.method === "POST") {
    const parsedKey = parseCacheKey(touchMatch[1]);
    if (!parsedKey.ok) {
      return parsedKey.response;
    }

    const parsedBody = await readOptionalJson<TouchBody>(request);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }

    if (parsedBody.value.ttl !== undefined && (!Number.isInteger(parsedBody.value.ttl) || parsedBody.value.ttl <= 0)) {
      return errorResponse(400, "INVALID_TTL", "ttl must be a positive integer");
    }

    const result = await touchCache(env.CACHE_KV, parsedKey.key, parsedBody.value.ttl);
    if (!result.ok && result.status === 400) {
      return errorResponse(400, "INVALID_TTL", "touch requires ttl when metadata is missing");
    }
    if (!result.ok) {
      return json({ hit: false, expired: result.expired }, { status: 404 });
    }

    return new Response(null, { status: 204 });
  }

  if (!cacheMatch) {
    return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed");
  }

  const parsedKey = parseCacheKey(cacheMatch[1]);
  if (!parsedKey.ok) {
    return parsedKey.response;
  }

  if (request.method === "GET") {
    const result = await readCache(env.CACHE_KV, parsedKey.key);
    if (!result.hit) {
      return json(result.expired ? { hit: false, expired: true } : { hit: false }, { status: 404 });
    }

    if (url.searchParams.get("refresh") === "1" && result.metadata) {
      ctx.waitUntil(putCache(env.CACHE_KV, parsedKey.key, result.value, result.metadata.ttl));
    }

    return json({ hit: true, value: result.value });
  }

  if (request.method === "HEAD") {
    const result = await readCache(env.CACHE_KV, parsedKey.key);
    return new Response(null, { status: result.hit ? 204 : 404 });
  }

  if (request.method === "PUT") {
    const parsedBody = await readJson<PutBody>(request);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }

    const { ttl, value } = parsedBody.value;

    if (!Number.isInteger(ttl) || ttl <= 0) {
      return errorResponse(400, "INVALID_TTL", "ttl must be a positive integer");
    }

    if (typeof value !== "string") {
      return errorResponse(400, "INVALID_VALUE", "value must be a string");
    }

    await putCache(env.CACHE_KV, parsedKey.key, value, ttl);
    return new Response(null, { status: 204 });
  }

  return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed");
};

export default {
  fetch: fetchHandler,
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 4: Run the refresh tests and the full suite**

Run:

```bash
npm test -- test/cache-refresh.test.ts test/cache-lifecycle.test.ts test/cache-basic.test.ts test/auth.test.ts test/health.test.ts
npm run check
```

Expected:

- all five test files pass
- `tsc --noEmit` exits cleanly

- [ ] **Step 5: Commit refresh-on-read behavior**

Run:

```bash
git add src/index.ts test/cache-refresh.test.ts
git commit -m "feat: refresh cache ttl on read hits"
```

### Task 6: Add README and Final Verification

**Files:**
- Create: [`README.md`](/Users/diygod/Code/Projects/cloudflare-kv-api/README.md)

- [ ] **Step 1: Write the README with setup, API semantics, and Cloudflare caveats**

`/Users/diygod/Code/Projects/cloudflare-kv-api/README.md`

```md
# cloudflare-kv-api

Minimal authenticated HTTP cache API for RSSHub, backed by Cloudflare Workers KV.

## Features

- `GET /health`
- `GET /v1/cache/{key}`
- `HEAD /v1/cache/{key}`
- `PUT /v1/cache/{key}`
- `POST /v1/cache/{key}/touch`
- bearer-token authentication for cache routes
- logical-expiry compatibility for TTL values below 60 seconds

## Local Development

1. Install dependencies:

   ```bash
   npm install
   ```

2. Generate binding types:

   ```bash
   npm run types
   ```

3. Create `.dev.vars` with a local token:

   ```dotenv
   API_TOKEN=replace-me
   ```

4. Start the Worker locally:

   ```bash
   npm run dev
   ```

## Cloudflare Setup

1. Create the KV namespace:

   ```bash
   wrangler kv namespace create CACHE_KV
   wrangler kv namespace create CACHE_KV --preview
   ```

2. Copy the returned IDs into [`wrangler.jsonc`](/Users/diygod/Code/Projects/cloudflare-kv-api/wrangler.jsonc).

3. Set the production secret:

   ```bash
   wrangler secret put API_TOKEN
   ```

4. Deploy:

   ```bash
   wrangler deploy
   ```

## API

### Authentication

All cache endpoints require:

```http
Authorization: Bearer <token>
```

### `GET /health`

Returns:

```json
{ "ok": true }
```

### `PUT /v1/cache/{key}`

Request:

```json
{
  "value": "payload",
  "ttl": 3600
}
```

Response:

- `204 No Content`

### `GET /v1/cache/{key}`

Response on hit:

```json
{
  "hit": true,
  "value": "payload"
}
```

Response on miss:

```json
{
  "hit": false
}
```

Response on logical expiry:

```json
{
  "hit": false,
  "expired": true
}
```

Use `?refresh=1` to renew TTL in the background on hit when metadata is available.

### `HEAD /v1/cache/{key}`

- `204 No Content` on hit
- `404 Not Found` on miss or logical expiry

### `POST /v1/cache/{key}/touch`

Optional request body:

```json
{
  "ttl": 300
}
```

If `ttl` is omitted, the service reuses the TTL stored in metadata.

## Important Caveats

- Cloudflare Workers KV only supports `expirationTtl >= 60`.
- TTL values below `60` seconds are implemented with logical expiry metadata.
- Workers KV is eventually consistent and can serve stale reads shortly after writes.
- This service is suitable for RSSHub cache semantics, not for strict distributed-lock guarantees.
```

- [ ] **Step 2: Run the full verification checklist**

Run:

```bash
npm test
npm run check
npm run types
npm run deploy:dry-run
```

Expected:

- all tests pass
- typecheck passes
- `worker-configuration.d.ts` stays up to date
- dry-run bundles successfully without code errors

- [ ] **Step 3: Commit the docs and verified build state**

Run:

```bash
git add README.md worker-configuration.d.ts
git commit -m "docs: add setup and API usage guide"
```

# Cloudflare KV HTTP Cache for RSSHub

Date: 2026-04-23
Status: Ready for review

## Goal

Build a Cloudflare Worker backed by Cloudflare Workers KV that exposes a minimal authenticated HTTP cache API for RSSHub.

The service is intended to satisfy RSSHub's current cache semantics only. It is not a general Redis replacement and does not attempt wire compatibility with Redis TCP or RESP.

## Scope

In scope:

- A Cloudflare Worker service in this repository only
- Cloudflare Workers KV as the storage backend
- Minimal cache operations needed by RSSHub
- Authentication for all cache operations
- Compatibility handling for RSSHub TTL values below Workers KV's minimum TTL

Out of scope:

- Changes inside the RSSHub repository
- General-purpose Redis command coverage
- Delete, list, scan, or batch APIs
- Strong-consistency or distributed-lock guarantees

## Constraints

### RSSHub cache semantics in use

RSSHub currently relies on a small subset of cache behavior:

- `get(key, refresh?)`
- `set(key, value, ttl)`
- `exists(key)`
- TTL refresh on cache hit when `refresh` is enabled

RSSHub also uses short TTL values for control-flow keys such as temporary locks and immediate invalidation markers. Examples observed in the current codebase include `1s` and `20s`.

### Cloudflare Workers KV constraints

The design must account for the following Workers KV properties:

- `expirationTtl` has a minimum supported value of `60` seconds
- KV is eventually consistent and may serve stale reads for a short period after writes across locations
- TTL refresh requires rewriting values because KV does not support in-place expiry extension

These constraints mean the API can be Redis-like for RSSHub's cache needs, but not Redis-equivalent.

## API Design

### Authentication

All cache endpoints require:

`Authorization: Bearer <token>`

The bearer token is stored as a Worker secret. Requests with a missing or invalid token return `401 Unauthorized`.

`GET /health` is intentionally unauthenticated and returns a minimal readiness response only.

### Endpoints

#### `GET /health`

Purpose:

- Readiness and deployment smoke check

Response:

- `200 OK`
- Body: `{ "ok": true }`

#### `GET /v1/cache/{key}`

Purpose:

- Get a cache value
- Optionally refresh TTL on hit with `?refresh=1`

Success response:

- `200 OK`
- Body: `{ "hit": true, "value": "<string>" }`

Miss response:

- `404 Not Found`
- Body: `{ "hit": false }`

Expired response:

- `404 Not Found`
- Body: `{ "hit": false, "expired": true }`

#### `HEAD /v1/cache/{key}`

Purpose:

- Check whether a key currently exists and is not logically expired

Responses:

- `204 No Content` on hit
- `404 Not Found` on miss or logical expiry

#### `PUT /v1/cache/{key}`

Purpose:

- Store a string value with TTL in seconds

Request body:

```json
{
  "value": "cached string",
  "ttl": 3600
}
```

Success response:

- `204 No Content`

#### `POST /v1/cache/{key}/touch`

Purpose:

- Explicitly refresh a key's TTL without changing its value

Request body:

```json
{
  "ttl": 300
}
```

Rules:

- If `ttl` is omitted, the service reuses the original TTL stored in metadata
- Returns `404` when the key is missing or logically expired

Success response:

- `204 No Content`

## Key Encoding and Validation

Clients must URL-encode cache keys before placing them in the path.

Server-side handling:

- Decode with `decodeURIComponent`
- Reject empty keys
- Reject keys longer than the configured safety limit
- Reject keys that start with reserved internal prefixes

Reserved prefixes:

- `data:`
- `meta:`

Recommended safety limit:

- `512` bytes maximum for the decoded key

## Storage Model

Each logical cache key maps to two KV entries:

- `data:{key}` for the actual cached string
- `meta:{key}` for metadata as JSON

Metadata shape:

```json
{
  "ttl": 3600,
  "logicalExpireAt": 1770000000000,
  "updatedAt": 1769996400000
}
```

Fields:

- `ttl`: the original requested TTL in seconds
- `logicalExpireAt`: absolute expiration time in milliseconds since epoch using the original TTL
- `updatedAt`: last write or refresh timestamp in milliseconds since epoch

## TTL Compatibility Strategy

### Normal TTLs

When `ttl >= 60`:

- Store `data:{key}` with `expirationTtl = ttl`
- Store `meta:{key}` with `expirationTtl = ttl`
- Set `logicalExpireAt = now + ttl * 1000`

### Short TTLs

When `ttl < 60`:

- Store both KV entries with `expirationTtl = 60`
- Still record the original requested TTL in metadata
- Set `logicalExpireAt = now + ttl * 1000`
- Treat the key as expired once `logicalExpireAt` has passed, even if KV has not yet evicted the stored entries

This preserves RSSHub's short-lived lock and invalidation semantics as closely as possible within Workers KV limits.

## Read Path

For `GET` and `HEAD`:

1. Read `data:{key}` and `meta:{key}` concurrently
2. If `data:{key}` is absent, treat as a miss
3. If `meta:{key}` is absent, treat as a compatibility fallback hit without logical-expiry enforcement
4. If `meta.logicalExpireAt <= now`, treat as expired and return `404`
5. Otherwise treat as a hit

For `GET ?refresh=1`:

- Return the current value immediately
- If metadata exists, refresh TTL in the background with `ctx.waitUntil(...)`
- Recalculate `logicalExpireAt` using the original TTL from metadata
- Rewrite both KV entries because KV has no native touch operation
- If metadata is missing, skip refresh and return the value as-is

## Touch Path

For `POST /v1/cache/{key}/touch`:

1. Read `data:{key}` and `meta:{key}`
2. If data is missing, return `404`
3. If metadata exists and the key is logically expired, return `404`
4. Determine TTL:
   - request body `ttl` if provided
   - otherwise `meta.ttl`
5. Rewrite `data:{key}` and `meta:{key}` with refreshed timestamps
6. Use `Math.max(ttl, 60)` for actual KV expiration

If metadata is missing and no `ttl` is provided in the request body, return `400 Bad Request` instead of guessing.

## Error Model

Error responses use this shape:

```json
{
  "error": {
    "code": "INVALID_TTL",
    "message": "ttl must be a positive integer"
  }
}
```

Status mapping:

- `400 Bad Request`
  - invalid JSON
  - invalid key
  - invalid TTL
  - non-string value
- `401 Unauthorized`
  - missing bearer token
  - invalid bearer token
- `404 Not Found`
  - cache miss
  - logical expiry
- `405 Method Not Allowed`
  - unsupported method
- `500 Internal Server Error`
  - unexpected runtime or KV failures

## Consistency Contract

The service explicitly does not guarantee Redis-level strong consistency or atomic lock behavior.

The intended contract is:

- Suitable for RSSHub cache values
- Best-effort compatibility for short-lived control-flow keys
- Not suitable as a strict distributed lock service

Because Workers KV is eventually consistent, stale reads are possible shortly after writes or refreshes, especially across edge locations.

## Worker Configuration

The implementation should use:

- `wrangler.jsonc`
- a recent `compatibility_date`
- one KV namespace binding for cache storage
- one secret for the API bearer token

Expected binding names:

- `CACHE_KV`

Expected secret name:

- `API_TOKEN`

## Testing Strategy

Implementation should follow test-first development.

Primary test coverage:

- authentication required for cache endpoints
- `PUT` then `GET` returns the stored string
- `HEAD` returns `204` for hit and `404` for miss
- `GET ?refresh=1` schedules TTL refresh
- `touch` refreshes TTL using metadata
- `ttl < 60` uses logical expiry even though actual KV expiry is `60`
- logically expired keys return miss semantics
- invalid input returns the correct error code and status

Recommended validation after implementation:

- local tests
- `wrangler types`
- `wrangler deploy --dry-run`

## Implementation Notes

The service should stay intentionally narrow.

It should not add delete or list operations until RSSHub proves a real need for them.
It should keep values as strings only and leave JSON serialization concerns to callers.
It should keep routing and response formats simple enough for a thin RSSHub adapter layer later.

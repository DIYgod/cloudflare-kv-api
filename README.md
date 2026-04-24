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

2. Copy the returned IDs into [`wrangler.jsonc`](./wrangler.jsonc).

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

`{key}` must be sent as a single URL-encoded path segment. Keys containing `/`, `%`, and other reserved characters must be encoded before calling the API.

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

If `ttl` is omitted and metadata is missing, the API returns `400 Bad Request`.

## Important Caveats

- Cloudflare Workers KV only supports `expirationTtl >= 60`.
- TTL values below `60` seconds are implemented with logical expiry metadata.
- Workers KV is eventually consistent and can serve stale reads shortly after writes.
- `GET ?refresh=1` is best-effort and may race with concurrent writes because Workers KV has no atomic touch/CAS primitive.
- Hot `GET ?refresh=1` traffic is throttled to avoid Workers KV same-key write limits (about 1 write/sec). Refresh may be skipped when the key was updated too recently.
- This service is suitable for RSSHub cache semantics, not for strict distributed-lock guarantees.

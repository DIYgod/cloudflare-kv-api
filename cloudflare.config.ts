import { bindings, defineConfig } from "cf/config";

export default defineConfig({
  accountId: "1f1d1678a2413a54c944b3081bab5c84",
  worker: {
    name: "cloudflare-kv-api",
    compatibilityDate: "2026-04-23",
    entrypoint: "src/index.ts",
    env: {
      CACHE_KV: bindings.kv({
        id: "cb06bc63fbd24da0bab337be63058446",
      }),
      API_TOKEN: bindings.secret(),
    },
  },
});

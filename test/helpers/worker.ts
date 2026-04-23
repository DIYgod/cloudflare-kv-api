import { fetchHandler } from "../../src/index";
import { FakeKVNamespace } from "./fake-kv";

export const authHeaders = () => ({
  Authorization: "Bearer test-token",
});

const asWorkerRequest = (request: Request) =>
  request as Request<unknown, IncomingRequestCfProperties<unknown>>;

export const createHarness = () => {
  const CACHE_KV = new FakeKVNamespace();
  const env = {
    API_TOKEN: "test-token",
    CACHE_KV: CACHE_KV as unknown as KVNamespace,
  } as Env;

  const tasks: Promise<unknown>[] = [];
  const ctx = {
    passThroughOnException() {},
    waitUntil(promise: Promise<unknown>) {
      tasks.push(promise);
    },
  } as unknown as ExecutionContext;

  return {
    env,
    kv: CACHE_KV,
    fetch(path: string, init?: RequestInit) {
      return fetchHandler!(asWorkerRequest(new Request(`https://example.com${path}`, init)), env, ctx);
    },
    waitOnExecutionContext() {
      return Promise.all(tasks);
    },
  };
};

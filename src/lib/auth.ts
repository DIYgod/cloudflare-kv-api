export const isAuthorized = (request: Request, env: Env) =>
  request.headers.get("authorization") ===
  `Bearer ${(env as Env & { API_TOKEN: string }).API_TOKEN}`;

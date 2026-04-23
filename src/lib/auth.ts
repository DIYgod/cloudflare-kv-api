type AuthEnv = Env & {
  API_TOKEN?: string;
};

export const isAuthorized = (request: Request, env: AuthEnv) => {
  const token = env.API_TOKEN;

  return (
    typeof token === "string" &&
    token.length > 0 &&
    request.headers.get("authorization") === `Bearer ${token}`
  );
};

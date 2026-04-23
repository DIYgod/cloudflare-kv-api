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

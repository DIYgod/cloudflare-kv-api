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

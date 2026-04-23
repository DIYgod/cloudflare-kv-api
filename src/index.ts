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

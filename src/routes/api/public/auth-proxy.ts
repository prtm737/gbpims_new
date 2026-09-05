import { createFileRoute } from "@tanstack/react-router";

const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "DELETE"]);

export const Route = createFileRoute("/api/public/auth-proxy")({
  server: {
    handlers: {
      GET: forwardAuthRequest,
      POST: forwardAuthRequest,
      PUT: forwardAuthRequest,
      DELETE: forwardAuthRequest,
    },
  },
});

async function forwardAuthRequest({ request }: { request: Request }) {
  if (!ALLOWED_METHODS.has(request.method)) {
    return new Response("Method not allowed", { status: 405 });
  }

  const requestUrl = new URL(request.url);
  const path = requestUrl.searchParams.get("path") ?? "";
  if (!path.startsWith("/auth/v1/") || path.includes("..") || path.includes("\\")) {
    return new Response("Invalid authentication path", { status: 400 });
  }

  const backendUrl = process.env["SUPABASE_URL"];
  const publishableKey = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!backendUrl || !publishableKey) {
    return Response.json({ message: "Authentication is unavailable" }, { status: 503 });
  }

  const headers = new Headers();
  for (const name of ["accept", "accept-language", "authorization", "content-type", "x-client-info"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("apikey", publishableKey);

  const body = request.method === "GET" ? undefined : await request.arrayBuffer();
  try {
    const response = await fetch(`${backendUrl}${path}`, {
      method: request.method,
      headers,
      ...(body ? { body } : {}),
    });
    const responseHeaders = new Headers();
    for (const name of ["content-type", "content-range", "x-supabase-api-version"]) {
      const value = response.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    responseHeaders.set("cache-control", "no-store");
    return new Response(response.body, { status: response.status, headers: responseHeaders });
  } catch {
    return Response.json({ message: "Authentication service is temporarily unavailable" }, { status: 503 });
  }
}
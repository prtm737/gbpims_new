import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

function authProxyFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init);
  const upstream = new URL(request.url);
  const proxy = new URL("/api/public/auth-proxy", window.location.origin);
  proxy.searchParams.set("path", `${upstream.pathname}${upstream.search}`);

  return request.text().then((body) =>
    fetch(proxy, {
      method: request.method,
      headers: request.headers,
      ...(request.method === "GET" || request.method === "HEAD" ? {} : { body }),
      signal: request.signal,
    }),
  );
}

function createAuthClient() {
  const backendUrl = import.meta.env["VITE_SUPABASE_URL"];
  const publishableKey = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"];

  if (!backendUrl || !publishableKey) {
    throw new Error("Authentication is not configured.");
  }

  return createClient<Database>(backendUrl, publishableKey, {
    global: { fetch: authProxyFetch },
    auth: {
      storage: localStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}

let client: ReturnType<typeof createAuthClient> | undefined;

export const authClient = new Proxy({} as ReturnType<typeof createAuthClient>, {
  get(_, property, receiver) {
    if (!client) client = createAuthClient();
    return Reflect.get(client, property, receiver);
  },
});
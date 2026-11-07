import { createMiddleware } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

function isOpaqueApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

// Session validation must fail fast, not hang the whole server function.
const AUTH_FETCH_TIMEOUT_MS = 15_000;

function withDeadline(init: RequestInit | undefined): RequestInit {
  const timeout = AbortSignal.timeout(AUTH_FETCH_TIMEOUT_MS);
  const signal =
    init?.signal && typeof AbortSignal.any === "function"
      ? AbortSignal.any([init.signal, timeout])
      : timeout;
  return { ...(init ?? {}), signal };
}

function createBackendFetch(apiKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }
    if (isOpaqueApiKey(apiKey) && headers.get("Authorization") === `Bearer ${apiKey}`) {
      headers.delete("Authorization");
    }
    headers.set("apikey", apiKey);
    return fetch(input, withDeadline({ ...init, headers }));
  };
}

export const requireAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const backendUrl = process.env["SUPABASE_URL"];
  const publishableKey = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!backendUrl || !publishableKey) {
    throw new Error("Backend authentication is not configured.");
  }

  const { getRequestHeader } = await import("@tanstack/start-server-core/request-response");
  const authHeader = getRequestHeader("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Unauthorized: Sign in again to continue.");
  }
  const token = authHeader.slice(7);
  if (token.split(".").length !== 3) {
    throw new Error("Unauthorized: Invalid session.");
  }

  const supabase = createClient<Database>(backendUrl, publishableKey, {
    global: {
      fetch: createBackendFetch(publishableKey),
      headers: { Authorization: `Bearer ${token}` },
    },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getClaims(token).catch((cause: unknown) => {
    console.warn(`[auth] getClaims failed: ${(cause as Error)?.message ?? cause}`);
    return {
      data: null,
      error: new Error(
        "Could not verify your session — the authentication service did not respond. Please try again.",
      ),
    } as const;
  });
  const userId = data?.claims?.sub;
  if (error || !data?.claims || !userId) {
    throw new Error(
      error?.message.includes("did not respond")
        ? error.message
        : "Unauthorized: Your session has expired.",
    );
  }

  return next({ context: { supabase, userId, claims: data.claims } });
});
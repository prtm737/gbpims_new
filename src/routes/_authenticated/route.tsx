import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // getSession() reads the locally persisted session (no network round-trip),
    // keeping navigation snappy; server functions still enforce auth per call.
    let sessionFound = false;
    try {
      const { data } = await authClient.auth.getSession();
      sessionFound = !!data.session;
      if (data.session) return { user: data.session.user };
    } catch (error) {
      console.error("[auth-guard] session lookup failed", error);
    }
    if (!sessionFound) throw redirect({ to: "/auth" });
  },
  component: () => <Outlet />,
});

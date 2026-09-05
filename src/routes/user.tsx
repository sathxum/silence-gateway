import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/user")({
  beforeLoad: async ({ location }) => {
    // Avoid double-navigating if we're already checking auth
    console.log("User route: beforeLoad at", location.pathname);
    
    const sessionResult = await supabase.auth.getSession();
    const session = sessionResult?.data?.session ?? null;
    
    // If we have a session, we check if the user is suspended
    if (session) {
      console.log("User route: Session found, checking profile for", session.user.id);
      const { data: profile, error: profileError } = await (supabase as any)
        .from("profiles")
        .select("suspended")
        .eq("id", session.user.id)
        .maybeSingle();

      if (profileError) {
        console.error("User route: Profile lookup failed", profileError);
        return { session };
      }

      if (profile?.suspended) {
        console.log("User route: Account suspended, signing out");
        await supabase.auth.signOut();
        // Redirect to /user with error, but avoid infinite loop if already at /user
        if (location.pathname !== "/user") {
          throw redirect({ to: "/user", search: { error: "Account suspended" } });
        }
        return { session: null };
      }

      // If at login page and have session, go to dashboard
      if (location.pathname === "/user") {
        console.log("User route: Already logged in, redirecting to dashboard");
        throw redirect({ to: "/user/dashboard" });
      }
      
      return { session };
    }
    
    // No session: if we're not at /user, go there
    if (location.pathname !== "/user") {
      console.log("User route: No session, redirecting to login");
      throw redirect({ to: "/user" });
    }

    return { session: null };
  },
  component: UserLayout,
});

function UserLayout() {
  return <Outlet />;
}

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import { verifySessionFingerprint } from "@/lib/security.functions";
import { computeFingerprint } from "@/lib/client-attest";

export function UserGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);


  useEffect(() => {
    let alive = true;
    const checkAuth = async () => {
      try {
        console.log("UserGuard: Checking session...");
        const sessionResult = await supabase.auth.getSession();
        const session = sessionResult?.data?.session ?? null;
        
        if (!session) {
          console.log("UserGuard: No session, redirecting to /user");
          if (alive) await router.navigate({ to: "/user", replace: true });
          return;
        }

        console.log("UserGuard: Fetching profile for", session.user.id);
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("id,suspended")
          .eq("id", session.user.id)
          .maybeSingle();

        if (profileError) {
          throw new Error(`Unable to verify your user account: ${profileError.message}`);
        }
          
        if (!profile) {
          console.warn("UserGuard: No user profile found for authenticated ID");
          await supabase.auth.signOut();
          if (alive) await router.navigate({ to: "/user", replace: true });
          return;
        }

        if (profile.suspended) {
          console.warn("UserGuard: Account is suspended");
          await supabase.auth.signOut();
            if (alive) await router.navigate({ to: "/user", search: { error: "Account suspended" }, replace: true });
          return;
        }

        // Fingerprint verification is secondary; don't block app if it fails transiently
        try {
          const fp = await computeFingerprint();
          console.log("UserGuard: Verifying fingerprint...");
          const res = await verifySessionFingerprint({ data: { fingerprint: fp } });
          if (res.bound && !res.ok) {
            console.error("UserGuard: Session fingerprint mismatch (possible hijack)");
            await supabase.auth.signOut();
            if (alive) await router.navigate({ to: "/user", search: { error: "Session conflict" }, replace: true });
            return;
          }
        } catch (fpErr) { 
          console.warn("UserGuard: Fingerprint check skipped", fpErr);
        }
        
        console.log("UserGuard: Auth verified successfully");
        if (alive) setReady(true);
      } catch (err: any) {
        console.error("UserGuard: Critical auth error", err);
        if (alive) setError(err.message || "Session verification failed");
      }
    };

    checkAuth();
    return () => { alive = false; };
  }, [router]);

  if (error) {
    return (
      <div className="grid min-h-screen place-items-center bg-background p-4 text-center">
        <div className="max-w-md space-y-4">
          <h2 className="text-xl font-bold text-destructive">Security Error</h2>
          <p className="text-sm text-muted-foreground">{error}</p>
          <button 
            onClick={() => window.location.reload()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="text-xs font-medium text-muted-foreground animate-pulse tracking-wider uppercase">Verifying Session</span>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
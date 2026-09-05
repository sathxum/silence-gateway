import { createFileRoute } from "@tanstack/react-router";
import { AdminGuard } from "@/components/silence/AdminGuard";
import { AdminShell } from "@/components/silence/AdminShell";
import { GlassCard } from "@/components/silence/GlassCard";
import { GitBranch } from "lucide-react";

export const Route = createFileRoute("/admin/fallbacks")({
  head: () => ({
    meta: [
      { title: "Fallbacks — Silence API" },
      { name: "description", content: "Intelligent fallback chains and failover configuration." },
      { property: "og:title", content: "Fallbacks — Silence API" },
      { property: "og:description", content: "Intelligent fallback chains and failover configuration." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <AdminGuard>
      <AdminShell>
        <div className="space-y-4">
          <h1 className="metallic-text text-2xl font-semibold sm:text-3xl">Fallbacks</h1>
          <GlassCard className="p-8 text-center">
            <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 ring-1 ring-inset ring-primary/20">
              <GitBranch className="h-6 w-6 text-primary" />
            </div>
            <h3 className="text-base font-semibold">Fallback chains coming soon</h3>
            <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
              We are working on intelligent per-model, per-provider, and global fallback routing. This will allow the gateway to automatically switch between different providers or models when one fails or hits rate limits.
            </p>
          </GlassCard>
        </div>
      </AdminShell>
    </AdminGuard>
  ),
});
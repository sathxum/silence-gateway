import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { UserGuard } from "@/components/silence/UserGuard";
import { UserShell } from "@/components/silence/UserShell";
import { getMyProfile, getMyUsage, listPublicModels, createMyKey, deleteMyKey } from "@/lib/users.functions";
import { useState } from "react";
import { Wallet, Activity, Cpu, KeyRound, Copy, Check, Loader2, Search, TrendingUp, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { GlassCard } from "@/components/silence/GlassCard";
import { ConfirmDeleteModal } from "@/components/silence/ConfirmDeleteModal";

export const Route = createFileRoute("/user/dashboard")({
  head: () => ({
    meta: [
      { title: "User Dashboard — Silence API" },
      { name: "description", content: "View your AI usage, balance, and manage your API keys." },
      { property: "og:title", content: "User Dashboard — Silence API" },
      { property: "og:description", content: "View your AI usage, balance, and manage your API keys." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (<UserGuard><Inner /></UserGuard>),
});

function Inner() {
  const profileFn = useServerFn(getMyProfile);
  const usageFn = useServerFn(getMyUsage);
  const modelsFn = useServerFn(listPublicModels);
  const createKeyFn = useServerFn(createMyKey);
  const deleteKeyFn = useServerFn(deleteMyKey);
  const qc = useQueryClient();



  const p = useQuery({ 
    queryKey: ["me", "profile"], 
    queryFn: async () => {
      console.log("Fetching profile...");
      try {
        const res = await profileFn();
        console.log("Profile res:", res);
        return res;
      } catch (err) {
        console.error("Profile fetch error:", err);
        throw err;
      }
    } 
  });
  const u = useQuery({ 
    queryKey: ["me", "usage"], 
    queryFn: async () => {
      console.log("Fetching usage...");
      try {
        const res = await usageFn();
        console.log("Usage res:", res);
        return res;
      } catch (err) {
        console.error("Usage fetch error:", err);
        throw err;
      }
    }
  });
  const m = useQuery({ 
    queryKey: ["me", "models"], 
    queryFn: async () => {
      console.log("Fetching models...");
      try {
        const res = await modelsFn();
        console.log("Models res:", res);
        return res;
      } catch (err) {
        console.error("Models fetch error:", err);
        throw err;
      }
    }
  });

  const [copied, setCopied] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "keys" | "usage" | "models">("overview");
  const [modelSearch, setModelSearch] = useState("");
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [newKeyLabel, setNewKeyLabel] = useState("");
  const [isCreatingKey, setIsCreatingKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);

  const totals = p.data?.totals ?? { balance: 0, cost: 0, requests: 0, tokens: 0 };
  const userProfile = p.data?.profile as any;
  const usageRows = Array.isArray(u.data) ? u.data : [];
  const apiKeys = Array.isArray(p.data?.keys) ? p.data.keys : [];
  const publicModels = Array.isArray(m.data) ? m.data : [];
  const email = userProfile?.email ?? "";
  const isFrozen = userProfile?.is_frozen ?? false;
  const maxTokens = userProfile?.max_tokens_limit ?? 1000000;

  console.log("Dashboard render state:", { 
    isLoading: p.isLoading || u.isLoading || m.isLoading,
    isError: p.isError || u.isError || m.isError,
    hasProfile: !!p.data,
    email,
    maxTokens
  });

  if (p.isLoading) {
    return (
      <UserShell email={email}>
        <div className="flex h-[400px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </UserShell>
    );
  }

  if (p.isError) {
    return (
      <UserShell email={email}>
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-6 text-center">
          <h2 className="text-lg font-bold text-destructive">Failed to load dashboard</h2>
          <p className="mt-2 text-sm text-muted-foreground">{(p.error as any)?.message || "An unexpected error occurred."}</p>
          <button 
            onClick={() => p.refetch()}
            className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white"
          >
            Retry
          </button>
        </div>
      </UserShell>
    );
  }

  return (
    <UserShell email={email}>


      <div className="relative">
        <div aria-hidden className="glow-orb h-[420px] w-[420px] -top-32 -left-24" style={{ background: "radial-gradient(circle, oklch(0.62 0.19 258 / 55%), transparent 70%)" }} />
        
        <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <span className="brand-chip inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-medium">
              {isFrozen ? "ACCOUNT FROZEN" : "Welcome back"}
            </span>
            <h1 className="mt-2 text-2xl font-bold tracking-tight metallic-text">{email.split("@")[0]}</h1>
            <p className="text-sm text-muted-foreground">
              {isFrozen ? "Your account balance is frozen. Contact admin." : "Your gateway usage at a glance."}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:min-w-[500px]">
            <KPI label="Balance" value={`$${totals.balance.toFixed(2)}`} icon={Wallet} accent />
            <KPI label="Spent" value={`$${totals.cost.toFixed(4)}`} icon={TrendingUp} />
            <KPI label="Requests" value={String(totals.requests)} icon={Activity} />
            <KPI label="Tokens" value={(totals.tokens / 1000).toFixed(1) + "k"} icon={Cpu} />
          </div>
        </div>

        {isFrozen && (
          <div className="mb-6 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <TrendingUp className="h-5 w-5 shrink-0" />
            <div>
              <div className="font-bold">Account Balance Frozen</div>
              <div>You cannot make new API requests while your balance is frozen. Please contact your administrator.</div>
            </div>
          </div>
        )}

        <div className="mb-4 inline-flex flex-wrap rounded-xl border border-[color:var(--hairline)] bg-card/70 backdrop-blur-md p-1 text-sm shadow-sm">
          {(["overview", "keys", "usage", "models"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`rounded-lg px-4 py-1.5 text-xs font-medium capitalize transition ${tab === t ? "bg-[color:var(--brand-soft)] text-[color:var(--brand-strong)] shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              {t}
            </button>
          ))}
        </div>

        <div className="space-y-6">
          {tab === "overview" && (
            <div className="grid gap-6 md:grid-cols-2">
              <Card title="Usage Limits" icon={Cpu}>
                <div className="space-y-4">
                  <div>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="text-muted-foreground">Token Consumption</span>
                      <span className="font-medium">{((totals.tokens / maxTokens) * 100).toFixed(1)}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div 
                        className="h-full bg-[color:var(--brand)] transition-all duration-500" 
                        style={{ width: `${Math.min(100, (totals.tokens / maxTokens) * 100)}%` }}
                      />
                    </div>
                    <div className="mt-1.5 text-[10px] text-muted-foreground">
                      {totals.tokens.toLocaleString()} / {maxTokens.toLocaleString()} tokens used
                    </div>
                  </div>
                  <div className="rounded-lg bg-[color:var(--brand-soft)]/40 p-3 text-[11px] text-muted-foreground leading-relaxed">
                    Once you reach your token limit, you will no longer be able to create new API keys or make requests.
                  </div>
                </div>
              </Card>
              
              <Card title="Recent activity" icon={Activity}>
                 {usageRows.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">No requests yet.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                     {usageRows.slice(0, 5).map((e: any) => (
                      <li key={e.id} className="flex items-center justify-between rounded-xl border border-[color:var(--hairline)] bg-background/40 px-3 py-2.5">
                        <div className="min-w-0">
                          <div className="truncate font-medium">{e.model_name}</div>
                          <div className="text-[10px] text-muted-foreground">{new Date(e.ts).toLocaleString()}</div>
                        </div>
                        <div className="text-right text-xs">
                          <div className="font-semibold">{e.total_tokens} tok</div>
                          <div className="text-[10px] text-muted-foreground">${Number(e.cost).toFixed(4)}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          )}

          {tab === "keys" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold tracking-tight text-foreground">API Keys</h2>
                <button 
                   disabled={totals.tokens >= maxTokens || isFrozen || apiKeys.length >= (userProfile?.max_api_keys ?? 5)}
                  className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  onClick={() => setIsCreatingKey(true)}
                   title={apiKeys.length >= (userProfile?.max_api_keys ?? 5) ? `Maximum limit of ${userProfile?.max_api_keys ?? 5} keys reached` : ""}
                >
                  <Plus className="h-4 w-4" /> New Key
                </button>
              </div>

                {apiKeys.length >= (userProfile?.max_api_keys ?? 5) && (
                <div className="mt-2 text-[10px] text-amber-600 font-medium">
                   Maximum API key limit reached ({userProfile?.max_api_keys ?? 5} keys).
                </div>
              )}

              {isCreatingKey && (
                <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 backdrop-blur-sm" onClick={() => setIsCreatingKey(false)}>
                  <GlassCard className="w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
                    <h3 className="text-lg font-bold mb-4">Create New API Key</h3>
                    <form onSubmit={async (e) => {
                      e.preventDefault();
                      if (!newKeyLabel.trim()) return toast.error("Label required");
                      setBusy(true);
                      try {
                        const res = await createKeyFn({ data: { label: newKeyLabel } });
                        setRevealedKey(res.key);
                        setNewKeyLabel("");
                        setIsCreatingKey(false);
                        qc.invalidateQueries({ queryKey: ["me", "profile"] });
                      } catch (e: any) {
                        toast.error(e.message);
                      } finally {
                        setBusy(false);
                      }
                    }} className="space-y-4">
                      <div>
                        <label className="text-xs font-semibold text-muted-foreground uppercase mb-1 block">Label</label>
                        <input 
                          type="text" 
                          placeholder="My Workspace Key"
                          className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-[color:var(--brand)] transition-colors"
                          value={newKeyLabel}
                          onChange={(e) => setNewKeyLabel(e.target.value)}
                        />
                      </div>
                      <div className="flex gap-3 pt-2">
                        <button 
                          className="flex-1 rounded-xl border border-border py-2.5 text-sm font-semibold hover:bg-muted transition-colors"
                          onClick={() => setIsCreatingKey(false)}
                        >
                          Cancel
                        </button>
                        <button 
                          type="submit"
                          className="flex-1 rounded-xl btn-primary text-white py-2.5 text-sm font-semibold shadow-lg shadow-primary/20 relative z-30"
                          disabled={busy}
                        >
                          {busy ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : "Create Key"}
                        </button>
                      </div>
                    </form>
                  </GlassCard>
                </div>
              )}

              {revealedKey && (
                <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4 backdrop-blur-md">
                  <GlassCard className="w-full max-w-md p-6 border-[color:var(--brand)]/20 bg-card shadow-2xl">
                    <h3 className="text-lg font-bold text-blue-900 mb-2">New Key Created!</h3>
                    <p className="text-xs text-blue-700 mb-4">Copy this key now. It will not be shown again for security reasons.</p>
                    <div className="flex items-center justify-between rounded-xl bg-muted/30 border border-border px-4 py-3 font-mono text-sm shadow-inner mb-6">
                      <span className="truncate text-foreground">{revealedKey}</span>
                      <button 
                        onClick={async () => {
                          await navigator.clipboard.writeText(revealedKey);
                          toast.success("Key copied to clipboard");
                        }}
                        className="ml-3 text-blue-500 hover:text-blue-700"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                    </div>
                    <button 
                      className="w-full rounded-xl btn-primary text-white py-3 text-sm font-bold shadow-lg shadow-primary/20"
                      onClick={() => setRevealedKey(null)}
                    >
                      Done, I've saved it
                    </button>
                  </GlassCard>
                </div>
              )}

               {apiKeys.length === 0 ? (
                <GlassCard className="py-12 text-center">
                  <KeyRound className="mx-auto mb-3 h-8 w-8 text-muted-foreground opacity-20" />
                  <p className="text-sm text-muted-foreground">No active keys. Request one from your admin.</p>
                </GlassCard>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                   {apiKeys.map((k: any) => (
                    <GlassCard key={k.id} className="p-4 transition-transform hover:-translate-y-0.5">
                      <div className="flex items-start justify-between mb-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-bold">{k.owner_label}</div>
                          <div className="text-[10px] text-muted-foreground">Created {new Date(k.created_at).toLocaleDateString()}</div>
                        </div>
                        <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${k.enabled ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                          {k.enabled ? "ACTIVE" : "DISABLED"}
                        </span>
                      </div>
                      
                      <div className="mb-4 flex items-center justify-between rounded-lg bg-muted/20 px-3 py-2 font-mono text-xs">
                        <span className="text-muted-foreground">{k.key_prefix}••••••••</span>
                        <button onClick={async () => { try { await navigator.clipboard.writeText(k.key_prefix); setCopied(k.id); toast.success("Prefix copied"); setTimeout(() => setCopied(null), 1200); } catch {} }}
                          className="text-muted-foreground hover:text-foreground">
                          {copied === k.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div className="rounded-lg bg-[color:var(--brand-soft)]/50 p-2">
                          <div className="text-[9px] uppercase text-muted-foreground">Balance</div>
                          <div className="font-bold text-[color:var(--brand-strong)]">${Number(k.balance).toFixed(2)}</div>
                        </div>
                        <div className="rounded-lg bg-[color:var(--brand-soft)]/50 p-2">
                          <div className="text-[9px] uppercase text-muted-foreground">Spent</div>
                          <div className="font-bold">${Number(k.total_cost).toFixed(4)}</div>
                        </div>
                      </div>

                      <div className="mt-3 flex justify-end">
                         <button 
                           onClick={() => setConfirmDel(k.id)}
                           className="text-muted-foreground hover:text-red-500 transition-colors p-1 relative z-30"
                         >
                           <Trash2 className="h-3.5 w-3.5" />
                         </button>
                      </div>
                    </GlassCard>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "usage" && (
            <GlassCard className="p-0 overflow-hidden">
              <div className="p-4 border-b border-[color:var(--hairline)]">
                <h2 className="text-sm font-bold">Usage History</h2>
                <p className="text-[11px] text-muted-foreground">Last 50 requests</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px] text-sm">
                  <thead className="bg-muted/30 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr><th className="px-4 py-3">Timestamp</th><th className="py-3">Model</th><th className="py-3">Tokens</th><th className="py-3">Cost</th><th className="py-3">Latency</th><th className="px-4 py-3 text-center">Status</th></tr>
                  </thead>
                  <tbody className="divide-y divide-[color:var(--hairline)]/50">
                     {usageRows.map((e: any) => (
                      <tr key={e.id} className="hover:bg-muted/10 transition-colors">
                        <td className="px-4 py-3 text-[11px] text-muted-foreground whitespace-nowrap">{new Date(e.ts).toLocaleString()}</td>
                        <td className="py-3 text-[11px] font-medium">{e.model_name}</td>
                        <td className="py-3 text-[11px]">{e.total_tokens}</td>
                        <td className="py-3 text-[11px] font-medium text-emerald-600">${Number(e.cost).toFixed(4)}</td>
                        <td className="py-3 text-[11px] text-muted-foreground">{e.latency_ms}ms</td>
                        <td className="px-4 py-3 text-center">{e.success ? <span className="text-emerald-500 font-bold">✓</span> : <span className="text-red-500 font-bold">✗</span>}</td>
                      </tr>
                    ))}
                     {usageRows.length === 0 && !u.isLoading && (
                      <tr><td colSpan={6} className="py-12 text-center text-xs text-muted-foreground">No usage data found.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </GlassCard>
          )}

          {tab === "models" && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-xl border border-[color:var(--hairline)] bg-white/70 backdrop-blur-md px-4 py-2.5">
                <Search className="h-4 w-4 text-muted-foreground" />
                <input value={modelSearch} onChange={(e) => setModelSearch(e.target.value)} placeholder="Search available models..."
                  className="w-full bg-transparent text-sm outline-none" />
              </div>
              
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                 {publicModels.filter((x: any) => !modelSearch || x.display_name.toLowerCase().includes(modelSearch.toLowerCase())).map((mm: any) => (
                  <GlassCard key={mm.id} className="p-4 group">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold metallic-text">{mm.display_name}</div>
                        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          <span className="rounded-md bg-[color:var(--brand-soft)] px-1.5 py-0.5 font-medium text-[color:var(--brand-strong)]">
                            \${Number(mm.user_cost_per_1m ?? 0).toFixed(2)} / 1M
                          </span>
                        </div>
                      </div>
                      <button onClick={async () => { try { await navigator.clipboard.writeText(mm.display_name); toast.success("Model name copied"); } catch {} }}
                        className="rounded-lg border border-[color:var(--hairline)] p-2 transition hover:bg-[color:var(--brand-soft)] group-hover:border-[color:var(--brand)]/30">
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </GlassCard>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {confirmDel && (
        <ConfirmDeleteModal
          title="Permanently delete key?"
          description="This will permanently delete this API key. You will not be able to recover it."
          onConfirm={async () => {
            setBusy(true);
            try {
              await deleteKeyFn({ data: { id: confirmDel! } });
              toast.success("Key deleted");
              setConfirmDel(null);
              qc.invalidateQueries({ queryKey: ["me", "profile"] });
            } catch (e: any) {
              toast.error(e.message);
            } finally {
              setBusy(false);
            }
          }}
          onCancel={() => setConfirmDel(null)}
          isLoading={busy}
        />
      )}
    </UserShell>
  );
}

function KPI({ label, value, icon: Icon, accent }: { label: string; value: string; icon: any; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-3.5 transition-transform hover:scale-[1.02] ${accent ? "border-[color:var(--brand)]/20 bg-gradient-to-br from-[color:var(--brand-soft)] to-card" : "border-[color:var(--hairline)] bg-card shadow-sm"}`}>
      <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="mt-1 text-lg font-bold tracking-tight metallic-text">{value}</div>
    </div>
  );
}

function Card({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) {
  return (
    <GlassCard className="p-5">
      <div className="mb-4 flex items-center gap-2 text-sm font-bold tracking-tight">
        <div className="grid h-7 w-7 place-items-center rounded-lg bg-[color:var(--brand-soft)] text-[color:var(--brand-strong)]">
          <Icon className="h-3.5 w-3.5" />
        </div>
        {title}
      </div>
      {children}
    </GlassCard>
  );
}
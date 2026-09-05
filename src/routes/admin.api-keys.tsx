import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminGuard } from "@/components/silence/AdminGuard";
import { AdminShell } from "@/components/silence/AdminShell";
import { GlassCard } from "@/components/silence/GlassCard";
import { listApiKeys, createApiKey, updateApiKey, adjustBalance, deleteApiKey } from "@/lib/api-keys.functions";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Copy, Check, KeyRound, Power, Wallet, AlertCircle } from "lucide-react";
import { ConfirmDeleteModal } from "@/components/silence/ConfirmDeleteModal";

export const Route = createFileRoute("/admin/api-keys")({
  head: () => ({
    meta: [
      { title: "Gateway API Keys — Silence API" },
      { name: "description", content: "Manage administrative and customer API keys for the Silence gateway." },
      { property: "og:title", content: "Gateway API Keys — Silence API" },
      { property: "og:description", content: "Manage administrative and customer API keys for the Silence gateway." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (<AdminGuard><AdminShell><Inner /></AdminShell></AdminGuard>),
});

function Inner() {
  const list = useServerFn(listApiKeys);
  const create = useServerFn(createApiKey);
  const update = useServerFn(updateApiKey);
  const adjust = useServerFn(adjustBalance);
  const del = useServerFn(deleteApiKey);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["api-keys"], queryFn: () => list() });
  const keyRows = Array.isArray(q.data) ? q.data : [];

  const [label, setLabel] = useState("");
  const [balance, setBalance] = useState(0);
  const [revealed, setRevealed] = useState<{ id: string; raw: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const createM = useMutation({
    mutationFn: () => create({ data: { owner_label: label, balance: Number(balance) } }),
    onSuccess: (r: any) => {
      toast.success("API key created");
      setRevealed({ id: r.id, raw: r.raw_key });
      setLabel(""); setBalance(0);
      qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const toggleM = useMutation({
    mutationFn: (v: { id: string; enabled: boolean }) => update({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api-keys"] }),
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });
  const adjustM = useMutation({
    mutationFn: (v: { id: string; delta: number }) => adjust({ data: v }),
    onSuccess: () => { toast.success("Balance updated"); qc.invalidateQueries({ queryKey: ["api-keys"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });
  const delM = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => { toast.success("Deleted"); qc.invalidateQueries({ queryKey: ["api-keys"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="metallic-text text-2xl font-semibold sm:text-3xl">API Keys</h1>
        <p className="mt-1 text-sm text-muted-foreground">Issue keys for your customers. Only shown once at creation — store it safely.</p>
      </div>

      <GlassCard className="p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium"><Plus className="h-4 w-4" /> Create key</div>
        <form onSubmit={(e) => { e.preventDefault(); if (!label.trim()) return toast.error("Label required"); createM.mutate(); }}
          className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_180px_auto]">
          <input required placeholder="Owner label (e.g. user@x.com)" value={label} onChange={(e) => setLabel(e.target.value)}
            className="rounded-lg border border-border bg-input/40 px-3 py-2 outline-none focus:ring-2 focus:ring-ring" />
          <input type="number" min={0} step="0.01" placeholder="Starting balance" value={balance}
            onChange={(e) => setBalance(Number(e.target.value))}
            className="rounded-lg border border-border bg-input/40 px-3 py-2 outline-none focus:ring-2 focus:ring-ring" />
          <button type="submit" disabled={createM.isPending}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
            {createM.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Create
          </button>
        </form>
      </GlassCard>

      {revealed && (
        <GlassCard className="p-5 ring-2 ring-primary/40">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-primary"><KeyRound className="h-4 w-4" /> Save this key now — you won't see it again</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded-md bg-input/60 px-3 py-2 font-mono text-xs">{revealed.raw}</code>
            <button onClick={() => { navigator.clipboard.writeText(revealed.raw); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground">
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy"}
            </button>
            <button onClick={() => setRevealed(null)} className="rounded-md glass ring-metallic px-3 py-2 text-xs">Dismiss</button>
          </div>
        </GlassCard>
      )}

      <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
        {q.isLoading && (
          <GlassCard className="col-span-full py-16 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground opacity-20" />
          </GlassCard>
        )}
         {keyRows.map((k) => (
          <div key={k.id} className={`card-3d group relative ${!k.enabled ? "opacity-75 grayscale-[0.5]" : ""}`}>
            <div className="pointer-events-none absolute inset-x-0 top-0 h-[60%] rounded-[26px] bg-gradient-to-b from-white/20 to-transparent z-20" />
            <div className="card-3d-content relative z-10 flex flex-col p-[30px_26px_26px]">
              <div className="flex items-start justify-between gap-3.5">
                <div className="min-w-0">
                  <h3 className="font-['Space_Grotesk'] text-[20px] font-bold leading-[1.3] tracking-tight text-foreground group-hover:text-primary">
                    {k.owner_label}
                  </h3>
                  <div className="mt-2.5 flex items-center gap-2">
                    <span className="font-mono text-[12px] text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-md border border-border/50">
                      {k.key_prefix}••••••••
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => toggleM.mutate({ id: k.id, enabled: !k.enabled })}
                  className={`relative h-7 w-12 flex-shrink-0 rounded-full border border-white/50 transition-all duration-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_6px_14px_-4px_rgba(47,111,237,0.6)] ${
                    k.enabled ? "bg-gradient-to-b from-[#4a8bff] to-[#2f6fed]" : "bg-gradient-to-b from-[#dbe0ea] to-[#c7cedb]"
                  }`}
                >
                  <div className={`absolute top-[3px] h-5 w-5 rounded-full bg-gradient-to-b from-white to-[#e8edf7] shadow-[0_2px_4px_rgba(0,0,0,0.3)] transition-all duration-200 ${
                    k.enabled ? "left-[23px]" : "left-[3px]"
                  }`} />
                </button>
              </div>

              <div className="mt-6 grid grid-cols-2 gap-3">
                <div className="flex flex-col items-center justify-center rounded-[14px] border border-white/85 bg-gradient-to-br from-white/85 to-white/45 p-[14px_6px] text-center shadow-[0_6px_14px_-8px_rgba(40,60,110,0.2),inset_0_1px_0_rgba(255,255,255,0.8)]">
                  <div className="text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground/60 mb-1">Balance</div>
                  <div className="flex items-center gap-1.5">
                    <div className="text-[16px] font-bold text-[#1650c9]">${Number(k.balance).toFixed(2)}</div>
                    <button onClick={() => { const v = prompt("Adjust balance (+/-)", "10"); if (v != null && !isNaN(Number(v))) adjustM.mutate({ id: k.id, delta: Number(v) }); }}
                      className="rounded-full bg-primary/10 p-1 text-primary hover:bg-primary/20 transition-colors">
                      <Plus className="size-3" />
                    </button>
                  </div>
                </div>
                <div className="flex flex-col items-center justify-center rounded-[14px] border border-white/85 bg-gradient-to-br from-white/85 to-white/45 p-[14px_6px] text-center shadow-[0_6px_14px_-8px_rgba(40,60,110,0.2),inset_0_1px_0_rgba(255,255,255,0.8)]">
                  <div className="text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground/60 mb-1">Requests</div>
                  <div className="text-[16px] font-bold text-foreground">{k.total_requests}</div>
                </div>
              </div>

              <div className="my-[20px] h-px w-full bg-gradient-to-r from-transparent via-border/40 to-transparent" />

              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setDeletingId(k.id)}
                  className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-white/90 bg-gradient-to-br from-white to-[#eef2f9] text-destructive transition-all hover:scale-105 hover:bg-destructive/10 shadow-[0_2px_5px_-1px_rgba(40,60,110,0.18),inset_0_1px_0_rgba(255,255,255,0.8)]"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
        {q.data && q.data.length === 0 && (
          <GlassCard className="col-span-full py-20 text-center">
            <KeyRound className="mx-auto mb-4 h-10 w-10 text-muted-foreground opacity-20" />
            <h3 className="text-base font-medium">No API keys yet</h3>
            <p className="text-sm text-muted-foreground">Issue your first key to start using the gateway.</p>
          </GlassCard>
        )}
      </div>

      {deletingId && (
        <ConfirmDeleteModal
          title="Delete API Key"
          description="Are you sure you want to delete this API key? Any applications using this key will immediately lose access to the gateway."
          onConfirm={() => {
            delM.mutate(deletingId);
            setDeletingId(null);
          }}
          onCancel={() => setDeletingId(null)}
          isLoading={delM.isPending}
        />
      )}
    </div>
  );
}
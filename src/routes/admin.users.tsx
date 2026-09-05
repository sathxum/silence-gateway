import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminGuard } from "@/components/silence/AdminGuard";
import { AdminShell } from "@/components/silence/AdminShell";
import { GlassCard } from "@/components/silence/GlassCard";
import { listUsers, createUser, updateUser, adjustUserBalance, deleteUser, type UserRow } from "@/lib/users.functions";
import { useMemo, useState, useEffect } from "react";

import { toast } from "sonner";
import { Loader2, Plus, Trash2, Pencil, X, Search, Wallet, PauseCircle, PlayCircle, User as UserIcon, ShieldAlert, AlertCircle, CheckCircle2 } from "lucide-react";
import { ConfirmDeleteModal } from "@/components/silence/ConfirmDeleteModal";

export const Route = createFileRoute("/admin/users")({
  head: () => ({
    meta: [
      { title: "User Management — Silence API" },
      { name: "description", content: "Manage user accounts, balances, and access control." },
      { property: "og:title", content: "User Management — Silence API" },
      { property: "og:description", content: "Manage user accounts, balances, and access control." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (<AdminGuard><AdminShell><Inner /></AdminShell></AdminGuard>),
});

function Inner() {
  const list = useServerFn(listUsers);
  const create = useServerFn(createUser);
  const update = useServerFn(updateUser);
  const adjust = useServerFn(adjustUserBalance);
  const del = useServerFn(deleteUser);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["users"], queryFn: () => list() });

  const [open, setOpen] = useState<null | { mode: "create" | "edit"; row?: UserRow }>(null);
  const [form, setForm] = useState({ email: "", password: "", initial_balance: 10, max_tokens_limit: 1000000, max_api_keys: 3 });
  const [confirmDel, setConfirmDel] = useState<UserRow | null>(null);
  const [balanceFor, setBalanceFor] = useState<UserRow | null>(null);
  const [balanceDelta, setBalanceDelta] = useState<number>(0);
  const [query, setQuery] = useState("");
  const [showSuccess, setShowSuccess] = useState(false);

  const createM = useMutation({
    mutationFn: () => {
      console.log("Creating user with form data:", form);
      return create({ data: { 
        email: form.email.trim(), 
        password: form.password, 
        initial_balance: Number(form.initial_balance), 
        max_tokens_limit: Number(form.max_tokens_limit), 
        max_api_keys: Number(form.max_api_keys) 
      } });
    },
    onSuccess: (res) => { 
      console.log("User created successfully:", res);
      setShowSuccess(true);
      setOpen(null); 
      setForm({ email: "", password: "", initial_balance: 10, max_tokens_limit: 1000000, max_api_keys: 3 }); 
      qc.invalidateQueries({ queryKey: ["users"] }); 
    },
    onError: (e: any) => {
      console.error("Create User Error Detail:", e);
      const msg = e?.message || "Failed to create user";
      toast.error(msg);
    },
  });
  const updateM = useMutation({
    mutationFn: (v: any) => update({ data: v }),
    onSuccess: () => { toast.success("Saved"); setOpen(null); qc.invalidateQueries({ queryKey: ["users"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });
  const suspendM = useMutation({
    mutationFn: (v: { id: string; suspended?: boolean; is_frozen?: boolean; max_tokens_limit?: number }) => update({ data: v }),
    onSuccess: (_, v) => { 
      if (v.suspended !== undefined) toast.success(v.suspended ? "Account suspended" : "Account reactivated");
      else if (v.is_frozen !== undefined) toast.success(v.is_frozen ? "Balance frozen" : "Balance unfrozen");
      else toast.success("User updated");
      qc.invalidateQueries({ queryKey: ["users"] }); 
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });
  const adjustM = useMutation({
    mutationFn: (v: { id: string; delta: number }) => adjust({ data: v }),
    onSuccess: () => { toast.success("Balance updated"); setBalanceFor(null); setBalanceDelta(0); qc.invalidateQueries({ queryKey: ["users"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });
  const delM = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => { toast.success("User permanently deleted"); setConfirmDel(null); qc.invalidateQueries({ queryKey: ["users"] }); },
    onError: (e: any) => { toast.error(e?.message ?? "Failed"); setConfirmDel(null); },
  });

  const rows = Array.isArray(q.data) ? q.data : [];
  const filtered = useMemo(() => {
    if (!query.trim()) return rows;
    const s = query.toLowerCase();
    return rows.filter((r) => r.email.toLowerCase().includes(s));
  }, [rows, query]);

  const totals = useMemo(() => rows.reduce((a, r) => ({
    users: a.users + 1,
    suspended: a.suspended + (r.suspended ? 1 : 0),
    balance: a.balance + Number(r.total_balance),
    cost: a.cost + Number(r.total_cost),
    tokens: a.tokens + Number(r.total_tokens || 0),
  }), { users: 0, suspended: 0, balance: 0, cost: 0, tokens: 0 }), [rows]);

  function openCreate() { setForm({ email: "", password: "", initial_balance: 10, max_tokens_limit: 1000000, max_api_keys: 3 }); setOpen({ mode: "create" }); }
  function openEdit(r: UserRow) { setForm({ email: r.email, password: "", initial_balance: 0, max_tokens_limit: r.max_tokens_limit, max_api_keys: r.max_api_keys }); setOpen({ mode: "edit", row: r }); }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="metallic-text text-2xl font-semibold sm:text-3xl">Users</h1>
          <p className="mt-1 text-sm text-muted-foreground">Create end-user accounts, allocate balance, suspend or permanently delete.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={openCreate} className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white">
            <Plus className="h-4 w-4" /> New user
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <KPI label="Users" value={String(totals.users)} icon={UserIcon} />
        <KPI label="Suspended" value={String(totals.suspended)} icon={PauseCircle} />
        <KPI label="Total balance" value={`$${totals.balance.toFixed(2)}`} icon={Wallet} />
        <KPI label="Total spend" value={`$${totals.cost.toFixed(4)}`} icon={ShieldAlert} />
        <KPI label="Total tokens" value={`${(totals.tokens / 1_000_000).toFixed(2)}M`} icon={AlertCircle} />
      </div>

      <GlassCard className="p-4">
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-[color:var(--hairline)] bg-white px-3 py-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by email"
            className="w-full bg-transparent text-sm outline-none" />
        </div>

        {q.isLoading ? (
          <div className="grid place-items-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : filtered.length === 0 ? (
          <div className="grid place-items-center gap-2 py-16 text-center">
            <UserIcon className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No users yet. Create the first one.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((r) => (
              <div key={r.id} className={`card-3d relative overflow-hidden p-6 transition-all hover:-translate-y-1 ${r.suspended ? "ring-2 ring-red-500/50" : r.is_frozen ? "ring-2 ring-amber-500/50" : ""}`}>
                <div className="pointer-events-none absolute inset-x-0 top-0 h-[60%] rounded-[26px] bg-gradient-to-b from-white/20 to-transparent z-20" />
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="grid h-8 w-8 place-items-center rounded-lg bg-[color:var(--brand-soft)] text-[color:var(--brand-strong)] text-xs font-semibold">
                        {r.email.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{r.email}</div>
                        <div className="text-[11px] text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</div>
                      </div>
                    </div>
                  </div>
                  {r.suspended ? (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">SUSPENDED</span>
                  ) : r.is_frozen ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">FROZEN</span>
                  ) : (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">ACTIVE</span>
                  )}
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <Stat label="Balance" value={`$${Number(r.total_balance).toFixed(2)}`} />
                  <Stat label="Spent" value={`$${Number(r.total_cost).toFixed(4)}`} />
                  <Stat label="Requests" value={String(r.total_requests)} />
                  <Stat label="Tokens" value={`${((r.total_tokens || 0) / 1000).toFixed(1)}k / ${(r.max_tokens_limit / 1000).toFixed(0)}k`} />
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">{r.key_count} / {r.max_api_keys} API keys</div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  <button onClick={() => setBalanceFor(r)} title="Adjust balance"
                    className="inline-flex items-center gap-1 rounded-md border border-[color:var(--hairline)] bg-white px-2 py-1 text-xs hover:bg-[color:var(--brand-soft)]">
                    <Wallet className="h-3.5 w-3.5" /> Balance
                  </button>
                  <button onClick={() => openEdit(r)} title="Edit"
                    className="inline-flex items-center gap-1 rounded-md border border-[color:var(--hairline)] bg-white px-2 py-1 text-xs hover:bg-[color:var(--brand-soft)]">
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </button>
                  <button onClick={() => suspendM.mutate({ id: r.id, suspended: !r.suspended })}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${r.suspended ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"}`}>
                    {r.suspended ? <><PlayCircle className="h-3.5 w-3.5" /> Reactivate</> : <><PauseCircle className="h-3.5 w-3.5" /> Suspend</>}
                  </button>
                  <button onClick={() => suspendM.mutate({ id: r.id, is_frozen: !r.is_frozen })}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${r.is_frozen ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"}`}>
                    {r.is_frozen ? <><PlayCircle className="h-3.5 w-3.5" /> Unfreeze</> : <><PauseCircle className="h-3.5 w-3.5" /> Freeze</>}
                  </button>
                  <button onClick={() => setConfirmDel(r)} title="Delete"
                    className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100">
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassCard>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-sm" onClick={() => setOpen(null)}>
          <div className="modal my-8" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header relative z-20">
              <h1>{open.mode === "create" ? "Add New Systems User" : "Edit User Profile"}</h1>
              <button onClick={() => setOpen(null)} className="close-btn"><X className="h-4 w-4" /></button>
            </div>
            <div className="header-divider" />
            
            <div className="modal-body pb-6">
              <form onSubmit={async (e) => {
                e.preventDefault();
                console.log("Form submitted, mode:", open.mode);
                if (open.mode === "create") {
                  if (!form.email || form.password.length < 8) {
                    toast.error("Email + 8-char password required");
                    return;
                  }
                  console.log("Attempting to create user...");
                  createM.mutate();
                } else {
                  console.log("Attempting to update user...");
                  updateM.mutate({ 
                    id: open.row!.id, 
                    email: form.email || undefined, 
                    password: form.password || undefined,
                    max_tokens_limit: Number(form.max_tokens_limit),
                    max_api_keys: Number(form.max_api_keys)
                  });
                }
              }} className="space-y-4 pb-4">
                <div className="field">
                  <div className="field-label">Email</div>
                  <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="input" />
                </div>
                
                <div className="field">
                  <div className="field-label">
                    {open.mode === "edit" ? "New password" : "Password"}
                    <span className="hint">{open.mode === "edit" ? "(leave blank to keep)" : "(min 8)"}</span>
                  </div>
                  <input type="password" minLength={open.mode === "create" ? 8 : 0} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
                    className="input" />
                </div>

                {open.mode === "create" && (
                  <div className="panel blue">
                    <div className="panel-title">ACCOUNT CONFIGURATION</div>
                    <div className="field">
                      <div className="field-label">Initial balance <span className="hint">(USD)</span></div>
                      <input type="number" min={0} step="0.01" value={form.initial_balance} onChange={(e) => setForm({ ...form, initial_balance: Number(e.target.value) })}
                        className="input" />
                      <p className="mt-2 text-[11px] text-muted-foreground">User will start with 0 API keys. Admin must allocate balance to keys user creates.</p>
                    </div>
                    <div className="field mt-4">
                      <div className="field-label">Token limit <span className="hint">(max consumption)</span></div>
                      <input type="number" min={0} value={form.max_tokens_limit} onChange={(e) => setForm({ ...form, max_tokens_limit: Number(e.target.value) })}
                        className="input" />
                    </div>
                    <div className="field mt-4">
                      <div className="field-label">API Key limit <span className="hint">(max keys)</span></div>
                      <input type="number" min={1} value={form.max_api_keys} onChange={(e) => setForm({ ...form, max_api_keys: Number(e.target.value) })}
                        className="input" />
                    </div>
                  </div>
                )}
                
                {open.mode === "edit" && (
                  <div className="space-y-4">
                    <div className="field">
                      <div className="field-label">Token limit <span className="hint">(max consumption)</span></div>
                      <input type="number" min={0} value={form.max_tokens_limit} onChange={(e) => setForm({ ...form, max_tokens_limit: Number(e.target.value) })}
                        className="input" />
                    </div>
                    <div className="field">
                      <div className="field-label">API Key limit <span className="hint">(max keys)</span></div>
                      <input type="number" min={1} value={form.max_api_keys} onChange={(e) => setForm({ ...form, max_api_keys: Number(e.target.value) })}
                        className="input" />
                    </div>
                  </div>
                )}
                
                <div className="flex justify-end gap-3 pt-4">
                  <button type="button" onClick={() => setOpen(null)} 
                    className="rounded-xl border border-border bg-card px-6 py-2.5 text-sm font-semibold transition-all hover:bg-muted active:scale-[0.98] relative z-30">
                    Cancel
                  </button>
                  <button type="submit" 
                    disabled={createM.isPending || updateM.isPending}
                    className="btn-primary inline-flex items-center justify-center gap-2 rounded-xl px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-primary/20 transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-60 relative z-30">
                    {(createM.isPending || updateM.isPending) ? <Loader2 className="h-4 w-4 animate-spin" /> : (open.mode === "create" ? "Create user" : "Save changes")}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {balanceFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={() => { setBalanceFor(null); setBalanceDelta(0); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h1>Adjust balance</h1>
              <button onClick={() => { setBalanceFor(null); setBalanceDelta(0); }} className="close-btn"><X className="h-4 w-4" /></button>
            </div>
            <div className="header-divider" />
            <div className="modal-body space-y-4">
              <div className="panel blue">
                <div className="panel-title">CURRENT STATUS</div>
                <div className="text-sm font-semibold">{balanceFor.email}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Current balance: <span className="font-bold text-primary">${Number(balanceFor.total_balance).toFixed(2)}</span>
                </div>
              </div>
              
              <div className="field">
                <div className="field-label">Amount to add <span className="hint">(use negative to deduct)</span></div>
                <input type="number" step="0.01" value={balanceDelta} onChange={(e) => setBalanceDelta(Number(e.target.value))}
                  className="input" autoFocus />
              </div>
              
              <div className="flex justify-end gap-3 pt-4">
                <button onClick={() => { setBalanceFor(null); setBalanceDelta(0); }} 
                  className="rounded-xl border border-border bg-card px-6 py-2.5 text-sm font-semibold transition-all hover:bg-muted active:scale-[0.98]">
                  Cancel
                </button>
                <button onClick={() => adjustM.mutate({ id: balanceFor.id, delta: balanceDelta })} disabled={adjustM.isPending || balanceDelta === 0}
                  className="btn-primary inline-flex items-center justify-center gap-2 rounded-xl px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-primary/20 transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-60 relative z-30">
                  {adjustM.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply adjustment"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmDel && (
        <ConfirmDeleteModal
          title="Permanently delete user?"
          description={`This will PERMANENTLY delete ${confirmDel.email}, all their API keys, and their auth account. This cannot be undone.`}
          onConfirm={() => delM.mutate(confirmDel.id)}
          onCancel={() => setConfirmDel(null)}
          isLoading={delM.isPending}
        />
      )}
      {showSuccess && <SuccessCard onClose={() => setShowSuccess(false)} />}
    </div>
  );
}

function SuccessCard({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 4000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/20 backdrop-blur-[2px] animate-in fade-in duration-300">
      <div 
        className="glass-panel relative w-[320px] overflow-hidden rounded-[28px] p-8 text-center animate-in zoom-in-95 slide-in-from-bottom-10 duration-500 ease-out"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-emerald-500/10 to-transparent" />
        
        <div className="relative z-10 flex flex-col items-center">
          <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-50 text-emerald-500 shadow-inner ring-4 ring-emerald-500/10">
            <CheckCircle2 className="h-10 w-10 animate-in zoom-in-50 duration-500 delay-150 fill-emerald-500/10" />
          </div>
          
          <h3 className="metallic-text text-xl font-bold tracking-tight">Success!</h3>
          <p className="mt-2 text-sm font-medium text-muted-foreground">
            User account has been<br />created successfully.
          </p>
          
          <button 
            onClick={onClose}
            className="mt-8 w-full rounded-xl bg-emerald-500 py-2.5 text-sm font-bold text-white shadow-lg shadow-emerald-500/25 transition-all hover:bg-emerald-600 active:scale-95"
          >
            Great
          </button>
        </div>
        
        {/* Subtle animated light bar at bottom */}
        <div className="absolute bottom-0 left-0 h-1 bg-emerald-500/30 w-full overflow-hidden">
          <div className="h-full bg-emerald-500 animate-[progress_4s_linear]" style={{ width: '100%' }} />
        </div>
      </div>
      
      <style>{`
        @keyframes progress {
          from { width: 100%; }
          to { width: 0%; }
        }
      `}</style>
    </div>
  );
}

function KPI({ label, value, icon: Icon }: { label: string; value: string; icon: any }) {
  return (
    <GlassCard className="p-4">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5 text-primary" /> {label}
      </div>
      <div className="mt-1.5 text-xl font-bold tracking-tight metallic-text">{value}</div>
    </GlassCard>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[14px] border border-white/85 bg-gradient-to-br from-white/85 to-white/45 p-[10px_6px] text-center shadow-[0_6px_14px_-8px_rgba(40,60,110,0.2),inset_0_1px_0_rgba(255,255,255,0.8)]">
      <div className="text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground/60">{label}</div>
      <div className="text-[13px] font-bold text-foreground">{value}</div>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-[color:var(--hairline)] bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-lg border border-[color:var(--hairline)] p-1.5"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
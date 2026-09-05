import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { assertAdmin } from "./users.server";
import { CreateUserInput, UpdateUserInput } from "./users.schemas";

export type UserRow = {
  id: string;
  email: string;
  suspended: boolean;
  suspended_reason: string | null;
  suspended_at: string | null;
  is_frozen: boolean;
  max_tokens_limit: number;
  created_at: string;
  total_balance: number;
  total_cost: number;
  total_requests: number;
  total_tokens: number;
  key_count: number;
  max_api_keys: number;
  tokens_24h?: number;
};

export const listUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<UserRow[]> => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profiles, error } = await supabaseAdmin.from("profiles")
      .select("*" as any)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const { data: keysRes } = await supabaseAdmin.from("api_keys" as any)
      .select("user_id,balance,total_cost,total_requests,total_tokens" as any);
    const keys = keysRes as any[];
    const agg = new Map<string, { total_balance: number; total_cost: number; total_requests: number; total_tokens: number; key_count: number }>();
    for (const k of keys ?? []) {
      if (!k.user_id) continue;
      const a = agg.get(k.user_id) ?? { total_balance: 0, total_cost: 0, total_requests: 0, total_tokens: 0, key_count: 0 };
      a.total_balance += Number(k.balance);
      a.total_cost += Number(k.total_cost);
      a.total_requests += Number(k.total_requests);
      a.total_tokens += Number(k.total_tokens || 0);
      a.key_count += 1;
      agg.set(k.user_id, a);
    }
    return (profiles ?? []).map((p: any) => ({
      ...p,
      total_balance: agg.get(p.id)?.total_balance ?? 0,
      total_cost: agg.get(p.id)?.total_cost ?? 0,
      total_requests: agg.get(p.id)?.total_requests ?? 0,
      total_tokens: agg.get(p.id)?.total_tokens ?? 0,
      key_count: agg.get(p.id)?.key_count ?? 0,
      max_api_keys: p.max_api_keys ?? 5,
    })) as UserRow[];
  });

export const createUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CreateUserInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Refuse if email already belongs to any admin (avoid role confusion)
    const { data: existingAdmin, error: checkErr } = await supabaseAdmin.from("admins").select("id").eq("email", data.email).maybeSingle();
    if (checkErr) {
      console.error("[CREATE_USER] Admin check error:", checkErr);
      throw new Error(`Database error while checking existing admins: ${checkErr.message}`);
    }
    if (existingAdmin) throw new Error("Email is already used by an administrator. Please use a different email.");

    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
    });
    if (error) {
      console.error("[CREATE_USER] Auth User Creation Error:", error);
      throw new Error(error.message);
    }
    if (!created?.user) throw new Error("Auth user creation returned no result.");
    const uid = created.user.id;
    const { error: pErr } = await supabaseAdmin.from("profiles").insert({
      id: uid, email: data.email, created_by: context.userId,
      max_tokens_limit: data.max_tokens_limit,
      max_api_keys: data.max_api_keys,
    } as any);
    if (pErr) {
      console.error("Profile insertion error:", pErr);
      await supabaseAdmin.auth.admin.deleteUser(uid).catch(() => {});
      throw new Error(`Profile creation failed: ${pErr.message}`);
    }
    const { error: rErr } = await supabaseAdmin.from("user_roles").insert({ user_id: uid, role: "user" });
    if (rErr) {
      console.error("Role assignment error:", rErr);
      // Cleanup profile and user if role assignment fails
      await supabaseAdmin.from("profiles").delete().eq("id", uid);
      await supabaseAdmin.auth.admin.deleteUser(uid);
      throw new Error(`Role assignment failed: ${rErr.message}`);
    }
    // Admin no longer auto-creates a starter API key. User creates their own.
    // However, if initial_balance > 0, we should probably keep it to allocate to the first key they create.
    // The current schema ties balance to api_keys, not profile.
    // We'll skip key creation here as requested.
    return { id: uid };
  });

export const updateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => UpdateUserInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Only allow editing existing profile rows (prevents admins editing arbitrary auth users)
    const { data: target } = await supabaseAdmin.from("profiles").select("id").eq("id", data.id).maybeSingle();
    if (!target) throw new Error("user not found");
    const authPatch: Record<string, string> = {};
    if (data.email) authPatch.email = data.email;
    if (data.password) authPatch.password = data.password;
    if (Object.keys(authPatch).length) {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(data.id, authPatch);
      if (error) throw new Error(error.message);
    }
    const profilePatch: Record<string, any> = {};
    if (data.email) profilePatch.email = data.email;
    if (data.suspended !== undefined) {
      profilePatch.suspended = data.suspended;
      profilePatch.suspended_at = data.suspended ? new Date().toISOString() : null;
      profilePatch.suspended_reason = data.suspended ? (data.suspended_reason ?? "suspended by admin") : null;
    }
    if (data.is_frozen !== undefined) profilePatch.is_frozen = data.is_frozen;
    if (data.max_tokens_limit !== undefined) profilePatch.max_tokens_limit = data.max_tokens_limit;
    if (data.max_api_keys !== undefined) profilePatch.max_api_keys = data.max_api_keys;
    if (Object.keys(profilePatch).length) {
      const { error } = await supabaseAdmin.from("profiles").update(profilePatch as any).eq("id", data.id);
      if (error) throw new Error(error.message);
    }
    // If suspending, revoke all sessions immediately
    if (data.suspended === true) {
      await supabaseAdmin.auth.admin.signOut(data.id).catch(() => {});
    }
    return { ok: true };
  });

export const adjustUserBalance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    id: z.string().uuid(), delta: z.number().min(-1_000_000).max(1_000_000),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: target } = await supabaseAdmin.from("profiles").select("id").eq("id", data.id).maybeSingle();
    if (!target) throw new Error("user not found");
    // Distribute delta: if user has keys, apply to the first (oldest) key; else create one
    const { data: keys } = await supabaseAdmin.from("api_keys")
      .select("id,balance").eq("user_id", data.id).order("created_at", { ascending: true }).limit(1);
    if (keys && keys.length) {
      const next = Math.max(0, Number(keys[0].balance) + data.delta);
      const { error } = await supabaseAdmin.from("api_keys").update({ balance: next } as any).eq("id", keys[0].id);
      if (error) throw new Error(error.message);
    } else if (data.delta > 0) {
      const { newApiKey } = await import("./crypto.server");
      const { data: prof } = await supabaseAdmin.from("profiles").select("email").eq("id", data.id).single();
      const k = newApiKey();
      await supabaseAdmin.from("api_keys").insert({
        owner_label: prof?.email ?? "user", balance: data.delta,
        key_hash: k.hash, key_prefix: k.prefix, user_id: data.id,
      } as any);
    }
    return { ok: true };
  });

export const deleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: target } = await supabaseAdmin.from("profiles").select("id").eq("id", data.id).maybeSingle();
    if (!target) throw new Error("user not found");
    // Get user totals before deleting for global stats persistence
    const { data: userKeys } = await supabaseAdmin.from("api_keys").select("total_cost, total_tokens" as any).eq("user_id", data.id);
    const userTotals = (userKeys ?? []).reduce((a: any, k: any) => ({
      cost: a.cost + Number(k.total_cost || 0),
      tokens: a.tokens + Number(k.total_tokens || 0)
    }), { cost: 0, tokens: 0 });

    // Update global stats with final user data before deletion
    await supabaseAdmin.rpc("gw_update_global_stats" as any, { 
      _cost: userTotals.cost, 
      _tokens: BigInt(userTotals.tokens) 
    });

    // Cascade: delete api_keys, profile, role, auth user
    await supabaseAdmin.from("api_keys").delete().eq("user_id", data.id);
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.id);
    await supabaseAdmin.from("profiles").delete().eq("id", data.id);
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- User-facing (self) endpoints ----------

export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: profile, error } = await (context.supabase as any)
      .from("profiles" as any).select("*" as any)
      .eq("id", context.userId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!profile) throw new Error("no profile");
    const { data: keys } = await (context.supabase as any)
      .from("api_keys" as any)
      .select("id,owner_label,key_prefix,enabled,balance,total_cost,total_requests,total_tokens,last_used_at,created_at" as any)
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    const totals = (keys as any[] ?? []).reduce((acc: any, k: any) => ({
      balance: acc.balance + Number(k.balance),
      cost: acc.cost + Number(k.total_cost),
      requests: acc.requests + Number(k.total_requests),
      tokens: acc.tokens + Number(k.total_tokens || 0),
    }), { balance: 0, cost: 0, requests: 0, tokens: 0 });
    return { profile, keys: keys ?? [], totals };
  });

export const deleteMyKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    // A user can delete their own keys
    const { error } = await context.supabase
      .from("api_keys")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const createMyKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ label: z.string().min(1).max(100) }).parse(d))
  .handler(async ({ data, context }) => {
    // Check if user has reached their token limit
    const { data: profile } = await (context.supabase as any).from("profiles").select("*" as any).eq("id", context.userId).single();
    if (!profile) throw new Error("Profile not found");

    const { data: userStats } = await context.supabase.rpc("gw_get_user_token_total" as any, { _user_id: context.userId });
    if (profile.max_tokens_limit && (userStats as any || 0) >= profile.max_tokens_limit) {
      throw new Error("Global token limit reached. Cannot create new keys.");
    }

    // Check key count limit
    const { count } = await context.supabase.from("api_keys").select("*", { count: "exact", head: true }).eq("user_id", context.userId);
    if (profile.max_api_keys && (count ?? 0) >= profile.max_api_keys) {
      throw new Error(`Maximum API key limit reached (${profile.max_api_keys}).`);
    }
    
    const { newApiKey } = await import("./crypto.server");
    const k = newApiKey();
    const { data: created, error } = await context.supabase.from("api_keys").insert({
      owner_label: data.label,
      balance: 0, // Users create keys with 0 balance, admin must allocate
      key_hash: k.hash,
      key_prefix: k.prefix,
      user_id: context.userId,
    } as any).select("id").single();
    if (error) throw new Error(error.message);
    
    // Return the full key ONLY ONCE during creation
    return { id: (created as any).id, key: (k as any).key || (k as any).raw };
  });

export const getMyUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("usage_events")
      // NOTE: the column is `ts`, not `created_at`. Also `provider_name` is
      // deliberately NOT selected — end users must never learn which upstream
      // vendor served their request.
      .select("id,ts,model_name,input_tokens,output_tokens,total_tokens,cost,latency_ms,success")
      .order("ts", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listPublicModels = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Users only need public metadata — display name and pricing
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Verify caller is a real profile user (not just any signed-in id)
    const { data: profile } = await context.supabase.from("profiles").select("suspended").eq("id", context.userId).maybeSingle();
    if (!profile) throw new Error("Forbidden");
    if (profile.suspended) throw new Error("Account suspended");
    const { data, error } = await supabaseAdmin.from("models")
      // `upstream_model` and `provider_id` are internal routing details — a user
      // knowing them could go straight to the upstream vendor. Never expose.
      .select("id,display_name,enabled,user_cost_per_1m,output_cost_per_1m,request_cost")
      .eq("enabled", true)
      .order("display_name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });
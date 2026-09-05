type RoleClient = {
  rpc: (name: "has_role", args: { _user_id: string; _role: "admin" }) => PromiseLike<{
    data: boolean | null;
    error: { message: string } | null;
  }>;
};

export async function assertAdmin(supabase: RoleClient, userId: string) {
  const { data, error } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });

  if (error) {
    console.error("Role check error:", error);
    throw new Error(`Role check failed: ${error.message}`);
  }
  if (!data) {
    throw new Error("Access Denied: You do not have administrator privileges.");
  }
}
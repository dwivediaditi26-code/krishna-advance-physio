// swift-handler — owner-only "set a login's password" Edge Function.
//
// This is a fresh implementation written from the client-side contract in index.html
// (search for "swift-handler" there): the app POSTs {targetEmail, newPassword} with the
// caller's Supabase access token in the Authorization header, and expects back either
// {ok:true} or {error:"..."}. If you still have the ORIGINAL function's source (from the
// first clinic's Supabase project), prefer deploying that instead — this is a rebuild, not
// a copy, so behaviour may differ in small ways.
//
// Deploy with the Supabase CLI from this project's root:
//   supabase functions deploy swift-handler --project-ref <new-project-ref>
// No extra secrets to set — SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected
// automatically for every Edge Function in a Supabase project.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    // 1. Identify the caller from their own access token and confirm they're the owner.
    //    (Mirrors the app's own rule: role lives in user_metadata.role, set when the
    //    login was created — never chosen by the person signing in.)
    const authHeader = req.headers.get("Authorization") || "";
    const callerToken = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!callerToken) return json({ error: "Missing auth token" }, 401);

    const { data: callerData, error: callerErr } = await admin.auth.getUser(callerToken);
    if (callerErr || !callerData?.user) return json({ error: "Invalid or expired session" }, 401);

    const callerRole = callerData.user.user_metadata?.role;
    if (callerRole !== "owner") return json({ error: "Only the owner can change logins" }, 403);

    // 2. Validate the request body.
    const body = await req.json().catch(() => ({}));
    const targetEmail = String(body.targetEmail || "").trim().toLowerCase();
    const newPassword = String(body.newPassword || "");
    if (!targetEmail || newPassword.length < 6) {
      return json({ error: "targetEmail and a newPassword (min 6 characters) are required" }, 400);
    }

    // 3. Find the target login by email. The admin API updates by user id, not email,
    //    so page through listUsers() looking for a match (fine for a handful of staff logins).
    let targetUserId: string | null = null;
    for (let page = 1; page <= 20 && !targetUserId; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw error;
      const match = data.users.find((u) => (u.email || "").toLowerCase() === targetEmail);
      if (match) targetUserId = match.id;
      if (data.users.length < 200) break; // last page
    }
    if (!targetUserId) return json({ error: "No login found with that email" }, 404);

    // 4. Update the password using the service-role key.
    const { error: updateErr } = await admin.auth.admin.updateUserById(targetUserId, {
      password: newPassword,
    });
    if (updateErr) throw updateErr;

    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});

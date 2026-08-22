import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

function bearerToken(request: Request) {
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}

const allowedActions = new Set(['ping']);

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: 'Server is missing Supabase environment variables' }, 500);
  }

  const token = bearerToken(request);
  if (!token) return jsonResponse({ error: 'Authentication required' }, 401);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) return jsonResponse({ error: 'Invalid authentication token' }, 401);

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON payload' }, 400);
  }

  // Supabase Data Access Gate: route sensitive_workflow, admin_or_cross_user,
  // third_party_or_secret, and sensitive tables such as users, accounts,
  // roles, scripts, audits, orders, payments, and inventory here instead of
  // direct browser-client .from('<table>') access.
  // Never proxy arbitrary table names, select lists, filters, or SQL from the
  // browser. Keep an action allowlist, validate payload shape, check role /
  // ownership per action, return whitelisted fields / field-whitelisted
  // responses, and add
  // idempotency keys before production for sensitive side effects.
  if (typeof payload.action !== 'string' || !allowedActions.has(payload.action)) {
    return jsonResponse({ error: 'Unsupported action' }, 400);
  }

  // Keep service-role access inside the function. Add resource ownership,
  // relationship, and role/admin checks before reads or writes that touch
  // money, inventory, roles, scripts, audits, users, or other users.
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { count, error } = await adminClient
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('id', userData.user.id);

  if (error) return jsonResponse({ error: 'Failed to verify profile ownership' }, 500);

  return jsonResponse({ ok: true, userId: userData.user.id, profileExists: Boolean(count) });
});

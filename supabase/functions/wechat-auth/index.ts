import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const BUCKET = 'product-images';

function reply(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

function text(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function decodeFile(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp)|application\/pdf);base64,(.+)$/i);
  if (!match) throw new Error('仅支持 JPG、PNG、WEBP 或 PDF');
  const mime = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  if (bytes.byteLength > 8 * 1024 * 1024) throw new Error('单个文件不能超过 8MB');
  return { mime, bytes };
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const appId = Deno.env.get('WECHAT_APP_ID');
  const appSecret = Deno.env.get('WECHAT_APP_SECRET');
  if (!supabaseUrl || !anonKey || !serviceKey || !appId || !appSecret) {
    return reply({ error: '微信登录服务尚未完整配置' }, 500);
  }

  let payload: Record<string, unknown>;
  try { payload = await request.json(); } catch { return reply({ error: '请求格式错误' }, 400); }
  const action = text(payload.action, 'login');
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  if (action === 'login') {
    const code = text(payload.code);
    if (!code || code.length > 128) return reply({ error: '微信登录凭证无效' }, 400);
    const endpoint = new URL('https://api.weixin.qq.com/sns/jscode2session');
    endpoint.searchParams.set('appid', appId);
    endpoint.searchParams.set('secret', appSecret);
    endpoint.searchParams.set('js_code', code);
    endpoint.searchParams.set('grant_type', 'authorization_code');
    const wxResponse = await fetch(endpoint);
    const wxData = await wxResponse.json() as Record<string, unknown>;
    const openid = text(wxData.openid);
    if (!wxResponse.ok || !openid) {
      console.error('[wechat-login]', wxData.errcode, wxData.errmsg);
      return reply({ error: '微信身份校验失败，请重新进入小程序' }, 401);
    }

    let { data: identity } = await admin.from('wechat_mini_identities').select('user_id').eq('openid', openid).maybeSingle();
    let userId = identity?.user_id as string | undefined;
    const identityHash = await sha256(`${appId}:${openid}`);
    const email = `wx_${identityHash.slice(0, 32)}@mini.xinwei.local`;

    if (!userId) {
      const created = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { display_name: '微信快速上传用户', login_source: 'wechat_mini_program' }
      });
      if (created.error || !created.data.user) return reply({ error: '创建微信用户失败' }, 500);
      userId = created.data.user.id;
      await admin.from('profiles').upsert({
        id: userId,
        display_name: '微信快速上传用户',
        role: 'uploader',
        must_change_password: false,
        is_disabled: false
      });
      const inserted = await admin.from('wechat_mini_identities').insert({
        user_id: userId,
        openid,
        unionid: text(wxData.unionid) || null
      });
      if (inserted.error) {
        await admin.auth.admin.deleteUser(userId);
        return reply({ error: '绑定微信身份失败' }, 500);
      }
    } else {
      await admin.from('wechat_mini_identities').update({
        unionid: text(wxData.unionid) || null,
        last_login_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }).eq('user_id', userId);
    }

    const profileResult = await admin.from('profiles').select('role, display_name, is_disabled').eq('id', userId).single();
    if (profileResult.error || profileResult.data?.is_disabled) return reply({ error: '账号已停用，请联系管理员' }, 403);

    const generated = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    const tokenHash = generated.data?.properties?.hashed_token;
    if (generated.error || !tokenHash) return reply({ error: '生成登录会话失败' }, 500);
    const verified = await fetch(`${supabaseUrl}/auth/v1/verify`, {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'magiclink', token_hash: tokenHash })
    });
    const session = await verified.json() as Record<string, unknown>;
    if (!verified.ok || !session.access_token) return reply({ error: '建立登录会话失败' }, 500);
    return reply({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
      user: { id: userId, role: profileResult.data.role, display_name: profileResult.data.display_name }
    });
  }

  const bearer = request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1] || '';
  if (!bearer) return reply({ error: '请重新登录' }, 401);
  const auth = await admin.auth.getUser(bearer);
  if (auth.error || !auth.data.user) return reply({ error: '登录已失效，请重新进入小程序' }, 401);
  const uid = auth.data.user.id;
  const profileResult = await admin.from('profiles').select('role, display_name, is_disabled').eq('id', uid).single();
  const profile = profileResult.data;
  if (!profile || profile.is_disabled) return reply({ error: '账号不可用' }, 403);

  if (action === 'profile') return reply({ user: { id: uid, role: profile.role, display_name: profile.display_name } });

  if (action === 'upload') {
    const kind = text(payload.document_kind);
    const date = text(payload.document_date);
    const dataUrl = text(payload.data_url);
    const filename = text(payload.filename, 'wechat-photo.jpg').slice(0, 180);
    if (!['delivery_note', 'outbound_note'].includes(kind)) return reply({ error: '请选择送货单或出库单' }, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return reply({ error: '单据日期错误' }, 400);
    let decoded;
    try { decoded = decodeFile(dataUrl); } catch (error) {
      return reply({ error: error instanceof Error ? error.message : '文件解析失败' }, 400);
    }
    const ext = decoded.mime === 'application/pdf' ? 'pdf' : decoded.mime === 'image/jpeg' ? 'jpg' : decoded.mime.split('/')[1];
    const path = `shared-documents/${uid}/${date}/${crypto.randomUUID()}.${ext}`;
    const uploaded = await admin.storage.from(BUCKET).upload(path, decoded.bytes, {
      contentType: decoded.mime,
      cacheControl: '3600',
      upsert: false
    });
    if (uploaded.error) return reply({ error: '照片上传失败，请重试' }, 500);
    const record = await admin.from('shared_document_archive').insert({
      document_kind: kind,
      document_date: date,
      partner_name: text(payload.partner_name).slice(0, 200),
      notes: text(payload.notes, '微信小程序快速上传').slice(0, 1000),
      original_file_name: filename,
      storage_path: path,
      mime_type: decoded.mime,
      file_size: decoded.bytes.byteLength,
      uploaded_by: uid,
      uploaded_by_name: profile.display_name || '微信快速上传用户'
    }).select('id, document_kind, document_date, status, uploaded_at').single();
    if (record.error) {
      await admin.storage.from(BUCKET).remove([path]);
      return reply({ error: '照片归档失败，请重试' }, 500);
    }
    return reply({ document: record.data });
  }

  if (action === 'recent') {
    const records = await admin.from('shared_document_archive')
      .select('id, document_kind, document_date, original_file_name, status, uploaded_at')
      .eq('uploaded_by', uid)
      .order('uploaded_at', { ascending: false })
      .limit(20);
    if (records.error) return reply({ error: '加载记录失败' }, 500);
    return reply({ documents: records.data || [] });
  }

  return reply({ error: '不支持的操作' }, 400);
});


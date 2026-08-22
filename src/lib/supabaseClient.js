import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        // 某些 Chromium 环境会遗留跨标签 Web Lock，导致 getSession 永久等待。
        // 本系统由单个前端客户端维护会话，直接执行认证临界区可避免该死锁。
        lock: async (_name, _acquireTimeout, fn) => fn()
      }
    })
  : null;

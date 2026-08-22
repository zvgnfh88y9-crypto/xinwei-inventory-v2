-- 1. 扩展用户信息
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS must_change_password boolean DEFAULT true;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS failed_login_attempts int DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_disabled boolean DEFAULT false;

-- 2. 创建系统审计日志表
CREATE TABLE IF NOT EXISTS public.system_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id),
  actor_name text,
  action_type text NOT NULL, -- login, logout, void, post, delete, edit_price, create_user
  resource_type text,
  resource_id text,
  detail text,
  ip_address text,
  user_agent text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.system_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Only admins can view audit logs" ON public.system_audit_log
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- 3. 增强导入批次详情
ALTER TABLE public.import_batches ADD COLUMN IF NOT EXISTS raw_data jsonb; -- 存储原始数据以便重新比对
;

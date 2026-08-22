const ERROR_RULES = [
  [/(invalid login credentials|email or password.*(?:invalid|incorrect))/i, '账号或密码不正确，请重新输入。'],
  [/(otp_expired|email link is invalid|link.*(?:expired|invalid)|recovery.*(?:expired|invalid))/i, '链接已失效或已使用，请重新申请。'],
  [/(invalid authentication token|auth session missing|invalid.*jwt|jwt.*expired|refresh.*token.*(?:invalid|expired)|session.*(?:expired|missing|invalid)|no current user|login session failed)/i, '登录状态已失效，请退出后重新登录。'],
  [/(user.*(?:disabled|banned)|account.*(?:disabled|suspended))/i, '账号已被停用，请联系管理员。'],
  [/(role.*mismatch|role.*not.*configured|账号角色尚未配置|角色与所选角色不匹配)/i, '您的账号角色权限配置有误，请联系管理员。'],
  [/(email not confirmed|email.*unconfirmed)/i, '邮箱尚未验证，请先完成邮箱验证。'],
  [/(user not found|no user found)/i, '未找到该账号，请检查输入内容。'],
  [/(invalid email|email.*invalid)/i, '邮箱格式不正确，请重新输入。'],
  [/(email rate limit exceeded|rate limit|too many requests|over_email_send_rate_limit)/i, '操作过于频繁，请稍后再试（如重置邮件请等待数分钟后重试）。'],
  [/(security purposes.*only request this after|请求间隔过短)/i, '为了安全起见，请等待片刻后再重新发送请求。'],
  [/(timeout|timed out|request timeout|请求超时)/i, '服务响应超时，请稍后重试。'],
  [/(failed to send a request to the edge function|failed to fetch|network request failed|networkerror|fetch failed|load failed|network.*(?:failed|error)|connection.*failed)/i, '网络连接失败，请检查网络后重试。'],
  [/(cors|cross-origin)/i, '浏览器安全策略阻止了请求，请联系管理员检查服务配置。'],
  [/(permission denied|row-level security|rls|not authorized|forbidden|unauthorized)/i, '没有权限执行此操作，请联系管理员。'],
  [/(duplicate key|already exists|unique constraint)/i, '记录已存在，请勿重复提交。'],
  [/(payload too large|file too large|exceeded.*size|request entity too large)/i, '文件过大，请压缩后重新上传。'],
  [/(invalid.*file|unsupported.*file|mime.*type)/i, '文件格式不支持，请选择允许的图片或文件。'],
  [/(storage.*quota|quota.*exceeded|insufficient storage)/i, '云端存储空间不足，请联系管理员。'],
  [/(bucket.*not found|object.*not found|file.*not found)/i, '文件不存在或已被删除，请重新上传。'],
  [/(relation|column).*(does not exist|not found)|schema cache/i, '系统配置尚未完成，请联系管理员。'],
  [/(function.*not found|edge function.*not found)/i, '系统服务尚未部署完成，请联系管理员。'],
  [/(invalid api key|api key.*invalid|missing api key)/i, '系统连接配置错误，请联系管理员。'],
  [/(not found|\b404\b)/i, '未找到相关数据，请刷新后重试。'],
  [/(conflict|\b409\b)/i, '数据已发生变化，请刷新后重试。'],
  [/(internal server error|database error|postgres|unexpected error|\b5\d\d\b)/i, '系统服务暂时不可用，请稍后重试。'],
];

/**
 * 将 Supabase、浏览器及云端接口的技术错误转换为用户可理解的中文。
 * 原始错误仍由调用处记录到控制台，便于管理员排查。
 */
export function getUserErrorMessage(error, fallback = '操作失败，请稍后重试。') {
  const rawMessage = String(error?.message ?? error ?? '').trim();
  if (!rawMessage) return fallback;

  for (const [pattern, message] of ERROR_RULES) {
    if (pattern.test(rawMessage)) return message;
  }

  // 后端已经返回中文业务提示时，直接保留，避免覆盖有价值的操作说明。
  return /[\u4e00-\u9fff]/.test(rawMessage) ? rawMessage : fallback;
}

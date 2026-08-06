export interface KosSyncRuntimeFailure {
  offline: boolean;
  message: string;
}

/** Convert provider/runtime failures into actionable text without exposing responses or credentials. */
export function explainKosSyncRuntimeFailure(value: unknown): KosSyncRuntimeFailure {
  const error = value as { message?: unknown; $metadata?: { httpStatusCode?: number } };
  const status = error?.$metadata?.httpStatusCode;
  const message = typeof error?.message === 'string' ? error.message : String(error ?? '');

  if (/同步引擎尚未初始化/i.test(message)) {
    return { offline: false, message: '同步连接尚未初始化；请重试连接' };
  }
  if (/checkpoint|sync-state|本地同步状态/i.test(message)) {
    return { offline: false, message: '本地同步状态异常；原状态已保留，请按故障排查处理' };
  }
  if (/LiveSync 本地写入失败：\.DS_Store/i.test(message)) {
    return { offline: false, message: '检测到未排除的 macOS .DS_Store；请更新插件后重试同步' };
  }
  if (/LiveSync 本地写入失败/i.test(message)) {
    return { offline: false, message: '本地文件无法写入同步数据库；请检查同步排除规则和文件名' };
  }
  if (status === 401 || /invalid.*(access|key)|unauthorized|signature/i.test(message)) {
    return { offline: false, message: 'R2 认证失败；请在同步设置中更新凭据并重新测试' };
  }
  if (status === 403 || /forbidden|access denied|permission/i.test(message)) {
    return { offline: false, message: 'R2 权限不足；凭据必须具有目标 Bucket 的读写权限' };
  }
  if (status === 404 || /no such bucket/i.test(message)) {
    return { offline: false, message: 'R2 Bucket 不存在；请检查同步设置' };
  }
  if (/无法连接 Cloudflare R2 Bucket/i.test(message)) {
    return { offline: true, message: '无法访问 R2 Bucket；请检查网络、Bucket 和凭据' };
  }
  if (/timeout|timed out|abort|network|fetch|offline|econn|enotfound|dns|certificate|tls/i.test(message)) {
    return { offline: true, message: '同步网络连接失败；请检查网络、DNS、VPN 和设备时间后重试' };
  }
  if (/quota|storage limit|insufficient storage/i.test(message)) {
    return { offline: false, message: 'R2 存储配额不足；请检查 Bucket 用量' };
  }
  if (/LiveSync Journal (?:首次接收|同步)失败/i.test(message)) {
    return { offline: false, message: '远端同步日志处理失败；请重试，持续失败时按故障排查处理' };
  }
  return { offline: false, message: 'kos-sync 同步失败；请重试，持续失败时打开同步设置或复制诊断信息' };
}

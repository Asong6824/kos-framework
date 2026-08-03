import type { KosSyncSettings } from './model';
import { validateKosSyncSettings } from './policy';

export async function kosSyncConfigurationFingerprint(settings: Readonly<KosSyncSettings>): Promise<string> {
  const input = [
    settings.accountId,
    settings.bucket,
    settings.accessKeyId,
    settings.secretAccessKey,
    settings.vaultId,
  ].join('\u0000');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function validateKosSyncPreflightSettings(settings: Readonly<KosSyncSettings>): void {
  const validation = validateKosSyncSettings({ ...settings, enabled: true });
  if (!validation.valid) throw new Error(validation.message);
}

export function explainKosSyncPreflightFailure(value: unknown): string {
  const error = value as { message?: unknown; name?: unknown; $metadata?: { httpStatusCode?: number } };
  const status = error?.$metadata?.httpStatusCode;
  const message = typeof error?.message === 'string' ? error.message : String(error ?? '');
  if (message === 'R2_PREFLIGHT_READ_MISMATCH') return 'R2 写入成功但读回内容不一致；同步未启用';
  if (status === 401 || /invalid.*(access|key)|unauthorized|signature/i.test(message)) {
    return 'R2 认证失败：请检查 Access Key ID、Secret Access Key 和设备时间';
  }
  if (status === 403 || /forbidden|access denied|permission/i.test(message)) {
    return 'R2 权限不足：Token 必须对该 Bucket 具有 Object Read & Write 权限';
  }
  if (status === 404 || /no such bucket|not found/i.test(message)) {
    return 'R2 Bucket 不存在：请检查 Account ID、Bucket 名称和所属账号';
  }
  if (/timeout|timed out|abort/i.test(message)) return 'R2 连接超时：请检查网络、VPN 和 Cloudflare 服务状态';
  if (/network|fetch|econn|enotfound|dns|certificate|tls/i.test(message)) {
    return '无法连接 R2：请检查网络、DNS、证书、VPN 和 Account ID';
  }
  return 'R2 读写预检失败：请检查 Account ID、Bucket、凭据和 Token 权限';
}

/**
 * R2 object transport adapted from Self-hosted LiveSync 0.25.83
 * `livesync-commonlib/.../objectstore/MinioStorageAdapter.ts`.
 *
 * Journal semantics stay in the pinned LiveSync fork. This adapter narrows
 * the upstream generic S3 settings to kos-sync's fixed Cloudflare R2 policy.
 */
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { S3ClientConfig } from '@aws-sdk/client-s3';
import type { KosSyncSettings } from '../model';
import { kosSyncBucketPrefix, kosSyncEndpoint } from '../policy';

export interface KosJournalStorage {
  upload(key: string, data: Uint8Array, mime: string): Promise<void>;
  download(key: string): Promise<Uint8Array | null>;
  listFiles(from?: string, limit?: number): Promise<string[]>;
  deleteFiles(keys: readonly string[]): Promise<void>;
  isAvailable(): Promise<boolean>;
}

export interface KosR2PreflightResult {
  latencyMs: number;
  remoteHasData: boolean;
}

type S3Sender = Pick<S3Client, 'send' | 'destroy'>;
type S3Factory = (config: S3ClientConfig) => S3Sender;

export class KosR2Storage implements KosJournalStorage {
  private client: S3Sender | null = null;

  constructor(
    private settings: Readonly<KosSyncSettings>,
    private readonly createClient: S3Factory = (config) => new S3Client(config),
    private readonly requestHandler?: S3ClientConfig['requestHandler'],
  ) {}

  applySettings(settings: Readonly<KosSyncSettings>): void {
    this.client?.destroy();
    this.client = null;
    this.settings = settings;
  }

  async upload(key: string, data: Uint8Array, mime: string): Promise<void> {
    await this.getClient().send(new PutObjectCommand({
      Bucket: this.settings.bucket,
      Key: this.objectKey(key),
      Body: data,
      ContentType: mime,
    }));
  }

  async download(key: string): Promise<Uint8Array | null> {
    try {
      const result = await this.getClient().send(new GetObjectCommand({
        Bucket: this.settings.bucket,
        Key: this.objectKey(key),
        ResponseCacheControl: 'no-cache',
      }));
      if (!result.Body) return null;
      return new Uint8Array(await result.Body.transformToByteArray());
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404) return null;
      throw error;
    }
  }

  async listFiles(from = '', limit?: number): Promise<string[]> {
    const prefix = kosSyncBucketPrefix(this.settings.vaultId);
    const result = await this.getClient().send(new ListObjectsV2Command({
      Bucket: this.settings.bucket,
      Prefix: prefix,
      StartAfter: `${prefix}${from || ''}`,
      ...(limit ? { MaxKeys: limit } : {}),
    }));
    return (result.Contents ?? [])
      .flatMap((entry) => entry.Key?.startsWith(prefix) ? [entry.Key.slice(prefix.length)] : []);
  }

  async deleteFiles(keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return;
    for (let offset = 0; offset < keys.length; offset += 1_000) {
      const batch = keys.slice(offset, offset + 1_000);
      const result = await this.getClient().send(new DeleteObjectsCommand({
        Bucket: this.settings.bucket,
        Delete: { Objects: batch.map((key) => ({ Key: this.objectKey(key) })) },
      }));
      if (result.Errors?.length) {
        throw new Error(`R2 删除失败：${result.Errors.length} 个对象未删除`);
      }
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.getClient().send(new HeadBucketCommand({ Bucket: this.settings.bucket }));
      return true;
    } catch {
      return false;
    }
  }

  /** Verify bucket access and scoped object read/write/delete without touching user Journal objects. */
  async preflight(probeId: string): Promise<KosR2PreflightResult> {
    const startedAt = Date.now();
    const key = `_preflight/${probeId.replace(/[^a-zA-Z0-9-]/g, '')}.json`;
    const payload = new TextEncoder().encode(JSON.stringify({ type: 'kos-sync-preflight', probeId }));
    let uploaded = false;
    try {
      await this.getClient().send(new HeadBucketCommand({ Bucket: this.settings.bucket }));
      const remoteHasData = (await this.listFiles('', 1)).length > 0;
      await this.upload(key, payload, 'application/json');
      uploaded = true;
      const downloaded = await this.download(key);
      if (!downloaded || downloaded.length !== payload.length
        || downloaded.some((byte, index) => byte !== payload[index])) {
        throw new Error('R2_PREFLIGHT_READ_MISMATCH');
      }
      await this.deleteFiles([key]);
      uploaded = false;
      return { latencyMs: Date.now() - startedAt, remoteHasData };
    } finally {
      if (uploaded) await this.deleteFiles([key]);
    }
  }

  destroy(): void {
    this.client?.destroy();
    this.client = null;
  }

  private objectKey(key: string): string {
    return `${kosSyncBucketPrefix(this.settings.vaultId)}${key.replace(/^\/+/, '')}`;
  }

  private getClient(): S3Sender {
    if (this.client) return this.client;
    this.client = this.createClient({
      endpoint: kosSyncEndpoint(this.settings.accountId),
      region: 'auto',
      credentials: {
        accessKeyId: this.settings.accessKeyId,
        secretAccessKey: this.settings.secretAccessKey,
      },
      requestHandler: this.requestHandler,
      maxAttempts: 4,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
    return this.client;
  }
}

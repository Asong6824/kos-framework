import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { KosSyncSettings } from '../src/sync/model';
import { kosSyncBucketPrefix } from '../src/sync/policy';
import { KosR2Storage } from '../src/sync/upstream/r2-storage';

function settings(): KosSyncSettings {
  return {
    enabled: true,
    accountId: '0123456789abcdef0123456789abcdef',
    bucket: 'kos-vault',
    accessKeyId: 'access',
    secretAccessKey: 'secret',
    vaultId: randomUUID(),
    paused: false,
  };
}

describe('KosR2Storage', () => {
  it('uses fixed Cloudflare R2 configuration and an isolated prefix', async () => {
    const config: S3ClientConfig[] = [];
    const commands: object[] = [];
    const client = {
      send: vi.fn(async (command: object) => {
        commands.push(command);
        if (command instanceof ListObjectsV2Command) {
          return {
            Contents: [
              { Key: `${kosSyncBucketPrefix(syncSettings.vaultId)}journal/1.json` },
              { Key: 'another-vault/journal/2.json' },
            ],
          };
        }
        return {};
      }),
      destroy: vi.fn(),
    } as unknown as S3Client;
    const syncSettings = settings();
    const storage = new KosR2Storage(syncSettings, (value) => {
      config.push(value);
      return client;
    });

    await storage.upload('journal/1.json', new TextEncoder().encode('{}'), 'application/json');
    const files = await storage.listFiles(undefined, 10);
    await storage.deleteFiles(['journal/1.json']);
    await storage.isAvailable();

    expect(config).toHaveLength(1);
    expect(config[0]).toMatchObject({
      endpoint: `https://${syncSettings.accountId}.r2.cloudflarestorage.com`,
      region: 'auto',
      credentials: {
        accessKeyId: 'access',
        secretAccessKey: 'secret',
      },
      maxAttempts: 4,
    });
    expect(files).toEqual(['journal/1.json']);
    expect(commands[0]).toBeInstanceOf(PutObjectCommand);
    expect(commands[1]).toBeInstanceOf(ListObjectsV2Command);
    expect(commands[2]).toBeInstanceOf(DeleteObjectsCommand);
    expect(commands[3]).toBeInstanceOf(HeadBucketCommand);
    expect((commands[0] as PutObjectCommand).input.Key).toBe(
      `${kosSyncBucketPrefix(syncSettings.vaultId)}journal/1.json`,
    );
    expect((commands[1] as ListObjectsV2Command).input.StartAfter).toBe(
      kosSyncBucketPrefix(syncSettings.vaultId),
    );
  });

  it('returns null for missing objects and bytes for existing objects', async () => {
    let missing = true;
    const client = {
      send: vi.fn(async (command: object) => {
        if (!(command instanceof GetObjectCommand)) return {};
        if (missing) {
          throw { $metadata: { httpStatusCode: 404 } };
        }
        return {
          Body: {
            transformToByteArray: async () => new Uint8Array([1, 2, 3]),
          },
        };
      }),
      destroy: vi.fn(),
    } as unknown as S3Client;
    const storage = new KosR2Storage(settings(), () => client);

    await expect(storage.download('missing')).resolves.toBeNull();
    missing = false;
    await expect(storage.download('present')).resolves.toEqual(new Uint8Array([1, 2, 3]));
  });

  it('splits bulk deletes into R2-compatible batches', async () => {
    const client = {
      send: vi.fn(async () => ({})),
      destroy: vi.fn(),
    } as unknown as S3Client;
    const storage = new KosR2Storage(settings(), () => client);
    await storage.deleteFiles(Array.from({ length: 1_001 }, (_, index) => `chunk/${index}`));
    expect(client.send).toHaveBeenCalledTimes(2);
  });

  it('preflights bucket access and isolated read/write/delete without touching Journal data', async () => {
    const commands: object[] = [];
    let uploaded: Uint8Array<ArrayBufferLike> = new Uint8Array();
    const client = {
      send: vi.fn(async (command: object) => {
        commands.push(command);
        if (command instanceof ListObjectsV2Command) {
          return { Contents: [{ Key: `${kosSyncBucketPrefix(syncSettings.vaultId)}journal/1.json` }] };
        }
        if (command instanceof PutObjectCommand) {
          uploaded = command.input.Body as Uint8Array;
          return {};
        }
        if (command instanceof GetObjectCommand) {
          return { Body: { transformToByteArray: async () => uploaded } };
        }
        return {};
      }),
      destroy: vi.fn(),
    } as unknown as S3Client;
    const syncSettings = settings();
    const storage = new KosR2Storage(syncSettings, () => client);

    await expect(storage.preflight('probe-1')).resolves.toMatchObject({ remoteHasData: true });

    expect(commands.map((command) => command.constructor)).toEqual([
      HeadBucketCommand,
      ListObjectsV2Command,
      PutObjectCommand,
      GetObjectCommand,
      DeleteObjectsCommand,
    ]);
    const probeKey = `${kosSyncBucketPrefix(syncSettings.vaultId)}_preflight/probe-1.json`;
    expect((commands[2] as PutObjectCommand).input.Key).toBe(probeKey);
    expect((commands[3] as GetObjectCommand).input.Key).toBe(probeKey);
    expect((commands[4] as DeleteObjectsCommand).input.Delete?.Objects).toEqual([{ Key: probeKey }]);
  });

  it('cleans up the preflight probe when read-back verification fails', async () => {
    const commands: object[] = [];
    const client = {
      send: vi.fn(async (command: object) => {
        commands.push(command);
        if (command instanceof ListObjectsV2Command) return { Contents: [] };
        if (command instanceof GetObjectCommand) {
          return { Body: { transformToByteArray: async () => new Uint8Array([0]) } };
        }
        return {};
      }),
      destroy: vi.fn(),
    } as unknown as S3Client;
    const storage = new KosR2Storage(settings(), () => client);

    await expect(storage.preflight('probe-2')).rejects.toThrow('R2_PREFLIGHT_READ_MISMATCH');
    expect(commands[commands.length - 1]).toBeInstanceOf(DeleteObjectsCommand);
  });
});

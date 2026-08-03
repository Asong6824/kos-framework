import type { KosSyncSettings } from '../model';
import type { KosJournalStorage } from './r2-storage';

/**
 * Runtime-compatible subset of LiveSync's pinned IJournalStorage.
 *
 * Kept as a local structural type so normal kos typechecking does not pull the
 * entire immutable upstream snapshot into the plugin TypeScript program.
 */
export interface LiveSyncJournalStoragePort {
  upload(key: string, data: Uint8Array, mime: string): Promise<boolean>;
  download(key: string, ignoreCache?: boolean): Promise<Uint8Array | false>;
  listFiles(from?: string, limit?: number): Promise<string[]>;
  deleteFiles(keys: string[]): Promise<boolean>;
  isAvailable(): Promise<boolean>;
  getUsage(): Promise<false>;
  applyNewConfig(settings: Readonly<KosSyncSettings>): void;
}

export class KosLiveSyncJournalStorage implements LiveSyncJournalStoragePort {
  constructor(private readonly storage: KosJournalStorage) {}

  async upload(key: string, data: Uint8Array, mime: string): Promise<boolean> {
    await this.storage.upload(key, data, mime);
    return true;
  }

  async download(key: string): Promise<Uint8Array | false> {
    return await this.storage.download(key) ?? false;
  }

  listFiles(from?: string, limit?: number): Promise<string[]> {
    return this.storage.listFiles(from, limit);
  }

  async deleteFiles(keys: string[]): Promise<boolean> {
    await this.storage.deleteFiles(keys);
    return true;
  }

  isAvailable(): Promise<boolean> {
    return this.storage.isAvailable();
  }

  async getUsage(): Promise<false> {
    // R2's S3 API does not expose bucket usage. kos derives request/storage
    // metrics separately instead of pretending this is available.
    return false;
  }

  applyNewConfig(_settings?: Readonly<KosSyncSettings>): void {
    throw new Error('kos-sync 通过重建 R2 storage 应用配置，不支持原地切换');
  }
}

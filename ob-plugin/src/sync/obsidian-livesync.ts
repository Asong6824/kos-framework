import { App, normalizePath, TFile } from 'obsidian';
import type {
  KosLiveSyncPersistedState,
  KosLiveSyncStateRepository,
  KosSyncVaultFile,
  KosSyncVaultPort,
} from './livesync-engine';
import {
  KosFileSyncStateRepository,
} from './state';
import { isKosSyncPathIncluded } from './policy';

async function ensureFolders(app: App, path: string): Promise<void> {
  const parts = normalizePath(path).split('/');
  parts.pop();
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) await app.vault.createFolder(current);
  }
}

export class KosObsidianSyncVault implements KosSyncVaultPort {
  constructor(private readonly app: App) {}

  async listFiles(): Promise<KosSyncVaultFile[]> {
    const files = new Map(this.app.vault.getFiles().map((file) => [file.path, {
      path: file.path,
      ctime: file.stat.ctime,
      mtime: file.stat.mtime,
      size: file.stat.size,
    }]));

    // Obsidian deliberately omits dotfiles from getFiles(). KOS uses
    // `.gitkeep` to represent the runtime's empty directory skeleton, so walk
    // the adapter as well and merge only otherwise invisible, syncable files.
    const pending = [''];
    while (pending.length > 0) {
      const directory = pending.shift()!;
      const listed = await this.app.vault.adapter.list(directory);
      for (const folder of listed.folders) {
        const normalized = normalizePath(folder);
        if (isKosSyncPathIncluded(`${normalized}/`)) pending.push(normalized);
      }
      for (const listedFile of listed.files) {
        const path = normalizePath(listedFile);
        if (files.has(path) || !isKosSyncPathIncluded(path)) continue;
        const stat = await this.app.vault.adapter.stat(path);
        if (!stat || stat.type !== 'file') continue;
        files.set(path, {
          path,
          ctime: stat.ctime,
          mtime: stat.mtime,
          size: stat.size,
        });
      }
    }
    return [...files.values()];
  }

  async read(path: string): Promise<Uint8Array> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) return new Uint8Array(await this.app.vault.readBinary(file));
    if (await this.app.vault.adapter.exists(normalizePath(path))) {
      return new Uint8Array(await this.app.vault.adapter.readBinary(normalizePath(path)));
    }
    throw new Error(`同步文件不存在：${path}`);
  }

  async write(path: string, data: Uint8Array, ctime: number, mtime: number): Promise<KosSyncVaultFile> {
    await ensureFolders(this.app, path);
    const existing = this.app.vault.getAbstractFileByPath(path);
    const content = data.slice().buffer;
    if (existing instanceof TFile) {
      await this.app.vault.modifyBinary(existing, content, { ctime, mtime });
      return {
        path,
        ctime: existing.stat.ctime,
        mtime: existing.stat.mtime,
        size: existing.stat.size,
      };
    }
    if (existing) throw new Error(`同步路径被目录占用：${path}`);
    const normalized = normalizePath(path);
    const hidden = normalized.split('/').some((part) => part.startsWith('.'));
    if (hidden) {
      await this.app.vault.adapter.writeBinary(normalized, content, { ctime, mtime });
      const stat = await this.app.vault.adapter.stat(normalized);
      if (!stat || stat.type !== 'file') throw new Error(`同步隐藏文件写入失败：${path}`);
      return { path, ctime: stat.ctime, mtime: stat.mtime, size: stat.size };
    }
    const created = await this.app.vault.createBinary(path, content, { ctime, mtime });
    return {
      path,
      ctime: created.stat.ctime,
      mtime: created.stat.mtime,
      size: created.stat.size,
    };
  }

  async delete(path: string): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      await this.app.vault.delete(existing);
      return;
    }
    const normalized = normalizePath(path);
    if (await this.app.vault.adapter.exists(normalized)) await this.app.vault.adapter.remove(normalized);
  }
}

export class KosObsidianSyncStateRepository implements KosLiveSyncStateRepository {
  private readonly repository: KosFileSyncStateRepository;

  constructor(
    private readonly app: App,
    private readonly path: string,
  ) {
    this.repository = new KosFileSyncStateRepository(this.app.vault.adapter, this.path);
  }

  async load(): Promise<KosLiveSyncPersistedState> {
    return await this.repository.load();
  }

  async save(state: KosLiveSyncPersistedState): Promise<void> {
    await this.repository.save(state);
  }
}

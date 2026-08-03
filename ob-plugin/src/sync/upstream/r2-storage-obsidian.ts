import type { KosSyncSettings } from '../model';
import { KosObsidianHttpHandler } from './obsidian-http-handler';
import { KosR2Storage } from './r2-storage';

export function createKosObsidianR2Storage(settings: Readonly<KosSyncSettings>): KosR2Storage {
  return new KosR2Storage(
    settings,
    undefined,
    new KosObsidianHttpHandler({ requestTimeout: 30_000 }),
  );
}

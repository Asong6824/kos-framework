import PouchDB from 'pouchdb-core';
import IDBAdapter from 'pouchdb-adapter-idb';
import IndexedDBAdapter from 'pouchdb-adapter-indexeddb';

PouchDB.plugin(IDBAdapter).plugin(IndexedDBAdapter);

export { PouchDB };
export { KosLiveSyncDatabase } from '../../../upstream/livesync/kos-database.ts';
export { JournalSyncCore } from '../../../upstream/livesync/source/lib/src/replication/journal/JournalSyncCore.ts';
export { CheckPointInfoDefault } from '../../../upstream/livesync/source/lib/src/replication/journal/JournalSyncTypes.ts';
export {
  DEFAULT_SETTINGS,
} from '../../../upstream/livesync/source/lib/src/common/types.ts';
export {
  pickBucketSyncSettings,
} from '../../../upstream/livesync/source/lib/src/common/utils.ts';

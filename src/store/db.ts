import { openDB, type IDBPDatabase, type IDBPTransaction } from 'idb';

const DB_NAME = 'fitnotes';
const DB_VERSION = 1;

/** Record stores and the field each one is keyed by. */
export const KEY_PATHS = {
  entries: 'id',
  bodyweights: 'date',
  customExercises: 'id',
  notes: 'exerciseId',
} as const;

type Mode = 'readonly' | 'readwrite';

let connection: Promise<IDBPDatabase> | null = null;

function connect(): Promise<IDBPDatabase> {
  if (connection) return connection;
  const opening: Promise<IDBPDatabase> = openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      for (const [name, keyPath] of Object.entries(KEY_PATHS)) {
        db.createObjectStore(name, { keyPath });
      }
      db.createObjectStore('meta');
    },
    terminated() {
      if (connection === opening) connection = null;
    },
  });
  connection = opening;
  return opening;
}

function disconnect(): void {
  const stale = connection;
  connection = null;
  stale?.then((db) => db.close()).catch(() => {});
}

/**
 * Runs one transaction. Safari can kill the connection while the app is
 * backgrounded, and the next transaction then fails, so a failure reopens the
 * connection and retries once. `work` must be safe to run twice and must await
 * nothing but this transaction's requests, or the transaction commits early.
 */
export async function transact<T, M extends Mode>(
  stores: string[],
  mode: M,
  work: (tx: IDBPTransaction<unknown, string[], M>) => Promise<T>,
): Promise<T> {
  const attempt = async (): Promise<T> => {
    const db = await connect();
    const tx = db.transaction(stores, mode);
    try {
      const [result] = await Promise.all([work(tx), tx.done]);
      return result;
    } catch (error) {
      // A synchronous throw in `work` would otherwise commit its earlier requests.
      try {
        tx.abort();
      } catch {
        // The transaction has already finished.
      }
      throw error;
    }
  };
  try {
    return await attempt();
  } catch {
    disconnect();
    return attempt();
  }
}

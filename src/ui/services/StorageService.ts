const DB_NAME = 'SchoolarScheduleDB';
const STORE_NAME = 'projects';
const SNAPSHOT_STORE = 'snapshots';
const DB_VERSION = 2;

export class StorageService {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    if (this.db) return;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
          const store = db.createObjectStore(SNAPSHOT_STORE, { keyPath: 'id', autoIncrement: true });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });
  }

  async saveProject(project: any): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const data = { ...project, id: 'current_project' };
      const request = store.put(data);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async loadProject(): Promise<any | null> {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get('current_project');

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async saveSnapshot(project: any): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([SNAPSHOT_STORE], 'readwrite');
      const store = transaction.objectStore(SNAPSHOT_STORE);
      const snapshot = {
        project: JSON.parse(JSON.stringify(project)),
        timestamp: new Date().toISOString(),
        label: `Snapshot ${new Date().toLocaleString()}`
      };
      const request = store.add(snapshot);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async listSnapshots(): Promise<{ id: number; timestamp: string; label: string }[]> {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([SNAPSHOT_STORE], 'readonly');
      const store = transaction.objectStore(SNAPSHOT_STORE);
      const index = store.index('timestamp');
      const request = index.openCursor(null, 'prev');
      const snapshots: { id: number; timestamp: string; label: string }[] = [];

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          snapshots.push({ id: cursor.primaryKey as number, timestamp: cursor.value.timestamp, label: cursor.value.label });
          cursor.continue();
        } else {
          resolve(snapshots);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  async loadSnapshot(id: number): Promise<any | null> {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([SNAPSHOT_STORE], 'readonly');
      const store = transaction.objectStore(SNAPSHOT_STORE);
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result?.project || null);
      request.onerror = () => reject(request.error);
    });
  }

  async deleteSnapshot(id: number): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([SNAPSHOT_STORE], 'readwrite');
      const store = transaction.objectStore(SNAPSHOT_STORE);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}

export const storageService = new StorageService();

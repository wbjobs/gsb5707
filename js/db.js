/* IndexedDB 封装：保存 / 读取 / 清空传感器历史记录 */
const SensorDB = (() => {
  const DB_NAME = 'sensor-dashboard';
  const DB_VERSION = 1;
  const STORE = 'readings';
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
          store.createIndex('sensor', 'sensor', { unique: false });
          store.createIndex('ts', 'ts', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function addBatch(records) {
    if (!records.length) return 0;
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      records.forEach((r) => store.add(r));
      tx.oncomplete = () => resolve(records.length);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getAll(limit = 500) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => {
        const rows = req.result || [];
        rows.sort((a, b) => b.ts - a.ts);
        resolve(rows.slice(0, limit));
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function clear() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const req = tx.objectStore(STORE).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  return { addBatch, getAll, clear };
})();

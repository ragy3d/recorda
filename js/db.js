/* ------------------------------------------------------------------
   db.js — IndexedDB mínima para guardar los audios (los blobs no
   entran en localStorage). Los recordatorios en sí viven en
   localStorage, que es más simple y suficiente.
-------------------------------------------------------------------*/
const AudioDB = (() => {
  const NAME = "recorda", STORE = "audios", VERSION = 1;
  let dbp = null;

  function open(){
    if(dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      if(!("indexedDB" in window)) return reject(new Error("Sin IndexedDB"));
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if(!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
    return dbp;
  }

  function tx(mode, fn){
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req && req.result);
      t.onerror    = () => reject(t.error);
      t.onabort    = () => reject(t.error);
    }));
  }

  return {
    put:  (id, blob) => tx("readwrite", s => s.put(blob, id)),
    get:  (id)       => tx("readonly",  s => s.get(id)),
    del:  (id)       => tx("readwrite", s => s.delete(id)),
    clear:()         => tx("readwrite", s => s.clear())
  };
})();

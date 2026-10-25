// memdrive.js — makes one area's MEMORY.md look like the plain JSON file sync.js expects.
//   findFile  -> newest MEMORY.md in the area's folder (Claude rewrites the file as a new one,
//                so we look it up by folder every round instead of remembering an id)
//   read      -> the JSON block inside the markdown
//   write     -> puts the merged JSON back into the block; the rest of the file stays as it was
// Safety: if the file has no block but this device already has data for the area, we refuse to
// write (someone rewrote the file without the block) instead of saving a nearly-empty list.
import { emptyDoc, CorruptRemoteError } from './sync.js';
import { extractBlock, replaceBlock, stringifyDoc } from './memfile.js';
import { pickSection } from './sections.js';
import { unescapeMd } from './inbox.js';

export class MissingFileError extends Error { constructor(m) { super(m || 'MEMORY.md not found'); this.name = 'MissingFileError'; } }

export function makeMemDrive(drive, sec, folderId, opts = {}) {
  const cache = new Map(); // fileId -> { version, md }
  return {
    async findFile() {
      const id = await drive.findInFolder(folderId, 'MEMORY.md');
      if (!id) throw new MissingFileError('לא נמצא MEMORY.md בתיקייה של ' + sec);
      return id;
    },
    async create() { throw new MissingFileError('לא נמצא MEMORY.md בתיקייה של ' + sec); },
    getVersion: (id) => drive.getVersion(id),
    async readWithVersion(id) {
      const { text: md, version } = await drive.readWithVersion(id);
      cache.set(id, { version, md });
      const block = extractBlock(md);
      if (block === null) {
        if (opts.hasLocalData && await opts.hasLocalData()) {
          throw new CorruptRemoteError('הבלוק "נתוני הדשבורד" חסר ב-MEMORY.md של ' + sec + ' — לא כתבתי כלום');
        }
        return { text: JSON.stringify(emptyDoc()), version };
      }
      // A block mangled by a markdown-escaping copy is repaired on read (and written back clean).
      try { JSON.parse(block); return { text: block, version }; }
      catch (e) { try { JSON.parse(unescapeMd(block)); return { text: unescapeMd(block), version }; } catch (e2) { return { text: block, version }; } }
    },
    async write(id, doc) {
      const c = cache.get(id);
      if (!c) throw new Error('write before read');
      const md = replaceBlock(c.md, stringifyDoc(pickSection(doc, sec)));
      await drive.writeText(id, md);
      cache.delete(id);
    },
  };
}

// A view of the phone's database for one area: its own snapshot/journal, and only its own ops.
export function sectionStore(store, sec, sectionOfOp) {
  const k = (key) => sec + ':' + key;
  return {
    async getMeta(key) { return key === 'fileId' ? null : store.getMeta(k(key)); },
    async setMeta(key, v) { if (key !== 'fileId') await store.setMeta(k(key), v); },
    async getOutbox() { return (await store.getOutbox()).filter((op) => sectionOfOp(op) === sec); },
    removeOps: (ids) => store.removeOps(ids),
    addOp: (op) => store.addOp(op),
  };
}

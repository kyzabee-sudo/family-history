/** Browser-only human verification marks and FamilySearch checklist. */

import { personName } from './model.js';

const VER_KEY = 'fh-human-verified-v1';
const FS_MARK_KEY = 'fh-added-fs-v1';
const NAME_KEY = 'fh-verifier-name';
const FS_KEY = 'fh-fs-attached-v1';
const MARK_KEYS = { humanVerified: VER_KEY, addedToFamilySearch: FS_MARK_KEY };
export const ISSUE_NEW = 'https://github.com/kyzabee-sudo/family-history/issues/new';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function blankStore() {
  return { notes: {}, sources: {} };
}

export function verifierName() {
  try {
    const raw = localStorage.getItem(NAME_KEY);
    if (!raw) return '';
    if (raw.startsWith('"')) {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'string') return parsed;
    }
    return raw;
  } catch {
    return '';
  }
}

export function setVerifierName(name) {
  localStorage.setItem(NAME_KEY, name);
}

function loadMarkStore(action) {
  const store = read(MARK_KEYS[action], blankStore());
  if (!store || typeof store !== 'object' || !store.notes || !store.sources) return blankStore();
  return store;
}

function saveMarkStore(action, store) {
  write(MARK_KEYS[action], store);
}

export function loadStore() {
  return loadMarkStore('humanVerified');
}

function saveStore(store) {
  saveMarkStore('humanVerified', store);
}

function dataMark(record, field) {
  const hv = record && record[field];
  if (!hv || typeof hv !== 'object') return null;
  if (typeof hv.by !== 'string' || !hv.by.trim()) return null;
  if (typeof hv.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(hv.date)) return null;
  return {
    by: hv.by.trim(),
    date: hv.date,
    comment: typeof hv.comment === 'string' ? hv.comment : '',
    origin: 'data',
  };
}

export function dataVerification(record) {
  return dataMark(record, 'humanVerified');
}

export function dataFamilySearch(record) {
  return dataMark(record, 'addedToFamilySearch');
}

function effectiveMark(record, kind, id, action) {
  const fromData = action === 'addedToFamilySearch' ? dataFamilySearch(record) : dataVerification(record);
  if (fromData) return fromData;
  const store = loadMarkStore(action);
  const bucket = kind === 'note' ? store.notes : store.sources;
  const local = bucket[id];
  if (!local || !local.by || !local.date) return null;
  return {
    by: local.by,
    date: local.date,
    comment: local.comment || '',
    origin: 'local',
    submitted: local.submitted || '',
  };
}

export function effectiveVerification(record, kind, id) {
  return effectiveMark(record, kind, id, 'humanVerified');
}

export function effectiveFamilySearch(record, kind, id) {
  return effectiveMark(record, kind, id, 'addedToFamilySearch');
}

function writeMark(action, kind, id, { by, date, comment }) {
  const store = loadMarkStore(action);
  const bucket = kind === 'note' ? store.notes : store.sources;
  const entry = { by: by.trim(), date };
  if (comment && comment.trim()) entry.comment = comment.trim();
  bucket[id] = entry;
  saveMarkStore(action, store);
  setVerifierName(entry.by);
}

function deleteMark(action, kind, id) {
  const store = loadMarkStore(action);
  const bucket = kind === 'note' ? store.notes : store.sources;
  delete bucket[id];
  saveMarkStore(action, store);
}

export function markLocal(kind, id, fields) {
  writeMark('humanVerified', kind, id, fields);
}

export function markFamilySearch(kind, id, fields) {
  writeMark('addedToFamilySearch', kind, id, fields);
}

export function clearLocal(kind, id) {
  deleteMark('humanVerified', kind, id);
}

export function clearFamilySearch(kind, id) {
  deleteMark('addedToFamilySearch', kind, id);
}

export function reconcileStore(index) {
  for (const action of ['humanVerified', 'addedToFamilySearch']) {
    const store = loadMarkStore(action);
    const applied = action === 'addedToFamilySearch' ? dataFamilySearch : dataVerification;
    let changed = false;
    for (const id of Object.keys(store.notes)) {
      const row = index.notesById.get(id);
      if (row && applied(row.note)) {
        delete store.notes[id];
        changed = true;
      }
    }
    for (const id of Object.keys(store.sources)) {
      const source = index.sourcesById[id];
      if (source && applied(source)) {
        delete store.sources[id];
        changed = true;
      }
    }
    if (changed) saveMarkStore(action, store);
  }
}

function localEntry(kind, id, value, index, action) {
  if (!value || !value.by || !value.date) return null;
  const applied = action === 'addedToFamilySearch' ? dataFamilySearch : dataVerification;
  if (kind === 'note') {
    const row = index.notesById.get(id);
    if (row && applied(row.note)) return null;
    return {
      kind,
      id,
      action,
      by: value.by,
      date: value.date,
      comment: value.comment || '',
      submitted: value.submitted || '',
      batch: value.batch || '',
      label: row ? personName(row.person) : 'Unknown person',
    };
  }
  const source = index.sourcesById[id];
  if (source && applied(source)) return null;
  return {
    kind,
    id,
    action,
    by: value.by,
    date: value.date,
    comment: value.comment || '',
    submitted: value.submitted || '',
    batch: value.batch || '',
    label: source ? source.title : id,
  };
}

function localEntries(index, wantSubmitted) {
  const entries = [];
  for (const action of ['humanVerified', 'addedToFamilySearch']) {
    const store = loadMarkStore(action);
    for (const [id, value] of Object.entries(store.notes)) {
      const entry = localEntry('note', id, value, index, action);
      if (!entry) continue;
      if (wantSubmitted ? entry.submitted : !entry.submitted) entries.push(entry);
    }
    for (const [id, value] of Object.entries(store.sources)) {
      const entry = localEntry('source', id, value, index, action);
      if (!entry) continue;
      if (wantSubmitted ? entry.submitted : !entry.submitted) entries.push(entry);
    }
  }
  return entries;
}

export function pendingEntries(index) {
  return localEntries(index, false);
}

export function submittedEntries(index) {
  return localEntries(index, true);
}

export function markVerificationsSubmitted(entries, submitted, batch) {
  const dirty = new Set();
  const stores = {
    humanVerified: loadMarkStore('humanVerified'),
    addedToFamilySearch: loadMarkStore('addedToFamilySearch'),
  };
  for (const entry of entries) {
    const action = entry.action === 'addedToFamilySearch' ? 'addedToFamilySearch' : 'humanVerified';
    const store = stores[action];
    const bucket = entry.kind === 'note' ? store.notes : store.sources;
    const local = bucket[entry.id];
    if (!local || local.submitted) continue;
    local.submitted = submitted;
    local.batch = batch;
    dirty.add(action);
  }
  for (const action of dirty) saveMarkStore(action, stores[action]);
}

export function clearSubmittedVerifications() {
  for (const action of ['humanVerified', 'addedToFamilySearch']) {
    const store = loadMarkStore(action);
    let changed = false;
    for (const bucket of [store.notes, store.sources]) {
      for (const id of Object.keys(bucket)) {
        if (bucket[id] && bucket[id].submitted) {
          delete bucket[id];
          changed = true;
        }
      }
    }
    if (changed) saveMarkStore(action, store);
  }
}

export function verificationCounts(index) {
  let notesVerified = 0;
  for (const row of index.notesById.values()) {
    if (effectiveVerification(row.note, 'note', row.note.id)) notesVerified += 1;
  }
  let sourcesVerified = 0;
  for (const source of index.data.sources) {
    if (effectiveVerification(source, 'source', source.id)) sourcesVerified += 1;
  }
  return {
    notesVerified,
    notesTotal: index.notesById.size,
    sourcesVerified,
    sourcesTotal: index.data.sources.length,
  };
}

export function passesVerifyFilter(filter, record, kind, id) {
  const marked = !!effectiveVerification(record, kind, id);
  if (filter === 'verified') return marked;
  if (filter === 'unverified') return !marked;
  return true;
}

export function verificationPayload(entries) {
  return {
    verifications: entries.map((entry) => {
      const row = entry.kind === 'note' ? { noteId: entry.id } : { sourceId: entry.id };
      row.action = entry.action === 'addedToFamilySearch' ? 'addedToFamilySearch' : 'humanVerified';
      row.by = entry.by;
      row.date = entry.date;
      if (entry.comment) row.comment = entry.comment;
      return row;
    }),
  };
}

export function issueBody(entries) {
  const lines = entries.map((entry) => {
    const where = entry.kind === 'note' ? `Note \`${entry.id}\`` : `Source \`${entry.id}\``;
    const what = entry.action === 'addedToFamilySearch' ? 'Added to FamilySearch' : 'Human-verified';
    const comment = entry.comment ? ` — ${entry.comment}` : '';
    return `- ${what}: ${where} (${entry.label}): ${entry.by}, ${entry.date}${comment}`;
  });
  return [
    'Apply these marks to `data/data.json`, then close this issue.',
    '',
    'Each item has an `action`. Set that field on the note or source to `{"by","date","comment?"}`:',
    '- `humanVerified` when action is `humanVerified`.',
    '- `addedToFamilySearch` when action is `addedToFamilySearch`.',
    'A value in data.json overrides the browser mark.',
    '',
    ...lines,
    '',
    '```json',
    JSON.stringify(verificationPayload(entries), null, 2),
    '```',
    '',
  ].join('\n');
}

export function issueLink(entries) {
  const body = issueBody(entries);
  const url = `${ISSUE_NEW}?${new URLSearchParams({
    title: 'Human verifications',
    labels: 'verification',
    body,
  }).toString()}`;
  return { url, body, tooLong: url.length > 7500 };
}

function fsMap() {
  const map = read(FS_KEY, {});
  return map && typeof map === 'object' ? map : {};
}

export function isAttached(personId, sourceId) {
  return !!fsMap()[`${personId}|${sourceId}`];
}

export function setAttached(personId, sourceId, on) {
  const map = fsMap();
  const key = `${personId}|${sourceId}`;
  if (on) map[key] = new Date().toISOString().slice(0, 10);
  else delete map[key];
  write(FS_KEY, map);
}

export function todayISO() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

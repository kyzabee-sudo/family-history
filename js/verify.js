/** Browser-only human verification marks and FamilySearch checklist. */

import { personName } from './model.js';

const VER_KEY = 'fh-human-verified-v1';
const NAME_KEY = 'fh-verifier-name';
const FS_KEY = 'fh-fs-attached-v1';
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

export function loadStore() {
  const store = read(VER_KEY, blankStore());
  if (!store || typeof store !== 'object' || !store.notes || !store.sources) return blankStore();
  return store;
}

function saveStore(store) {
  write(VER_KEY, store);
}

export function dataVerification(record) {
  const hv = record && record.humanVerified;
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

export function effectiveVerification(record, kind, id) {
  const fromData = dataVerification(record);
  if (fromData) return fromData;
  const store = loadStore();
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

export function markLocal(kind, id, { by, date, comment }) {
  const store = loadStore();
  const bucket = kind === 'note' ? store.notes : store.sources;
  const entry = { by: by.trim(), date };
  if (comment && comment.trim()) entry.comment = comment.trim();
  bucket[id] = entry;
  saveStore(store);
  setVerifierName(entry.by);
}

export function clearLocal(kind, id) {
  const store = loadStore();
  const bucket = kind === 'note' ? store.notes : store.sources;
  delete bucket[id];
  saveStore(store);
}

export function reconcileStore(index) {
  const store = loadStore();
  let changed = false;
  for (const id of Object.keys(store.notes)) {
    const row = index.notesById.get(id);
    if (row && dataVerification(row.note)) {
      delete store.notes[id];
      changed = true;
    }
  }
  for (const id of Object.keys(store.sources)) {
    const source = index.sourcesById[id];
    if (source && dataVerification(source)) {
      delete store.sources[id];
      changed = true;
    }
  }
  if (changed) saveStore(store);
}

function localEntry(kind, id, value, index) {
  if (!value || !value.by || !value.date) return null;
  if (kind === 'note') {
    const row = index.notesById.get(id);
    if (row && dataVerification(row.note)) return null;
    return {
      kind,
      id,
      by: value.by,
      date: value.date,
      comment: value.comment || '',
      submitted: value.submitted || '',
      batch: value.batch || '',
      label: row ? personName(row.person) : 'Unknown person',
    };
  }
  const source = index.sourcesById[id];
  if (source && dataVerification(source)) return null;
  return {
    kind,
    id,
    by: value.by,
    date: value.date,
    comment: value.comment || '',
    submitted: value.submitted || '',
    batch: value.batch || '',
    label: source ? source.title : id,
  };
}

function localEntries(index, wantSubmitted) {
  const store = loadStore();
  const entries = [];
  for (const [id, value] of Object.entries(store.notes)) {
    const entry = localEntry('note', id, value, index);
    if (!entry) continue;
    if (wantSubmitted ? entry.submitted : !entry.submitted) entries.push(entry);
  }
  for (const [id, value] of Object.entries(store.sources)) {
    const entry = localEntry('source', id, value, index);
    if (!entry) continue;
    if (wantSubmitted ? entry.submitted : !entry.submitted) entries.push(entry);
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
  const store = loadStore();
  for (const entry of entries) {
    const bucket = entry.kind === 'note' ? store.notes : store.sources;
    const local = bucket[entry.id];
    if (!local || local.submitted) continue;
    local.submitted = submitted;
    local.batch = batch;
  }
  saveStore(store);
}

export function clearSubmittedVerifications() {
  const store = loadStore();
  for (const bucket of [store.notes, store.sources]) {
    for (const id of Object.keys(bucket)) {
      if (bucket[id] && bucket[id].submitted) delete bucket[id];
    }
  }
  saveStore(store);
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
      row.by = entry.by;
      row.date = entry.date;
      if (entry.comment) row.comment = entry.comment;
      return row;
    }),
  };
}

export function issueBody(entries) {
  const lines = entries.map((entry) => {
    const what = entry.kind === 'note' ? `Note \`${entry.id}\`` : `Source \`${entry.id}\``;
    const comment = entry.comment ? ` — ${entry.comment}` : '';
    return `- ${what} (${entry.label}): ${entry.by}, ${entry.date}${comment}`;
  });
  return [
    'Apply these human verifications to `data/data.json`, then close this issue.',
    '',
    'Set `humanVerified` to `{"by","date","comment?"}` on each note or source. A value in data.json overrides the browser mark.',
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

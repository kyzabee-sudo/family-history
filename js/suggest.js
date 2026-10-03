/** Browser-only correction suggestions. Applied later by hand in data.json. */

import { ISSUE_NEW, setVerifierName, todayISO } from './verify.js';

const KEY = 'fh-suggestions-v1';

export const SUGGESTION_KINDS = [
  'Correction',
  'Clarifying note',
  'Wrong person linked',
  'Other',
];

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(list) {
  localStorage.setItem(KEY, JSON.stringify(list));
}

function usable(item) {
  return !!(item && item.targetType && item.targetId && item.comment && item.by && item.date);
}

function allSuggestions() {
  return read().filter(usable);
}

export function pendingSuggestions() {
  return allSuggestions().filter((item) => !item.submitted);
}

export function submittedSuggestions() {
  return allSuggestions().filter((item) => item.submitted);
}

export function addSuggestion(entry) {
  const list = read();
  const item = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    targetType: entry.targetType,
    targetId: entry.targetId,
    kind: entry.kind,
    comment: entry.comment.trim(),
    by: entry.by.trim(),
    date: entry.date,
  };
  if (entry.personId) item.personId = entry.personId;
  if (entry.field) item.field = entry.field;
  if (entry.suggestedValue && entry.suggestedValue.trim()) item.suggestedValue = entry.suggestedValue.trim();
  list.push(item);
  write(list);
  setVerifierName(item.by);
  return item;
}

export function removeSuggestion(id) {
  write(read().filter((item) => item.id !== id));
}

export function clearSuggestions() {
  write(read().filter((item) => item && item.submitted));
}

export function clearSubmittedSuggestions() {
  write(read().filter((item) => !item || !item.submitted));
}

export function markSuggestionsSubmitted(ids, submitted = todayISO(), batch = '') {
  const want = new Set(ids);
  const list = read();
  for (const item of list) {
    if (!item || !want.has(item.id) || item.submitted) continue;
    item.submitted = submitted;
    item.batch = batch;
  }
  write(list);
}

function sameText(left, right) {
  return String(left || '').trim() === String(right || '').trim();
}

export function suggestionApplied(index, item) {
  if (!item || (item.targetType !== 'source' && item.targetType !== 'note')) return false;
  const record = item.targetType === 'source'
    ? index.sourcesById[item.targetId]
    : index.notesById.get(item.targetId)?.note;
  if (!record || !Array.isArray(record.corrections)) return false;
  return record.corrections.some((entry) => {
    if (!entry || (entry.status !== 'applied' && entry.status !== 'declined')) return false;
    return entry.kind === item.kind && sameText(entry.comment, item.comment) && sameText(entry.by, item.by);
  });
}

export function reconcileSuggestions(index) {
  const list = read();
  const next = list.filter((item) => !suggestionApplied(index, item));
  if (next.length !== list.length) write(next);
}

export function suggestionPayload(entries) {
  return {
    corrections: entries.map((entry) => {
      const row = {
        targetType: entry.targetType,
        targetId: entry.targetId,
        kind: entry.kind,
        comment: entry.comment,
        by: entry.by,
        date: entry.date,
      };
      if (entry.personId) row.personId = entry.personId;
      if (entry.field) row.field = entry.field;
      if (entry.suggestedValue) row.suggestedValue = entry.suggestedValue;
      return row;
    }),
  };
}

export function suggestionIssueBody(entries) {
  const lines = entries.map((entry) => {
    const where = [
      entry.targetType,
      `\`${entry.targetId}\``,
      entry.personId ? `person \`${entry.personId}\`` : '',
      entry.field ? `field \`${entry.field}\`` : '',
    ].filter(Boolean).join(' ');
    const suggested = entry.suggestedValue ? ` Suggested value: ${entry.suggestedValue}.` : '';
    const comment = /[.!?]$/.test(entry.comment.trim()) ? entry.comment.trim() : `${entry.comment.trim()}.`;
    return `- ${where}: ${entry.kind} — ${comment}${suggested} (${entry.by}, ${entry.date})`;
  });
  return [
    'Apply these corrections and notes to `data/data.json` by hand, then close this issue.',
    '',
    'For a source or note, record the decision on that item\'s `corrections` array:',
    '`{"by","date","kind","comment","status":"applied"|"declined","resolution"}`.',
    'For a person fact, event, or family, edit the record itself and say what you did in `resolution` if you also log it on a related note or source.',
    '',
    ...lines,
    '',
    '```json',
    JSON.stringify(suggestionPayload(entries), null, 2),
    '```',
    '',
  ].join('\n');
}

export function suggestionIssueLink(entries) {
  const body = suggestionIssueBody(entries);
  const url = `${ISSUE_NEW}?${new URLSearchParams({
    title: 'Corrections and notes',
    labels: 'correction',
    body,
  }).toString()}`;
  return { url, body, tooLong: url.length > 7500 };
}

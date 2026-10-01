/** Pure helpers and the in-memory index over data.json. */

export const DEFAULT_ROOT = 'juan-valdes-grandfather';
export const DEFAULT_DEPTH = 2;

export const LINE_ROOTS = [
  ['Valdés', 'juan-valdes-grandfather'],
  ['Sánchez', 'francisco-sanchez-fl1780'],
  ['Menéndez', 'manuel-menendez-tuya-fl1787'],
  ['Nieto', 'jose-nieto-fl1798'],
  ['Uría', 'manuel-de-la-uria-fl1780'],
  ['Rodríguez', 'francisco-rodriguez-mayor-fl1773'],
  ['Bermúdez', 'jose-bermudez-abt1867'],
];

const LINE_COLORS = {
  Valdés: '#1f4d3a',
  Sánchez: '#8c3d2f',
  Menéndez: '#24557a',
  Nieto: '#6d4c2d',
  Uría: '#3e6b52',
  Rodríguez: '#633d57',
  Bermúdez: '#1d3e66',
};

export function fold(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();
}

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

export function personName(person) {
  if (!person) return 'Unknown';
  return [person.given, person.surnames].filter(Boolean).join(' ');
}

export function lineKey(line) {
  if (!line) return 'Other';
  if (line.startsWith('Bermúdez')) return 'Bermúdez';
  return line.split(' (')[0] || line;
}

export function lineColor(line) {
  return LINE_COLORS[lineKey(line)] || '#5e564c';
}

export function yearOf(date) {
  const match = String(date || '').match(/\d{4}/);
  return match ? match[0] : '';
}

export function dateSortKey(date) {
  const text = String(date || '');
  const match = text.match(/\d{4}/);
  if (!match) return 99999;
  let frac = 0.5;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) frac = (Number(iso[2]) - 1) / 12 + (Number(iso[3]) - 1) / 400;
  else if (/\bbef\b|before/i.test(text)) frac = 0.05;
  else if (/\baft\b|after/i.test(text)) frac = 0.95;
  return Number(match[0]) + frac;
}

export function lifeSpan(person) {
  const birth = person.birth?.date;
  const death = person.death?.date;
  if (!birth && !death) return '';
  if (birth && death) return `${birth} – ${death}`;
  if (birth) return String(birth);
  return `d. ${death}`;
}

/** Birth place, otherwise a baptism parish or event place. Empty when neither is recorded. */
export function birthplace(person) {
  const direct = String(person?.birth?.place || '').trim();
  if (direct) return direct;
  const events = person?.events || [];
  const baptism = events.find((event) => {
    const kind = `${event.type || ''} ${event.details || ''}`;
    return /baptis|bautiz/i.test(kind) && String(event.place || '').trim();
  });
  return String(baptism?.place || '').trim();
}

export function noteFallbackId(personId, index) {
  return `${personId}-n${index}`;
}

export async function loadDataset() {
  const response = await fetch('data/data.json');
  if (!response.ok) throw new Error(`data.json ${response.status}`);
  const data = await response.json();
  return buildIndex(data);
}

export function buildIndex(data) {
  const notesById = new Map();
  for (const person of data.people) {
    person.notes.forEach((note, index) => {
      if (!note.id) note.id = noteFallbackId(person.id, index);
      notesById.set(note.id, { note, person, index });
    });
  }
  const peopleById = Object.fromEntries(data.people.map((p) => [p.id, p]));
  const familiesById = Object.fromEntries(data.families.map((f) => [f.id, f]));
  const sourcesById = Object.fromEntries(data.sources.map((s) => [s.id, s]));
  const sourcesByLower = Object.fromEntries(data.sources.map((s) => [s.id.toLowerCase(), s]));
  const familiesByLower = Object.fromEntries(data.families.map((f) => [f.id.toLowerCase(), f]));
  const leadsByPerson = new Map();
  for (const lead of data.researchLeads) {
    for (const id of lead.personIds || []) {
      if (!leadsByPerson.has(id)) leadsByPerson.set(id, []);
      leadsByPerson.get(id).push(lead);
    }
  }
  const excludedByPerson = new Map();
  for (const item of data.excluded) {
    for (const id of item.relatedPersonIds || []) {
      if (!excludedByPerson.has(id)) excludedByPerson.set(id, []);
      excludedByPerson.get(id).push(item);
    }
  }
  return {
    data,
    peopleById,
    familiesById,
    sourcesById,
    sourcesByLower,
    familiesByLower,
    notesById,
    leadsByPerson,
    excludedByPerson,
  };
}

export function sourcesForPerson(index, personId) {
  const confirmed = [];
  const candidate = [];
  const seen = new Set();
  for (const source of index.data.sources) {
    if ((source.personIds || []).includes(personId)) {
      confirmed.push(source);
      seen.add(source.id);
    } else if ((source.candidatePersonIds || []).includes(personId)) {
      candidate.push(source);
    }
  }
  const person = index.peopleById[personId];
  for (const id of person?.sourceIds || []) {
    if (!seen.has(id) && index.sourcesById[id]) {
      confirmed.push(index.sourcesById[id]);
      seen.add(id);
    }
  }
  return { confirmed, candidate };
}

export function searchAll(index, query, limit = 12) {
  const needle = fold(query).trim();
  if (!needle) return { people: [], sources: [], peopleTotal: 0, sourcesTotal: 0 };
  const people = index.data.people.filter((person) => {
    const hay = fold([
      person.given,
      person.surnames,
      person.id,
      person.line,
      person.birth?.date,
      person.birth?.place,
      person.death?.date,
      person.death?.place,
      ...(person.alsoKnownAs || []),
    ].join(' '));
    return hay.includes(needle);
  });
  const sources = index.data.sources.filter((source) => {
    const hay = fold([
      source.id,
      source.title,
      source.type,
      source.date,
      source.place,
      source.repository,
      source.transcription,
      source.citationText,
      source.imageCode,
    ].join(' '));
    return hay.includes(needle);
  });
  return {
    people: people.slice(0, limit),
    sources: sources.slice(0, limit),
    peopleTotal: people.length,
    sourcesTotal: sources.length,
  };
}

export function recentNotes(index, count = 8) {
  const rows = [];
  for (const { note, person } of index.notesById.values()) {
    rows.push({ note, person });
  }
  rows.sort((a, b) => {
    const byDate = (b.note.date || '').localeCompare(a.note.date || '');
    if (byDate) return byDate;
    return personName(a.person).localeCompare(personName(b.person));
  });
  return rows.slice(0, count);
}

export function timelineOf(index, person) {
  const items = [];
  const pushVital = (kind, vital) => {
    if (!vital) return;
    if (!vital.date && !vital.place && !vital.details) return;
    items.push({
      kind,
      date: vital.date,
      place: vital.place,
      quality: vital.quality,
      details: vital.details || '',
      sort: dateSortKey(vital.date),
      tie: kind === 'birth' ? 0 : 3,
    });
  };
  pushVital('birth', person.birth);
  pushVital('death', person.death);
  for (const event of person.events || []) {
    items.push({
      kind: event.type || 'event',
      date: event.date,
      place: event.place,
      quality: event.quality,
      details: event.details || '',
      sort: dateSortKey(event.date),
      tie: 2,
    });
  }
  for (const familyId of person.familyIds || []) {
    const family = index.familiesById[familyId];
    if (!family) continue;
    if (family.husband !== person.id && family.wife !== person.id) continue;
    const marriage = family.marriage || {};
    if (!marriage.date && !marriage.place) continue;
    const spouseId = family.husband === person.id ? family.wife : family.husband;
    items.push({
      kind: 'marriage',
      date: marriage.date,
      place: marriage.place,
      quality: marriage.quality,
      details: spouseId ? `Spouse: ${personName(index.peopleById[spouseId])}` : '',
      sort: dateSortKey(marriage.date),
      tie: 1,
    });
  }
  items.sort((a, b) => a.sort - b.sort || a.tie - b.tie);
  return items;
}

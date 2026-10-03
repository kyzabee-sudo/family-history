import {
  DEFAULT_DEPTH,
  DEFAULT_ROOT,
  LINE_ROOTS,
  birthplace,
  dateSortKey,
  esc,
  fold,
  lifeSpan,
  lineKey,
  loadDataset,
  personName,
  recentNotes,
  searchAll,
  sourcesForPerson,
  timelineOf,
  yearOf,
} from './model.js';
import { mountTree } from './tree.js';
import {
  ISSUE_NEW,
  clearFamilySearch,
  clearLocal,
  clearSubmittedVerifications,
  effectiveFamilySearch,
  effectiveVerification,
  isAttached,
  issueLink,
  markFamilySearch,
  markLocal,
  markVerificationsSubmitted,
  passesVerifyFilter,
  pendingEntries,
  reconcileStore,
  setAttached,
  submittedEntries,
  todayISO,
  verificationCounts,
  verificationPayload,
  verifierName,
} from './verify.js';
import {
  SUGGESTION_KINDS,
  addSuggestion,
  clearSubmittedSuggestions,
  clearSuggestions,
  markSuggestionsSubmitted,
  pendingSuggestions,
  reconcileSuggestions,
  removeSuggestion,
  submittedSuggestions,
  suggestionIssueLink,
  suggestionPayload,
} from './suggest.js';

const SITE = 'Valdés Family History';
const MAX_GEN = 8;
const QUEUE_CAP = 16;
const HUMAN_ICON = `<svg class="ico" viewBox="0 0 20 20" aria-hidden="true"><circle cx="7.2" cy="6.2" r="2.7" fill="currentColor"></circle><path d="M2.2 15.2c.5-2.4 2.5-3.7 5-3.7s4.5 1.3 5 3.7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path><path d="M12.6 8.4l1.5 1.5 3.2-3.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path></svg>`;

let INDEX = null;
let cleanup = () => {};
let current = { name: 'home', id: '', params: new URLSearchParams() };
const ui = {
  verifyFilter: 'all',
  onlyUnattached: false,
  openVerify: null,
  openSuggest: null,
  peopleLine: 'all',
  peopleSort: { key: 'name', dir: 1 },
  sourceType: 'all',
  sourceVerify: 'all',
  familiesQuery: '',
  openSubmitted: null,
};
const treeState = { forcedOpen: new Set(), forcedClosed: new Set() };
let treeHandle = null;
let lastTreeKey = '';

const main = () => document.getElementById('content');

function cap(value) {
  const text = String(value || 'unknown').replace(/-/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function dash(value) {
  return value ? esc(value) : '—';
}

function statusBadge(status) {
  const value = status || 'unknown';
  return `<span class="badge ${esc(value)}">${esc(cap(value))}</span>`;
}

function humanBadge(verification) {
  if (!verification) return '';
  const bits = ['Human-verified', verification.date, verification.by].filter(Boolean);
  const title = verification.comment ? ` title="${esc(verification.comment)}"` : '';
  const pending = verification.origin !== 'local'
    ? ''
    : `<span class="pending-flag">${verification.submitted ? 'submitted' : 'saved here'}</span>`;
  return `<span class="badge human"${title}>${HUMAN_ICON}<span>${esc(bits.join(' · '))}</span></span>${pending}`;
}

function familySearchBadge(mark) {
  if (!mark) return '';
  const bits = ['Added to FamilySearch', mark.date, mark.by].filter(Boolean);
  const title = mark.comment ? ` title="${esc(mark.comment)}"` : '';
  const pending = mark.origin !== 'local'
    ? ''
    : `<span class="pending-flag">${mark.submitted ? 'submitted' : 'saved here'}</span>`;
  return `<span class="badge fs-added"${title}><span>${esc(bits.join(' · '))}</span></span>${pending}`;
}

function recordBadges(record, kind, id) {
  return `${humanBadge(effectiveVerification(record, kind, id))}${familySearchBadge(effectiveFamilySearch(record, kind, id))}`;
}

function livingBadge(person) {
  if (person.livingStatus !== 'possibly-living') return '';
  return '<span class="badge living">Possibly living</span>';
}

function personHref(id) {
  return `#/person/${encodeURIComponent(id)}`;
}

function personLink(id) {
  const person = INDEX.peopleById[id];
  if (!person) return `<span class="muted">${esc(id || 'Unknown')}</span>`;
  return `<a href="${personHref(id)}">${esc(personName(person))}</a>`;
}

function sourceHref(id) {
  return `#/source/${encodeURIComponent(id)}`;
}

function familyHref(id) {
  return `#/family/${encodeURIComponent(id)}`;
}

function findSource(id) {
  if (!id || !INDEX) return null;
  return INDEX.sourcesById[id] || INDEX.sourcesByLower[String(id).toLowerCase()] || null;
}

function findFamily(id) {
  if (!id || !INDEX) return null;
  return INDEX.familiesById[id] || INDEX.familiesByLower[String(id).toLowerCase()] || null;
}

function familyLabel(family) {
  const husband = personName(INDEX.peopleById[family.husband]);
  const wife = family.wife ? personName(INDEX.peopleById[family.wife]) : 'wife unknown';
  return `${husband} and ${wife}`;
}

function familyLink(id, label = 'Family') {
  const family = findFamily(id);
  if (!family) return '';
  return `<a href="${familyHref(family.id)}">${esc(label)}</a>`;
}

function linkify(text) {
  return String(text ?? '').split(/(fam-[A-Za-z0-9-]+)/).map((part) => {
    if (/^fam-[A-Za-z0-9-]+$/i.test(part)) {
      const family = findFamily(part);
      if (family) return `<a href="${familyHref(family.id)}">${esc(part)}</a>`;
    }
    return esc(part);
  }).join('');
}

function crumbs(items) {
  const lis = items.map((item, index) => {
    if (index === items.length - 1 || !item[0]) return `<li aria-current="page">${esc(item[1])}</li>`;
    return `<li><a href="${item[0]}">${esc(item[1])}</a></li>`;
  }).join('');
  return `<nav class="crumbs" aria-label="Breadcrumb"><ol>${lis}</ol></nav>`;
}

function treeHref(id, { depth = String(DEFAULT_DEPTH), ancestors = true } = {}) {
  const params = new URLSearchParams();
  if (String(depth) !== String(DEFAULT_DEPTH)) params.set('depth', String(depth));
  if (!ancestors) params.set('ancestors', '0');
  const query = params.toString();
  return `#/tree/${encodeURIComponent(id)}${query ? `?${query}` : ''}`;
}

function treeDepth() {
  const raw = current.params.get('depth') || String(DEFAULT_DEPTH);
  if (raw === 'all') return String(MAX_GEN);
  const number = Number(raw);
  if (!Number.isFinite(number)) return String(DEFAULT_DEPTH);
  return String(Math.min(MAX_GEN, Math.max(1, Math.round(number))));
}

function treeAncestors() {
  return current.params.get('ancestors') !== '0';
}

function setLive(message) {
  const live = document.getElementById('live');
  if (live) live.textContent = message;
}

function newBatch() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function batchKey(entry) {
  return entry.batch || entry.submitted || 'submitted';
}

function openPreparedIssue(link, payload, title, labels, opened) {
  if (link.tooLong) {
    copyText(JSON.stringify(payload, null, 2));
    setLive('The form link was too long. The list was copied — paste it into the form that opens.');
    window.open(`${ISSUE_NEW}?${new URLSearchParams({ title, labels })}`, '_blank', 'noopener');
    return;
  }
  window.open(link.url, '_blank', 'noopener');
  setLive(opened);
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  if (button) {
    const previous = button.textContent;
    button.textContent = 'Copied';
    setTimeout(() => {
      button.textContent = previous;
    }, 1400);
  }
  setLive('Copied');
}

function markForm(kind, id, mark) {
  const legend = mark === 'addedToFamilySearch' ? 'Added to FamilySearch' : 'Mark verified';
  return `
    <form class="verify-form" data-kind="${esc(kind)}" data-id="${esc(id)}" data-mark="${esc(mark)}">
      <p class="hint">${esc(legend)}</p>
      <label>By <input name="by" required value="${esc(verifierName())}" autocomplete="name"></label>
      <label>Date <input name="date" type="date" required value="${esc(todayISO())}"></label>
      <label>Comment <input name="comment" placeholder="Optional"></label>
      <button type="submit" class="btn btn-small btn-primary">Save</button>
      <button type="button" class="btn btn-small btn-ghost" data-action="cancel-verify">Cancel</button>
    </form>`;
}

function oneMarkControl(kind, id, record, mark) {
  const current = mark === 'addedToFamilySearch'
    ? effectiveFamilySearch(record, kind, id)
    : effectiveVerification(record, kind, id);
  if (current?.origin === 'data') return '';
  if (current?.origin === 'local') {
    const label = mark === 'addedToFamilySearch' ? 'Remove FamilySearch mark' : 'Remove verification';
    const title = mark === 'addedToFamilySearch'
      ? 'Remove the Added to FamilySearch mark saved in this browser'
      : 'Remove the human-verification mark saved in this browser';
    return `<button type="button" class="btn btn-small btn-ghost" data-action="clear-verify" data-kind="${esc(kind)}" data-id="${esc(id)}" data-mark="${esc(mark)}" title="${title}">${label}</button>`;
  }
  const open = ui.openVerify && ui.openVerify.kind === kind && ui.openVerify.id === id && (ui.openVerify.mark || 'humanVerified') === mark;
  if (open) return markForm(kind, id, mark);
  if (mark === 'addedToFamilySearch') {
    return `<button type="button" class="btn btn-small" data-action="open-verify" data-kind="${esc(kind)}" data-id="${esc(id)}" data-mark="addedToFamilySearch" title="Save an Added to FamilySearch mark in this browser">Added to FamilySearch</button>`;
  }
  return `<button type="button" class="btn btn-small" data-action="open-verify" data-kind="${esc(kind)}" data-id="${esc(id)}" data-mark="humanVerified" title="Save a human-verification mark in this browser">Mark verified</button>`;
}

function verifyControls(kind, id, record) {
  const open = ui.openVerify && ui.openVerify.kind === kind && ui.openVerify.id === id;
  if (open) return oneMarkControl(kind, id, record, ui.openVerify.mark || 'humanVerified');
  return `${oneMarkControl(kind, id, record, 'humanVerified')} ${oneMarkControl(kind, id, record, 'addedToFamilySearch')}`;
}

function suggestionKey(target) {
  return [target.targetType, target.targetId, target.field || ''].join('|');
}

function correctionHistoryHtml(record) {
  const items = Array.isArray(record?.corrections) ? record.corrections : [];
  if (!items.length) return '';
  const applied = items.some((item) => item.status === 'applied');
  const rows = items.map((item) => `
    <li>
      <span class="badge ${item.status === 'applied' ? 'corrected' : 'declined'}">${item.status === 'applied' ? 'Corrected' : 'Declined'}</span>
      ${esc(item.date)} · ${esc(item.by)} · ${esc(item.kind)}
      ${item.resolution ? `<span class="muted">${esc(item.resolution)}</span>` : ''}
    </li>`).join('');
  return `
    <div class="correction-history">
      ${applied ? '<span class="badge corrected">Corrected</span>' : ''}
      <ul class="plain">${rows}</ul>
    </div>`;
}

function suggestControls(target) {
  const key = suggestionKey(target);
  const open = ui.openSuggest && ui.openSuggest.key === key;
  if (!open) {
    const person = target.personId ? ` data-person-id="${esc(target.personId)}"` : '';
    const field = target.field ? ` data-field="${esc(target.field)}"` : '';
    return `<button type="button" class="btn btn-small" data-action="open-suggest" data-suggest-key="${esc(key)}" data-target-type="${esc(target.targetType)}" data-target-id="${esc(target.targetId)}"${person}${field}>Suggest correction</button>`;
  }
  const kinds = SUGGESTION_KINDS.map((kind) => `<option value="${esc(kind)}">${esc(kind)}</option>`).join('');
  return `
    <form class="verify-form suggest-form" data-target-type="${esc(target.targetType)}" data-target-id="${esc(target.targetId)}" data-person-id="${esc(target.personId || '')}" data-field="${esc(target.field || '')}">
      <label>Kind <select name="kind">${kinds}</select></label>
      <label>Comment <textarea name="comment" required placeholder="What should we change or add?"></textarea></label>
      <label>Suggested value <input name="suggestedValue" placeholder="Optional"></label>
      <label>Your name <input name="by" required value="${esc(verifierName())}" autocomplete="name"></label>
      <div class="btn-row">
        <button type="submit" class="btn btn-small btn-primary">Save</button>
        <button type="button" class="btn btn-small btn-ghost" data-action="cancel-suggest">Cancel</button>
      </div>
    </form>`;
}

function howItWorksHtml(collapsible) {
  const body = `
    <p>Mark verified, Added to FamilySearch, and suggestions are saved only in this browser until you submit them. Nobody else can see them yet.</p>
    <p>Submit opens a prefilled GitHub issue. Create that issue there — you need a GitHub account. Those items then move to Submitted, so the next issue includes only new ones.</p>
    <p>The family-history maintainer applies the issue in the next revision and closes it. The change then shows on the site for everyone, and the matching items leave your submitted list. If the issue was never created, use Resubmit. Clear drops them from this browser.</p>`;
  if (collapsible) {
    return `<details class="how-it-works excluded"><summary>How verifying and corrections work</summary>${body}</details>`;
  }
  return `<section class="how-it-works panel"><h2>How verifying and corrections work</h2>${body}</section>`;
}

function focusOpenForm() {
  const comment = document.querySelector('.suggest-form textarea[name="comment"]');
  if (comment) {
    comment.focus();
    return;
  }
  document.querySelector('.verify-form input[name="by"]')?.focus();
}

function filterButtons(action, currentFilter) {
  const options = [
    ['all', 'All'],
    ['verified', 'Human-verified'],
    ['unverified', 'Not yet verified'],
  ];
  return `<div class="segment" role="group" aria-label="Human verification filter">${options.map(([key, label]) => `
    <button type="button" class="${currentFilter === key ? 'is-on' : ''}" aria-pressed="${currentFilter === key}" data-action="${action}" data-filter="${key}">${label}</button>`).join('')}</div>`;
}

function bindThumbs(root) {
  (root || document).querySelectorAll('img.thumb').forEach((img) => {
    img.addEventListener('error', () => {
      const wrap = document.createElement('p');
      wrap.className = 'thumb-fallback';
      wrap.textContent = 'Thumbnail failed to load.';
      if (img.dataset.full) {
        const link = document.createElement('a');
        link.href = img.dataset.full;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'Open record image';
        wrap.append(document.createTextNode(' '), link);
      }
      img.replaceWith(wrap);
    });
  });
}

function bindCarousels(root) {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  root.querySelectorAll('[data-carousel]').forEach((carousel) => {
    const track = carousel.querySelector('.carousel-track');
    const scrollByDir = (dir) => {
      const amount = Math.max(220, track.clientWidth * 0.85) * dir;
      track.scrollBy({ left: amount, behavior: reduce ? 'auto' : 'smooth' });
    };
    carousel.querySelectorAll('[data-carousel-dir]').forEach((button) => {
      button.addEventListener('click', () => scrollByDir(Number(button.dataset.carouselDir)));
    });
    track.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        scrollByDir(1);
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        scrollByDir(-1);
      }
    });
  });
}

function sourceTitleHtml(source) {
  if (source.url) {
    return `<a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.title)}</a>`;
  }
  return `<a href="${sourceHref(source.id)}">${esc(source.title)}</a>`;
}

function sourceCard(source, { personId = null, candidate = false, onDetail = false } = {}) {
  const people = (source.personIds || []).map((id) => personLink(id)).join(', ') || '<span class="muted">None</span>';
  const image = source.imageUrl || source.thumbUrl || '';
  const thumb = source.thumbUrl || source.imageUrl || '';
  const figure = thumb
    ? `<a class="thumb-link" href="${esc(image || source.url || thumb)}" target="_blank" rel="noopener noreferrer">
        <img class="thumb" src="${esc(thumb)}" alt="Thumbnail of ${esc(source.title)}" data-full="${esc(image || thumb)}" loading="lazy" decoding="async">
      </a>`
    : '<p class="thumb-fallback">No record image linked.</p>';
  const urlButton = source.url
    ? `<button type="button" class="btn btn-small btn-ghost" data-action="copy" data-copy="url" data-source="${esc(source.id)}">Copy URL</button>`
    : '';
  const details = onDetail ? '' : `<a class="btn btn-small" href="${sourceHref(source.id)}">Details</a>`;
  const alts = (source.altUrls || []).map((url, index) =>
    `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Alternate link ${index + 1}</a>`).join(' · ');
  const checklist = personId
    ? `<label class="check"><input type="checkbox" data-action="fs" data-person="${esc(personId)}" data-source="${esc(source.id)}" ${isAttached(personId, source.id) ? 'checked' : ''} title="Private checklist for this person. It stays on this computer and is not submitted."> Added on FamilySearch</label>`
    : '';
  const candidateNote = candidate ? '<p class="warn">Candidate only — not confirmed for this person.</p>' : '';
  return `
    <article class="source-card" id="source-${esc(source.id)}">
      <div class="source-body">
        ${candidateNote}
        <p class="kicker">${esc(source.type || 'Source')} · ${esc(source.id)}</p>
        <h3>${sourceTitleHtml(source)}</h3>
        <p class="meta-line">${esc([source.date, source.place, source.repository].filter(Boolean).join(' · '))}</p>
        <div class="badge-row">${recordBadges(source, 'source', source.id)}</div>
        ${correctionHistoryHtml(source)}
        <div class="verify-slot">${verifyControls('source', source.id, source)} ${suggestControls({ targetType: 'source', targetId: source.id, personId: personId || '' })}</div>
        <h4>Transcription</h4>
        <p class="transcription">${esc(source.transcription || 'No transcription')}</p>
        <div class="btn-row">
          <button type="button" class="btn btn-small btn-primary" data-action="copy" data-copy="citation" data-source="${esc(source.id)}">Copy citation</button>
          <button type="button" class="btn btn-small" data-action="copy" data-copy="title" data-source="${esc(source.id)}">Copy title</button>
          ${urlButton}
          ${details}
        </div>
        ${alts ? `<p class="meta-line">${alts}</p>` : ''}
        <p class="meta-line"><span class="muted">People:</span> ${people}</p>
        ${checklist}
      </div>
      <div class="source-figure">${figure}</div>
    </article>`;
}

function noteArticle(person, note) {
  const sources = (note.sourceIds || []).map((id) => {
    const source = findSource(id);
    const label = source?.id || id;
    return `<a href="${sourceHref(source?.id || id)}">${esc(label)}</a>`;
  }).join(', ');
  const target = { targetType: 'note', targetId: note.id, personId: person.id };
  const open = ui.openSuggest && ui.openSuggest.key === suggestionKey(target);
  return `
    <article class="note" id="note-${esc(note.id)}">
      <header class="note-head">
        <time datetime="${esc(note.date)}">${esc(note.date)}</time>
        ${statusBadge(note.status)}
        ${recordBadges(note, 'note', note.id)}
        ${verifyControls('note', note.id, note)}
        ${open ? '' : suggestControls(target)}
      </header>
      ${correctionHistoryHtml(note)}
      <p>${linkify(note.text)}</p>
      ${open ? suggestControls(target) : ''}
      ${sources ? `<p class="meta-line"><span class="muted">Sources:</span> ${sources}</p>` : ''}
    </article>`;
}

function notesHtml(person) {
  const notes = person.notes.filter((note) => passesVerifyFilter(ui.verifyFilter, note, 'note', note.id));
  if (!notes.length) return '<p class="empty">No notes in this filter.</p>';
  return notes.map((note) => noteArticle(person, note)).join('');
}

function fsProgressHtml(person) {
  const { confirmed } = sourcesForPerson(INDEX, person.id);
  const attached = confirmed.filter((source) => isAttached(person.id, source.id)).length;
  return `Checked off: ${attached} of ${confirmed.length}.`;
}

function unattachedLabel() {
  return ui.onlyUnattached ? 'Showing records not checked off' : 'Show records not checked off';
}

function personSourcesHtml(person) {
  const { confirmed, candidate } = sourcesForPerson(INDEX, person.id);
  const confirmedHtml = confirmed
    .filter((source) => passesVerifyFilter(ui.verifyFilter, source, 'source', source.id))
    .filter((source) => !ui.onlyUnattached || !isAttached(person.id, source.id))
    .map((source) => sourceCard(source, { personId: person.id }));
  const candidateHtml = candidate
    .filter((source) => passesVerifyFilter(ui.verifyFilter, source, 'source', source.id))
    .filter((source) => !ui.onlyUnattached || !isAttached(person.id, source.id))
    .map((source) => sourceCard(source, { personId: person.id, candidate: true }));
  if (!confirmedHtml.length && !candidateHtml.length) return '<p class="empty">No sources in this filter.</p>';
  return confirmedHtml.join('') + candidateHtml.join('');
}

function familyHtml(person) {
  const parentBits = (person.parentLinks || []).map((link) =>
    `<div class="rel">${personLink(link.id)} ${statusBadge(link.status)} ${familyLink(link.familyId)}</div>`);
  const parents = parentBits.length ? parentBits.join('') : '<p class="muted">None recorded</p>';
  const spouseBits = (person.spouses || []).map((id) => {
    const family = INDEX.data.families.find((item) =>
      (item.husband === person.id && item.wife === id) || (item.wife === person.id && item.husband === id));
    const marriage = family?.marriage;
    const when = marriage && (marriage.date || marriage.place)
      ? `<p class="meta-line">${esc([marriage.date, marriage.place].filter(Boolean).join(' · '))} ${statusBadge(marriage.quality)}</p>`
      : '';
    const notes = (family?.notes || []).map((note) => `<p class="family-note">${linkify(note)}</p>`).join('');
    return `<div class="rel">${personLink(id)} ${family ? statusBadge(family.coupleStatus) : ''} ${family ? familyLink(family.id) : ''}${when}${notes}</div>`;
  });
  const spouses = spouseBits.length ? spouseBits.join('') : '<p class="muted">None recorded</p>';
  const childItems = [];
  const familyLinks = [];
  for (const family of INDEX.data.families) {
    if (family.husband !== person.id && family.wife !== person.id) continue;
    familyLinks.push(familyLink(family.id));
    for (const childId of family.children || []) {
      const link = (family.childLinks || []).find((item) => item.id === childId);
      const child = INDEX.peopleById[childId];
      childItems.push(`<li>${personLink(childId)} ${statusBadge(link?.status || 'unknown')} <span class="muted">${esc(child ? lifeSpan(child) : '')}</span></li>`);
    }
  }
  const children = childItems.length ? `<ul class="child-list">${childItems.join('')}</ul>` : '<p class="muted">None recorded</p>';
  return `
    <section>
      <h2>Parents</h2>
      ${parents}
    </section>
    <section>
      <h2>Spouses</h2>
      ${spouses}
    </section>
    <section>
      <h2>Children</h2>
      ${familyLinks.length ? `<p class="meta-line">${familyLinks.join(' · ')}</p>` : ''}
      ${children}
    </section>`;
}

function timelineHtml(person) {
  const items = timelineOf(INDEX, person);
  if (!items.length) return '<p class="empty">No dated events.</p>';
  return `<ol class="timeline">${items.map((item) => `
    <li>
      <span class="when">${esc(item.date || 'Date unknown')}</span>
      <div>
        <strong>${esc(cap(item.kind))}</strong>
        ${statusBadge(item.quality)}
        ${item.place ? `<span class="meta-line">${esc(item.place)}</span>` : ''}
        ${item.details ? `<p>${esc(item.details)}</p>` : ''}
        ${item.targetId ? suggestControls({ targetType: 'event', targetId: item.targetId, personId: person.id, field: item.field || item.kind }) : ''}
      </div>
    </li>`).join('')}</ol>`;
}

function leadsHtml(personId) {
  const leads = INDEX.leadsByPerson.get(personId) || [];
  if (!leads.length) return '<p class="empty">No open leads mention this person.</p>';
  return leads.map((lead) => `
    <article class="lead">
      <h3>${esc(lead.title)} ${statusBadge(lead.status)}</h3>
      <p>${esc(lead.detail)}</p>
    </article>`).join('');
}

function excludedHtml(personId) {
  const items = INDEX.excludedByPerson.get(personId) || [];
  if (!items.length) return '';
  return `
    <details class="excluded">
      <summary>Excluded candidates <span class="muted">${items.length}</span></summary>
      <ul class="plain">${items.map((item) => `
        <li>
          <strong>${esc(item.candidate)}</strong>
          <span class="muted">${esc(item.record || '')}</span>
          <p>${esc(item.reason)}</p>
        </li>`).join('')}</ul>
    </details>`;
}

function vitalBlock(label, vital, target) {
  if (!vital) return '';
  const date = vital.date || 'Unknown';
  const place = vital.place ? `<span class="meta-line">${esc(vital.place)}</span>` : '';
  const details = vital.details ? `<p>${esc(vital.details)}</p>` : '';
  return `
    <div class="vital">
      <h3>${label}</h3>
      <p>${esc(date)} ${statusBadge(vital.quality)}</p>
      ${place}
      ${details}
      ${target ? suggestControls(target) : ''}
    </div>`;
}

function vitalsHtml(person) {
  return `
    ${vitalBlock('Birth', person.birth, { targetType: 'event', targetId: `${person.id}:birth`, personId: person.id, field: 'birth' })}
    ${vitalBlock('Death', person.death, { targetType: 'event', targetId: `${person.id}:death`, personId: person.id, field: 'death' })}
  `;
}

function renderPerson(id) {
  const person = INDEX.peopleById[id];
  if (!person) return missing('person', id);
  const aka = (person.alsoKnownAs || []).length
    ? `<p class="meta-line">Also known as ${esc(person.alsoKnownAs.join(', '))}</p>`
    : '';
  const pid = person.familySearchPid
    ? `<a class="btn btn-small" href="https://www.familysearch.org/tree/person/details/${encodeURIComponent(person.familySearchPid)}" target="_blank" rel="noopener noreferrer">FamilySearch ${esc(person.familySearchPid)}</a>`
    : '';
  return `
    <article class="wrap person-page">
      ${crumbs([['#/', 'Home'], ['#/people', 'People'], [null, personName(person)]])}
      <header class="person-head">
        <div>
          <h1>${esc(personName(person))}</h1>
          ${aka}
          <p class="badge-row">${esc(person.sex === 'F' ? 'Female' : 'Male')} ${livingBadge(person)} <span class="muted">${esc(person.line || '')}</span></p>
        </div>
        <div class="btn-row">
          ${pid}
          <a class="btn btn-small btn-primary" href="${treeHref(person.id, { ancestors: true, depth: treeDepth() })}">Show in tree</a>
        </div>
      </header>
      <div class="person-layout">
        <div class="person-main">
          <section class="panel">
            <h2>Vitals</h2>
            <div class="vitals" id="vitals-mount">
              ${vitalsHtml(person)}
            </div>
          </section>
          <section class="panel">${familyHtml(person)}</section>
          <section class="panel">
            <h2>Timeline</h2>
            <div id="timeline-mount">${timelineHtml(person)}</div>
          </section>
        </div>
        <div class="person-side">
          <section class="panel">
            <div class="section-head">
              <h2>Research notes</h2>
              <div id="person-filter">${filterButtons('person-verify', ui.verifyFilter)}</div>
            </div>
            <p class="hint">This filter applies to notes and sources. The coloured label is how sure the research is. Human-verified is a separate check.</p>
            <div id="notes-mount">${notesHtml(person)}</div>
            <h2>Research leads</h2>
            ${leadsHtml(person.id)}
            ${excludedHtml(person.id)}
          </section>
        </div>
        <section class="panel person-sources">
          <div class="section-head">
            <h2>Sources</h2>
            <button type="button" class="btn btn-small ${ui.onlyUnattached ? 'btn-primary' : ''}" data-action="toggle-unattached">${unattachedLabel()}</button>
          </div>
          <p class="hint" id="fs-progress">${fsProgressHtml(person)}</p>
          <div id="sources-mount">${personSourcesHtml(person)}</div>
        </section>
      </div>
    </article>`;
}

function searchResultsHtml(query) {
  const result = searchAll(INDEX, query);
  if (!fold(query).trim()) return '';
  const people = result.people.map((person) => `
    <li><a href="${personHref(person.id)}"><strong>${esc(personName(person))}</strong> <span class="muted">${esc(lifeSpan(person))} · ${esc(person.line || '')}</span></a></li>`).join('');
  const sources = result.sources.map((source) => `
    <li><a href="${source.url ? esc(source.url) : sourceHref(source.id)}" ${source.url ? 'target="_blank" rel="noopener noreferrer"' : ''}><strong>${esc(source.title)}</strong> <span class="muted">${esc(source.date || source.type || '')}</span></a></li>`).join('');
  return `
    <div class="split">
      <section>
        <h2>People <span class="muted">${result.peopleTotal}</span></h2>
        ${people ? `<ul class="results">${people}</ul>` : '<p class="empty">No people</p>'}
        ${result.peopleTotal > result.people.length ? `<p class="hint"><a href="#/people">Browse all people</a></p>` : ''}
      </section>
      <section>
        <h2>Sources <span class="muted">${result.sourcesTotal}</span></h2>
        ${sources ? `<ul class="results">${sources}</ul>` : '<p class="empty">No sources</p>'}
      </section>
    </div>`;
}

function verificationRow(entry) {
  const noteRow = entry.kind === 'note' ? INDEX.notesById.get(entry.id) : null;
  const href = noteRow
    ? `${personHref(noteRow.person.id)}?note=${encodeURIComponent(entry.id)}`
    : sourceHref(findSource(entry.id)?.id || entry.id);
  return `
    <li>
      <strong>${entry.action === 'addedToFamilySearch' ? 'Added to FamilySearch' : 'Human-verified'}</strong>
      <span class="muted">${entry.kind === 'note' ? 'Note' : 'Source'}</span>
      <a href="${href}">${esc(entry.label || entry.id)}</a>
      <span>${esc(entry.by)} · ${esc(entry.date)}${entry.comment ? ` · ${esc(entry.comment)}` : ''}</span>
      <button type="button" class="btn btn-small btn-ghost" data-action="clear-verify" data-kind="${esc(entry.kind)}" data-id="${esc(entry.id)}" data-mark="${esc(entry.action || 'humanVerified')}">Remove</button>
    </li>`;
}

function suggestionRow(entry) {
  const bits = [entry.targetType, entry.targetId, entry.field].filter(Boolean).join(' · ');
  return `
    <li>
      <strong>${esc(entry.kind)}</strong>
      <span class="muted">${esc(bits)}</span>
      <span>${esc(entry.comment)}</span>
      ${entry.suggestedValue ? `<span class="muted">Suggested: ${esc(entry.suggestedValue)}</span>` : ''}
      <span>${esc(entry.by)} · ${esc(entry.date)}</span>
      <button type="button" class="btn btn-small btn-ghost" data-action="clear-suggestion" data-id="${esc(entry.id)}">Remove</button>
    </li>`;
}

function groupByBatch(entries) {
  const groups = [];
  const map = new Map();
  for (const entry of entries) {
    const key = batchKey(entry);
    let group = map.get(key);
    if (!group) {
      group = { key, date: entry.submitted || '', entries: [] };
      map.set(key, group);
      groups.push(group);
    }
    group.entries.push(entry);
  }
  return groups.reverse();
}

function submittedFold(kind, entries, rowHtml) {
  if (!entries.length) return '';
  const groups = groupByBatch(entries).map((group) => `
    <div class="submit-batch">
      <div class="section-head">
        <p class="hint">Submitted ${esc(group.date || 'earlier')}</p>
        <button type="button" class="btn btn-small" data-action="resubmit-${kind}" data-batch="${esc(group.key)}">Resubmit</button>
      </div>
      <ul class="pending-list">${group.entries.map(rowHtml).join('')}</ul>
    </div>`).join('');
  const open = ui.openSubmitted === kind ? ' open' : '';
  return `
    <details class="submitted-fold"${open}>
      <summary>Submitted, awaiting maintainer <span class="muted">${entries.length}</span></summary>
      <p class="hint">Waiting on the maintainer. Resubmit a batch if that GitHub issue was never created. Clear drops the whole list from this browser. Applied items disappear on their own.</p>
      <div class="btn-row">
        <button type="button" class="btn btn-small btn-ghost" data-action="clear-submitted-${kind}">Clear</button>
      </div>
      ${groups}
    </details>`;
}

function pendingPanel() {
  const entries = pendingEntries(INDEX);
  const rows = entries.map(verificationRow).join('');
  return `
    <section class="panel pending-panel" id="pending-panel">
      <div class="section-head">
        <h2>Verified and FamilySearch <span class="muted">${entries.length}</span></h2>
        <div class="btn-row">
          <button type="button" class="btn btn-small btn-primary" data-action="open-issue" ${entries.length ? '' : 'disabled'}>Submit</button>
          <button type="button" class="btn btn-small" data-action="copy-json" ${entries.length ? '' : 'disabled'}>Copy list</button>
        </div>
      </div>
      <p class="hint">Not submitted yet. Submit sends only these verifications and FamilySearch marks.</p>
      ${entries.length ? `<ul class="pending-list">${rows}</ul>` : '<p class="empty">No saved verifications or FamilySearch marks.</p>'}
      ${submittedFold('verifications', submittedEntries(INDEX), verificationRow)}
    </section>`;
}

function noteCard(note, person) {
  return `
    <article class="note carousel-card">
      <p class="kicker">${esc(note.date)} · ${esc(cap(note.status))}</p>
      <h3><a href="${personHref(person.id)}?note=${encodeURIComponent(note.id)}">${esc(personName(person))}</a></h3>
      ${recordBadges(note, 'note', note.id)}
      <p class="clamp">${linkify(note.text)}</p>
    </article>`;
}

function leadCard(lead) {
  const personId = (lead.personIds || [])[0];
  const href = personId ? personHref(personId) : '#/leads';
  return `
    <article class="lead carousel-card">
      <p class="kicker">${esc(cap(lead.status || 'open'))}</p>
      <h3><a href="${href}">${esc(lead.title)}</a></h3>
      <p class="clamp">${esc(lead.detail)}</p>
    </article>`;
}

function sourceQueueCard(source) {
  return `
    <article class="note carousel-card">
      <p class="kicker">Source${source.type ? ` · ${esc(source.type)}` : ''}</p>
      <h3>${sourceTitleHtml(source)}</h3>
      <p class="clamp">${esc([source.date, source.place].filter(Boolean).join(' · '))}</p>
      <p><a href="${sourceHref(source.id)}">Details</a></p>
    </article>`;
}

function carouselHtml(id, title, viewHref, cards, empty) {
  return `
    <section class="band panel" id="${id}">
      <div class="section-head">
        <h2>${esc(title)}</h2>
        <a class="more" href="${viewHref}">View all →</a>
      </div>
      <div class="carousel" data-carousel>
        <button type="button" class="carousel-btn" data-carousel-dir="-1" aria-label="Scroll ${esc(title)} backward">‹</button>
        <div class="carousel-track" tabindex="0" aria-label="${esc(title)}">
          ${cards || `<p class="empty">${esc(empty)}</p>`}
        </div>
        <button type="button" class="carousel-btn" data-carousel-dir="1" aria-label="Scroll ${esc(title)} forward">›</button>
      </div>
    </section>`;
}

function allNotes() {
  const rows = [];
  for (const { note, person } of INDEX.notesById.values()) rows.push({ note, person });
  rows.sort((a, b) => (b.note.date || '').localeCompare(a.note.date || '') || personName(a.person).localeCompare(personName(b.person)));
  return rows;
}

function unverifiedNotes() {
  return allNotes().filter(({ note }) => !effectiveVerification(note, 'note', note.id));
}

function unverifiedSources() {
  return INDEX.data.sources.filter((source) => !effectiveVerification(source, 'source', source.id));
}

function verificationQueue(limit = QUEUE_CAP) {
  const notes = unverifiedNotes();
  const sources = unverifiedSources();
  const sourceSlots = notes.length && sources.length ? Math.min(4, sources.length, Math.max(0, limit - 8)) : Math.min(sources.length, limit);
  const noteSlots = Math.min(notes.length, limit - (notes.length && sources.length ? sourceSlots : 0));
  return {
    notes: notes.slice(0, noteSlots),
    sources: sources.slice(0, limit - noteSlots),
  };
}

function renderHome() {
  const { data } = INDEX;
  const counts = verificationCounts(INDEX);
  const notes = recentNotes(INDEX, 24).map(({ note, person }) => noteCard(note, person)).join('');
  const leads = data.researchLeads.map((lead) => leadCard(lead)).join('');
  const queue = verificationQueue();
  const needs = queue.notes.map(({ note, person }) => noteCard(note, person)).join('')
    + queue.sources.map((source) => sourceQueueCard(source)).join('');
  const excluded = data.excluded.map((item) => `
    <li>
      <strong>${esc(item.candidate)}</strong>
      <span class="muted">${esc(item.record || '')}</span>
      <p>${esc(item.reason)}</p>
      <p class="meta-line">${(item.relatedPersonIds || []).map(personLink).join(', ')}</p>
    </li>`).join('');
  return `
    <div class="wrap">
      <header class="page-intro">
        <p class="kicker">Cenero · Porceyo · Gijón · Havana</p>
        <h1>${SITE}</h1>
        <p class="lede">Genealogy research notes for the Asturian lines and the Havana Bermúdez line.</p>
      </header>
      <div class="stats">
        <a class="stat" href="#/people"><span class="stat-value">${data.people.length}</span><span class="stat-label">People</span></a>
        <a class="stat" href="#/families"><span class="stat-value">${data.families.length}</span><span class="stat-label">Families</span></a>
        <a class="stat" href="#/sources"><span class="stat-value">${data.sources.length}</span><span class="stat-label">Sources</span></a>
        <a class="stat" href="#/?at=open-leads"><span class="stat-value">${data.researchLeads.length}</span><span class="stat-label">Open leads</span></a>
        <a class="stat" href="#/?at=recent-notes"><span class="stat-value">${counts.notesVerified}<span class="stat-of">/${counts.notesTotal}</span></span><span class="stat-label">Notes human-verified</span></a>
        <a class="stat" href="#/sources?verify=human"><span class="stat-value">${counts.sourcesVerified}<span class="stat-of">/${counts.sourcesTotal}</span></span><span class="stat-label">Sources human-verified</span></a>
      </div>
      <form class="search" role="search" onsubmit="return false">
        <label for="q">Search people and sources</label>
        <input id="q" type="search" placeholder="Try Valdes, Porceyo, Bermúdez" autocomplete="off">
      </form>
      <div id="search-results"></div>
      ${howItWorksHtml(true)}
      <div class="bands">
        ${carouselHtml('recent-notes', 'Recently updated notes', '#/notes', notes, 'No notes yet.')}
        ${carouselHtml('open-leads', 'Open research leads', '#/leads', leads, 'No open leads.')}
        ${carouselHtml('needs-verification', 'Needs verification', '#/unverified', needs, 'Nothing is waiting for a check.')}
      </div>
      <details class="excluded">
        <summary>Excluded candidates <span class="muted">${data.excluded.length} ruled out — do not re-check</span></summary>
        <ul class="plain">${excluded}</ul>
      </details>
    </div>`;
}

function comparePeople(a, b) {
  const { key, dir } = ui.peopleSort;
  const name = (person) => fold(personName(person));
  let av;
  let bv;
  if (key === 'birth') {
    av = a.birth?.date ? dateSortKey(a.birth.date) : null;
    bv = b.birth?.date ? dateSortKey(b.birth.date) : null;
  } else if (key === 'death') {
    av = a.death?.date ? dateSortKey(a.death.date) : null;
    bv = b.death?.date ? dateSortKey(b.death.date) : null;
  } else if (key === 'place') {
    av = birthplace(a);
    bv = birthplace(b);
    const aEmpty = !av;
    const bEmpty = !bv;
    if (aEmpty || bEmpty) {
      if (aEmpty && bEmpty) return name(a).localeCompare(name(b));
      return aEmpty ? 1 : -1;
    }
    const place = fold(av).localeCompare(fold(bv));
    return place ? place * dir : name(a).localeCompare(name(b));
  } else {
    const byName = name(a).localeCompare(name(b));
    return byName * dir;
  }
  if (av == null || bv == null) {
    if (av == null && bv == null) return name(a).localeCompare(name(b));
    return av == null ? 1 : -1;
  }
  if (av < bv) return -dir;
  if (av > bv) return dir;
  return name(a).localeCompare(name(b));
}

function sortHeader(key, label) {
  const on = ui.peopleSort.key === key;
  const mark = on ? (ui.peopleSort.dir > 0 ? ' ↑' : ' ↓') : '';
  const aria = on ? (ui.peopleSort.dir > 0 ? 'ascending' : 'descending') : 'none';
  return `<th aria-sort="${aria}"><button type="button" data-action="people-sort" data-key="${key}">${label}${mark}</button></th>`;
}

function peopleListHtml(query) {
  const needle = fold(query).trim();
  const people = INDEX.data.people.filter((person) => {
    if (ui.peopleLine !== 'all' && lineKey(person.line) !== ui.peopleLine) return false;
    if (!needle) return true;
    return fold([person.given, person.surnames, person.id, person.line, person.birth?.place, ...(person.alsoKnownAs || [])].join(' ')).includes(needle);
  }).sort(comparePeople);
  if (!people.length) return '<p class="empty">No people match.</p>';
  const rows = people.map((person) => `
    <tr>
      <td><a href="${personHref(person.id)}">${esc(personName(person))}</a> ${livingBadge(person)}</td>
      <td>${dash(person.birth?.date)}</td>
      <td>${dash(person.death?.date)}</td>
      <td>${dash(birthplace(person))}</td>
    </tr>`).join('');
  return `
    <p class="hint">${people.length} people</p>
    <div class="table-scroll">
      <table class="people-table">
        <thead>
          <tr>
            ${sortHeader('name', 'Name')}
            ${sortHeader('birth', 'Birth date')}
            ${sortHeader('death', 'Death date')}
            ${sortHeader('place', 'Birthplace')}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderPeople() {
  const chips = ['all', ...LINE_ROOTS.map(([name]) => name)].map((name) => `
    <button type="button" class="${ui.peopleLine === name ? 'is-on' : ''}" data-action="people-line" data-line="${esc(name)}">${name === 'all' ? 'All lines' : esc(name)}</button>`).join('');
  return `
    <div class="wrap">
      ${crumbs([['#/', 'Home'], [null, 'People']])}
      <h1>People</h1>
      <p class="lede">${INDEX.data.people.length} people. Search ignores accents, so Valdes finds Valdés.</p>
      <div class="segment wrap-segment">${chips}</div>
      <form class="search" role="search" onsubmit="return false">
        <label for="people-q">Filter</label>
        <input id="people-q" type="search" autocomplete="off">
      </form>
      <div id="people-mount">${peopleListHtml('')}</div>
    </div>`;
}

function renderFamilies() {
  const needle = fold(ui.familiesQuery).trim();
  const families = INDEX.data.families.filter((family) => {
    if (!needle) return true;
    const label = familyLabel(family);
    const kids = (family.children || []).map((id) => personName(INDEX.peopleById[id])).join(' ');
    return fold(`${family.id} ${label} ${kids}`).includes(needle);
  }).sort((a, b) => fold(familyLabel(a)).localeCompare(fold(familyLabel(b))));
  const rows = families.map((family) => `
    <li>
      <a href="${familyHref(family.id)}">
        <strong>${esc(familyLabel(family))}</strong>
        <span class="muted">${(family.children || []).length} ${(family.children || []).length === 1 ? 'child' : 'children'}</span>
      </a>
    </li>`).join('');
  return `
    <div class="wrap">
      ${crumbs([['#/', 'Home'], [null, 'Families']])}
      <h1>Families</h1>
      <p class="lede">${INDEX.data.families.length} families.</p>
      <form class="search" role="search" onsubmit="return false">
        <label for="families-q">Filter</label>
        <input id="families-q" type="search" autocomplete="off" value="${esc(ui.familiesQuery)}">
      </form>
      <div id="families-mount">
        <p class="hint">${families.length} families</p>
        ${rows ? `<ul class="family-list">${rows}</ul>` : '<p class="empty">No families match.</p>'}
      </div>
    </div>`;
}

function renderFamily(id) {
  const family = findFamily(id);
  if (!family) return missing('family', id);
  const label = familyLabel(family);
  const marriage = family.marriage || {};
  const children = (family.children || []).map((childId) => {
    const link = (family.childLinks || []).find((item) => item.id === childId);
    const child = INDEX.peopleById[childId];
    return `<li>${personLink(childId)} ${statusBadge(link?.status || 'unknown')} <span class="muted">${esc(child ? lifeSpan(child) : '')}</span></li>`;
  }).join('');
  const notes = (family.notes || []).map((note) => `<p>${linkify(note)}</p>`).join('') || '<p class="empty">No family notes.</p>';
  return `
    <div class="wrap">
      ${crumbs([['#/', 'Home'], ['#/families', 'Families'], [null, label]])}
      <h1>${esc(label)}</h1>
      <p class="badge-row">${statusBadge(family.coupleStatus)}</p>
      <div class="btn-row">${suggestControls({ targetType: 'family', targetId: family.id })}</div>
      <section class="panel">
        <h2>Couple</h2>
        <p>Husband: ${personLink(family.husband)}</p>
        <p>Wife: ${family.wife ? personLink(family.wife) : '<span class="muted">Unknown</span>'}</p>
        <p class="meta-line">${esc([marriage.date, marriage.place].filter(Boolean).join(' · ') || 'Marriage date unknown')} ${statusBadge(marriage.quality)}</p>
      </section>
      <section class="panel">
        <h2>Children</h2>
        ${children ? `<ul class="child-list">${children}</ul>` : '<p class="empty">No children recorded.</p>'}
      </section>
      <section class="panel">
        <h2>Notes</h2>
        ${notes}
      </section>
    </div>`;
}

function renderNotes() {
  const rows = allNotes().map(({ note, person }) => `
    <li class="note">
      <p class="kicker">${esc(note.date)} · ${esc(cap(note.status))}</p>
      <h3><a href="${personHref(person.id)}?note=${encodeURIComponent(note.id)}">${esc(personName(person))}</a></h3>
      ${recordBadges(note, 'note', note.id)}
      <p>${linkify(note.text)}</p>
    </li>`).join('');
  return `
    <div class="wrap">
      ${crumbs([['#/', 'Home'], [null, 'Notes']])}
      <h1>Notes</h1>
      <p class="lede">${allNotes().length} research notes, newest first.</p>
      <ul class="plain">${rows}</ul>
    </div>`;
}

function renderLeads() {
  const rows = INDEX.data.researchLeads.map((lead) => `
    <article class="lead">
      <h3>${esc(lead.title)} ${statusBadge(lead.status)}</h3>
      <p>${esc(lead.detail)}</p>
      <p class="meta-line">${(lead.personIds || []).length ? (lead.personIds || []).map(personLink).join(', ') : '<span class="muted">No person linked</span>'}</p>
    </article>`).join('');
  return `
    <div class="wrap">
      ${crumbs([['#/', 'Home'], [null, 'Open research leads']])}
      <h1>Open research leads</h1>
      ${rows || '<p class="empty">No open leads.</p>'}
    </div>`;
}

function renderUnverified() {
  const notes = unverifiedNotes().map(({ note, person }) => `
    <li class="note">
      <p class="kicker">${esc(note.date)} · ${esc(cap(note.status))}</p>
      <h3><a href="${personHref(person.id)}?note=${encodeURIComponent(note.id)}">${esc(personName(person))}</a></h3>
      <p>${linkify(note.text)}</p>
    </li>`).join('');
  const sources = unverifiedSources().map((source) => `
    <li>
      <h3>${sourceTitleHtml(source)}</h3>
      <p class="meta-line">${esc([source.date, source.place].filter(Boolean).join(' · '))}</p>
      <p><a href="${sourceHref(source.id)}">Details</a></p>
    </li>`).join('');
  return `
    <div class="wrap">
      ${crumbs([['#/', 'Home'], [null, 'Needs verification']])}
      <h1>Needs verification</h1>
      <p class="lede">Notes and sources that do not have a human-verified check yet.</p>
      <section>
        <h2>Notes <span class="muted">${unverifiedNotes().length}</span></h2>
        ${notes ? `<ul class="plain">${notes}</ul>` : '<p class="empty">Every note has been checked.</p>'}
      </section>
      <section>
        <h2>Sources <span class="muted">${unverifiedSources().length}</span></h2>
        ${sources ? `<ul class="plain">${sources}</ul>` : '<p class="empty">Every source has been checked.</p>'}
      </section>
    </div>`;
}

function sourceListHtml() {
  const needle = fold(document.getElementById('source-q')?.value || '').trim();
  const sources = [...INDEX.data.sources].filter((source) => {
    if (ui.sourceType !== 'all' && source.type !== ui.sourceType) return false;
    if (!passesVerifyFilter(ui.sourceVerify, source, 'source', source.id)) return false;
    if (!needle) return true;
    return fold([source.id, source.title, source.type, source.date, source.place, source.repository, source.transcription, source.citationText].join(' ')).includes(needle);
  }).sort((a, b) => {
    const yearA = yearOf(a.date);
    const yearB = yearOf(b.date);
    if (yearA && yearB && yearA !== yearB) return Number(yearA) - Number(yearB);
    if (!yearA) return 1;
    if (!yearB) return -1;
    return a.title.localeCompare(b.title);
  });
  if (!sources.length) return '<p class="empty">No sources in this filter.</p>';
  return `<p class="hint">${sources.length} sources</p>${sources.map((source) => sourceCard(source)).join('')}`;
}

function renderSources() {
  const types = [...new Set(INDEX.data.sources.map((source) => source.type).filter(Boolean))].sort();
  const options = ['<option value="all">All types</option>', ...types.map((type) =>
    `<option value="${esc(type)}" ${ui.sourceType === type ? 'selected' : ''}>${esc(type)}</option>`)].join('');
  return `
    <div class="wrap">
      ${crumbs([['#/', 'Home'], [null, 'Sources']])}
      <h1>Sources</h1>
      <p class="lede">Open a record, copy the citation, and tick it off on the person page once you have added it on FamilySearch.</p>
      <div class="toolbar">
        ${filterButtons('source-verify', ui.sourceVerify)}
        <label class="inline">Type <select id="source-type">${options}</select></label>
        <form class="search compact" role="search" onsubmit="return false">
          <label for="source-q">Search</label>
          <input id="source-q" type="search" autocomplete="off" placeholder="Title, place, transcription">
        </form>
      </div>
      <div id="source-mount">${sourceListHtml()}</div>
    </div>`;
}

function renderSource(id) {
  const source = findSource(id);
  if (!source) return missing('source', id);
  return `
    <div class="wrap">
      ${crumbs([['#/', 'Home'], ['#/sources', 'Sources'], [null, source.title]])}
      ${sourceCard(source, { onDetail: true })}
    </div>`;
}

function suggestionsPanel() {
  const entries = pendingSuggestions();
  const rows = entries.map(suggestionRow).join('');
  return `
    <section class="panel pending-panel" id="suggestions-panel">
      <div class="section-head">
        <h2>Suggestions <span class="muted">${entries.length}</span></h2>
        <div class="btn-row">
          <button type="button" class="btn btn-small btn-primary" data-action="submit-suggestions" ${entries.length ? '' : 'disabled'}>Submit</button>
          <button type="button" class="btn btn-small" data-action="copy-suggestions" ${entries.length ? '' : 'disabled'}>Copy list</button>
          <button type="button" class="btn btn-small btn-ghost" data-action="clear-suggestions" ${entries.length ? '' : 'disabled'}>Clear list</button>
        </div>
      </div>
      <p class="hint">Not submitted yet. Submit sends only this list.</p>
      ${entries.length ? `<ul class="pending-list">${rows}</ul>` : '<p class="empty">No saved suggestions.</p>'}
      ${submittedFold('suggestions', submittedSuggestions(), suggestionRow)}
    </section>`;
}

function renderPending() {
  return `
    <div class="wrap">
      ${crumbs([['#/', 'Home'], [null, 'Pending']])}
      <h1>Pending</h1>
      ${howItWorksHtml(false)}
      ${pendingPanel()}
      ${suggestionsPanel()}
    </div>`;
}

function renderTree(id) {
  const focusId = INDEX.peopleById[id] ? id : DEFAULT_ROOT;
  const depth = treeDepth();
  const ancestors = treeAncestors();
  const key = `${focusId}|${depth}|${ancestors}`;
  if (key !== lastTreeKey) {
    treeState.forcedOpen.clear();
    treeState.forcedClosed.clear();
    lastTreeKey = key;
  }
  const person = INDEX.peopleById[focusId];
  const chips = LINE_ROOTS.map(([name, root]) => `
    <button type="button" class="${lineKey(person.line) === name ? 'is-on' : ''}" data-action="tree-line" data-root="${esc(root)}">${esc(name)}</button>`).join('');
  return `
    <div class="tree-page">
      <div class="tree-toolbar">
        <div>
          ${crumbs([['#/', 'Home'], [null, 'Tree']])}
          <h1>${esc(personName(person))} Family Tree</h1>
        </div>
        <div class="segment wrap-segment" aria-label="Line">${chips}</div>
        <div class="toolbar-row">
          <div class="finder">
            <label for="tree-find">Go to a person</label>
            <input id="tree-find" type="search" placeholder="Name, accent optional" autocomplete="off">
            <ul id="tree-suggest" class="suggest" hidden></ul>
          </div>
          <div class="stepper" role="group" aria-labelledby="gen-label">
            <span id="gen-label">Generations shown</span>
            <button type="button" class="btn btn-small" data-action="tree-depth-step" data-delta="-1" aria-label="Show fewer generations" ${Number(depth) <= 1 ? 'disabled' : ''}>−</button>
            <span class="stepper-value" aria-live="polite">${esc(depth)}</span>
            <button type="button" class="btn btn-small" data-action="tree-depth-step" data-delta="1" aria-label="Show more generations" ${Number(depth) >= MAX_GEN ? 'disabled' : ''}>+</button>
          </div>
          <label class="check"><input id="ancestors-toggle" type="checkbox" ${ancestors ? 'checked' : ''}> Include ancestors</label>
          <p class="legend" aria-hidden="true"><span><i class="swatch verified"></i>Verified</span><span><i class="swatch probable"></i>Probable</span><span><i class="swatch proposed"></i>Proposed</span></p>
        </div>
      </div>
      <div id="tree-stage"></div>
      <div id="tree-dock" class="tree-dock"></div>
    </div>`;
}

function dockHtml(id) {
  const person = INDEX.peopleById[id];
  if (!person) return '';
  const parents = (person.parents || []).map(personLink).join(', ') || '<span class="muted">No parents recorded</span>';
  return `
    <div>
      <p class="kicker">${esc(person.line || '')}</p>
      <h2><a href="${personHref(person.id)}">${esc(personName(person))}</a></h2>
      <p>${esc(lifeSpan(person) || 'Dates unknown')} ${livingBadge(person)}</p>
      <p class="meta-line">Parents: ${parents}</p>
    </div>
    <div class="btn-row">
      <a class="btn btn-small btn-primary" href="${personHref(person.id)}">Open profile</a>
    </div>`;
}

function missing(kind, id) {
  return `<div class="wrap"><h1>Not found</h1><p>No ${esc(kind)} matches <code>${esc(id)}</code>.</p><p><a href="#/">Back home</a></p></div>`;
}

function updateChrome() {
  let name = current.name;
  if (name === 'person') name = 'people';
  if (name === 'source') name = 'sources';
  if (name === 'family') name = 'families';
  document.querySelectorAll('[data-nav]').forEach((link) => {
    if (link.dataset.nav === name) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  const count = pendingEntries(INDEX).length + pendingSuggestions().length;
  const pill = document.getElementById('pending-count');
  if (pill) {
    pill.textContent = String(count);
    pill.hidden = count === 0;
  }
  const footer = document.getElementById('footer');
  if (footer) footer.textContent = SITE;
}

function titles(route) {
  const person = INDEX.peopleById[route.id];
  if (route.name === 'home') return SITE;
  if (route.name === 'people') return `People · ${SITE}`;
  if (route.name === 'person') return `${personName(person) || 'Person'} · ${SITE}`;
  if (route.name === 'families') return `Families · ${SITE}`;
  if (route.name === 'family') return `${findFamily(route.id) ? familyLabel(findFamily(route.id)) : 'Family'} · ${SITE}`;
  if (route.name === 'sources') return `Sources · ${SITE}`;
  if (route.name === 'source') return `${findSource(route.id)?.title || 'Source'} · ${SITE}`;
  if (route.name === 'tree') return `${personName(person || INDEX.peopleById[DEFAULT_ROOT])} Family Tree · ${SITE}`;
  if (route.name === 'notes') return `Notes · ${SITE}`;
  if (route.name === 'leads') return `Open research leads · ${SITE}`;
  if (route.name === 'unverified') return `Needs verification · ${SITE}`;
  if (route.name === 'pending') return `Pending · ${SITE}`;
  return SITE;
}

function paint() {
  cleanup();
  cleanup = () => {};
  const route = current;
  document.title = titles(route);
  let html = '';
  if (route.name === 'home') html = renderHome();
  else if (route.name === 'people') html = renderPeople();
  else if (route.name === 'person') html = renderPerson(route.id);
  else if (route.name === 'families') html = renderFamilies();
  else if (route.name === 'family') html = renderFamily(route.id);
  else if (route.name === 'sources') html = renderSources();
  else if (route.name === 'source') html = renderSource(route.id);
  else if (route.name === 'tree') html = renderTree(route.id);
  else if (route.name === 'notes') html = renderNotes();
  else if (route.name === 'leads') html = renderLeads();
  else if (route.name === 'unverified') html = renderUnverified();
  else if (route.name === 'pending') html = renderPending();
  else html = missing('page', route.name);
  main().innerHTML = html;
  updateChrome();
  bindThumbs(main());
  bindCarousels(main());
  focusOpenForm();
  if (route.name === 'tree') {
    const focusId = INDEX.peopleById[route.id] ? route.id : DEFAULT_ROOT;
    const stage = document.getElementById('tree-stage');
    treeHandle = mountTree(stage, {
      peopleById: INDEX.peopleById,
      families: INDEX.data.families,
    }, {
      focusId,
      depth: treeDepth(),
      ancestors: treeAncestors(),
      forcedOpen: treeState.forcedOpen,
      forcedClosed: treeState.forcedClosed,
    }, {
      onOpen: (id) => {
        location.hash = personHref(id);
      },
      onSetRoot: (id) => goTree(id),
      onExpand: (id) => treeHandle?.expand(id),
    });
    const dock = document.getElementById('tree-dock');
    if (dock) dock.innerHTML = dockHtml(focusId);
    cleanup = () => {
      treeHandle?.destroy();
      treeHandle = null;
    };
  }
  if (route.name === 'person' && route.params.get('note')) {
    document.getElementById(`note-${route.params.get('note')}`)?.scrollIntoView({ block: 'center' });
  }
  if (route.name === 'home' && route.params.get('at')) {
    document.getElementById(route.params.get('at'))?.scrollIntoView({ block: 'start' });
  }
}

function parseRoute() {
  let raw = location.hash.replace(/^#/, '');
  if (!raw.startsWith('/')) raw = `/${raw}`;
  const queryAt = raw.indexOf('?');
  const params = new URLSearchParams(queryAt >= 0 ? raw.slice(queryAt + 1) : '');
  const path = (queryAt >= 0 ? raw.slice(0, queryAt) : raw).replace(/^\/+|\/+$/g, '');
  if (!path) return { name: 'home', id: '', params };
  const parts = path.split('/').filter(Boolean);
  let id = '';
  try {
    id = decodeURIComponent(parts[1] || '');
  } catch {
    id = parts[1] || '';
  }
  return { name: parts[0], id, params };
}

function goTree(id, overrides = {}) {
  const depth = overrides.depth ?? treeDepth();
  const ancestors = overrides.ancestors ?? treeAncestors();
  location.hash = treeHref(id, { depth, ancestors });
}

function refreshPeopleList() {
  const mount = document.getElementById('people-mount');
  if (mount) mount.innerHTML = peopleListHtml(document.getElementById('people-q')?.value || '');
}

function refreshVisible() {
  if (current.name === 'person' && document.getElementById('notes-mount')) {
    const person = INDEX.peopleById[current.id];
    if (!person) return paint();
    document.getElementById('notes-mount').innerHTML = notesHtml(person);
    const sources = document.getElementById('sources-mount');
    if (sources) {
      sources.innerHTML = personSourcesHtml(person);
      bindThumbs(sources);
    }
    const progress = document.getElementById('fs-progress');
    if (progress) progress.textContent = fsProgressHtml(person);
    const filter = document.getElementById('person-filter');
    if (filter) filter.innerHTML = filterButtons('person-verify', ui.verifyFilter);
    const toggle = document.querySelector('[data-action="toggle-unattached"]');
    if (toggle) {
      toggle.textContent = unattachedLabel();
      toggle.classList.toggle('btn-primary', ui.onlyUnattached);
    }
    const vitals = document.getElementById('vitals-mount');
    if (vitals) vitals.innerHTML = vitalsHtml(person);
    const timeline = document.getElementById('timeline-mount');
    if (timeline) timeline.innerHTML = timelineHtml(person);
    updateChrome();
    focusOpenForm();
    return;
  }
  if (current.name === 'sources' && document.getElementById('source-mount')) {
    document.getElementById('source-mount').innerHTML = sourceListHtml();
    bindThumbs(document.getElementById('source-mount'));
    document.querySelectorAll('[data-action="source-verify"]').forEach((button) => {
      const on = button.dataset.filter === ui.sourceVerify;
      button.classList.toggle('is-on', on);
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    updateChrome();
    focusOpenForm();
    return;
  }
  if (current.name === 'home' || current.name === 'pending' || current.name === 'source' || current.name === 'family' || current.name === 'unverified' || current.name === 'notes') paint();
  else updateChrome();
}

function onClick(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'copy') {
    const source = findSource(button.dataset.source);
    if (!source) return;
    const kind = button.dataset.copy;
    const text = kind === 'title' ? source.title : kind === 'url' ? source.url : source.citationText;
    if (!text) return;
    copyText(text, button);
    return;
  }
  if (action === 'open-verify') {
    ui.openSuggest = null;
    ui.openVerify = { kind: button.dataset.kind, id: button.dataset.id, mark: button.dataset.mark || 'humanVerified' };
    refreshVisible();
    return;
  }
  if (action === 'cancel-verify') {
    ui.openVerify = null;
    refreshVisible();
    return;
  }
  if (action === 'open-suggest') {
    ui.openVerify = null;
    ui.openSuggest = {
      key: button.dataset.suggestKey,
      targetType: button.dataset.targetType,
      targetId: button.dataset.targetId,
      personId: button.dataset.personId || '',
      field: button.dataset.field || '',
    };
    refreshVisible();
    return;
  }
  if (action === 'cancel-suggest') {
    ui.openSuggest = null;
    refreshVisible();
    return;
  }
  if (action === 'clear-suggestion') {
    removeSuggestion(button.dataset.id);
    refreshVisible();
    return;
  }
  if (action === 'clear-suggestions') {
    clearSuggestions();
    refreshVisible();
    return;
  }
  if (action === 'clear-verify') {
    if (button.dataset.mark === 'addedToFamilySearch') clearFamilySearch(button.dataset.kind, button.dataset.id);
    else clearLocal(button.dataset.kind, button.dataset.id);
    ui.openVerify = null;
    refreshVisible();
    return;
  }
  if (action === 'person-verify') {
    ui.verifyFilter = button.dataset.filter;
    refreshVisible();
    return;
  }
  if (action === 'source-verify') {
    ui.sourceVerify = button.dataset.filter;
    refreshVisible();
    return;
  }
  if (action === 'toggle-unattached') {
    ui.onlyUnattached = !ui.onlyUnattached;
    refreshVisible();
    return;
  }
  if (action === 'people-line') {
    ui.peopleLine = button.dataset.line;
    document.querySelectorAll('[data-action="people-line"]').forEach((chip) => {
      chip.classList.toggle('is-on', chip.dataset.line === ui.peopleLine);
    });
    refreshPeopleList();
    return;
  }
  if (action === 'people-sort') {
    const key = button.dataset.key;
    if (ui.peopleSort.key === key) ui.peopleSort.dir *= -1;
    else ui.peopleSort = { key, dir: 1 };
    refreshPeopleList();
    return;
  }
  if (action === 'tree-line') {
    goTree(button.dataset.root);
    return;
  }
  if (action === 'tree-depth-step') {
    const next = Math.min(MAX_GEN, Math.max(1, Number(treeDepth()) + Number(button.dataset.delta)));
    goTree(current.id || DEFAULT_ROOT, { depth: String(next) });
    return;
  }
  if (action === 'focus-person') {
    goTree(button.dataset.id);
    return;
  }
  if (action === 'open-issue') {
    const entries = pendingEntries(INDEX);
    if (!entries.length) return;
    const link = issueLink(entries);
    markVerificationsSubmitted(entries, todayISO(), newBatch());
    ui.openSubmitted = 'verifications';
    refreshVisible();
    openPreparedIssue(link, verificationPayload(entries), 'Human verifications', 'verification', 'The issue form is open. Create it on GitHub. These checks will not be included again.');
    return;
  }
  if (action === 'resubmit-verifications') {
    const entries = submittedEntries(INDEX).filter((entry) => batchKey(entry) === button.dataset.batch);
    if (!entries.length) return;
    const link = issueLink(entries);
    openPreparedIssue(link, verificationPayload(entries), 'Human verifications', 'verification', 'The issue form is open again. Create it on GitHub if the last one was never created.');
    return;
  }
  if (action === 'clear-submitted-verifications') {
    clearSubmittedVerifications();
    ui.openSubmitted = null;
    refreshVisible();
    return;
  }
  if (action === 'submit-suggestions') {
    const entries = pendingSuggestions();
    if (!entries.length) return;
    const link = suggestionIssueLink(entries);
    markSuggestionsSubmitted(entries.map((entry) => entry.id), todayISO(), newBatch());
    ui.openSubmitted = 'suggestions';
    refreshVisible();
    openPreparedIssue(link, suggestionPayload(entries), 'Corrections and notes', 'correction', 'The issue form is open. Create it on GitHub. These suggestions will not be included again.');
    return;
  }
  if (action === 'resubmit-suggestions') {
    const entries = submittedSuggestions().filter((entry) => batchKey(entry) === button.dataset.batch);
    if (!entries.length) return;
    const link = suggestionIssueLink(entries);
    openPreparedIssue(link, suggestionPayload(entries), 'Corrections and notes', 'correction', 'The issue form is open again. Create it on GitHub if the last one was never created.');
    return;
  }
  if (action === 'clear-submitted-suggestions') {
    clearSubmittedSuggestions();
    ui.openSubmitted = null;
    refreshVisible();
    return;
  }
  if (action === 'copy-suggestions') {
    copyText(JSON.stringify(suggestionPayload(pendingSuggestions()), null, 2), button);
    return;
  }
  if (action === 'copy-json') {
    const entries = pendingEntries(INDEX);
    copyText(JSON.stringify(verificationPayload(entries), null, 2), button);
  }
}

function onSubmit(event) {
  const suggest = event.target.closest?.('.suggest-form');
  if (suggest) {
    event.preventDefault();
    const data = new FormData(suggest);
    const by = String(data.get('by') || '').trim();
    const comment = String(data.get('comment') || '').trim();
    const kind = String(data.get('kind') || '');
    const suggestedValue = String(data.get('suggestedValue') || '');
    if (!by || !comment || !SUGGESTION_KINDS.includes(kind)) {
      setLive('Enter a comment and your name.');
      return;
    }
    addSuggestion({
      targetType: suggest.dataset.targetType,
      targetId: suggest.dataset.targetId,
      personId: suggest.dataset.personId || '',
      field: suggest.dataset.field || '',
      kind,
      comment,
      suggestedValue,
      by,
      date: todayISO(),
    });
    ui.openSuggest = null;
    refreshVisible();
    setLive('Saved in this browser. Open Pending to submit it.');
    return;
  }
  const form = event.target.closest?.('.verify-form');
  if (!form) return;
  event.preventDefault();
  const data = new FormData(form);
  const by = String(data.get('by') || '').trim();
  const date = String(data.get('date') || '');
  const comment = String(data.get('comment') || '');
  if (!by || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    setLive('Enter your name and a date.');
    return;
  }
  const fields = { by, date, comment };
  if (form.dataset.mark === 'addedToFamilySearch') markFamilySearch(form.dataset.kind, form.dataset.id, fields);
  else markLocal(form.dataset.kind, form.dataset.id, fields);
  ui.openVerify = null;
  refreshVisible();
  setLive('Saved in this browser. Open Pending to submit it.');
}

function onInput(event) {
  if (event.target.id === 'q') {
    const mount = document.getElementById('search-results');
    if (mount) mount.innerHTML = searchResultsHtml(event.target.value);
  }
  if (event.target.id === 'people-q') refreshPeopleList();
  if (event.target.id === 'families-q') {
    ui.familiesQuery = event.target.value;
    const caret = event.target.selectionStart;
    main().innerHTML = renderFamilies();
    const input = document.getElementById('families-q');
    input.focus();
    try {
      if (caret != null) input.setSelectionRange(caret, caret);
    } catch {
      /* Some browsers reject a caret on search inputs. */
    }
  }
  if (event.target.id === 'source-q') {
    const mount = document.getElementById('source-mount');
    if (mount) {
      mount.innerHTML = sourceListHtml();
      bindThumbs(mount);
    }
  }
  if (event.target.id === 'tree-find') {
    const list = document.getElementById('tree-suggest');
    if (!list) return;
    const result = searchAll(INDEX, event.target.value, 8);
    if (!fold(event.target.value).trim() || !result.people.length) {
      list.hidden = true;
      list.innerHTML = '';
      return;
    }
    list.hidden = false;
    list.innerHTML = result.people.map((person) => `
      <li><button type="button" data-action="focus-person" data-id="${esc(person.id)}">${esc(personName(person))} <span class="muted">${esc(yearOf(person.birth?.date))}</span></button></li>`).join('');
  }
}

function onChange(event) {
  if (event.target.dataset?.action === 'fs') {
    setAttached(event.target.dataset.person, event.target.dataset.source, event.target.checked);
    const person = INDEX.peopleById[current.id];
    const progress = document.getElementById('fs-progress');
    if (progress && person) progress.textContent = fsProgressHtml(person);
    if (ui.onlyUnattached) refreshVisible();
    return;
  }
  if (event.target.id === 'ancestors-toggle') {
    goTree(current.id || DEFAULT_ROOT, { ancestors: event.target.checked });
    return;
  }
  if (event.target.id === 'source-type') {
    ui.sourceType = event.target.value;
    const mount = document.getElementById('source-mount');
    if (mount) {
      mount.innerHTML = sourceListHtml();
      bindThumbs(mount);
    }
  }
}

function canonicalRedirect() {
  if (current.name === 'source') {
    const source = findSource(current.id);
    if (source && source.id !== current.id) {
      const params = current.params.toString();
      location.replace(`#/source/${encodeURIComponent(source.id)}${params ? `?${params}` : ''}`);
      return true;
    }
  }
  if (current.name === 'family') {
    const family = findFamily(current.id);
    if (family && family.id !== current.id) {
      location.replace(familyHref(family.id));
      return true;
    }
  }
  return false;
}

function route() {
  current = parseRoute();
  if (current.name === 'tree' && !current.id) {
    location.replace(treeHref(DEFAULT_ROOT));
    return;
  }
  if (canonicalRedirect()) return;
  if (current.name === 'sources') {
    const verify = current.params.get('verify');
    if (verify === 'human' || verify === 'verified') ui.sourceVerify = 'verified';
    else if (verify === 'unverified') ui.sourceVerify = 'unverified';
    else if (verify === 'all') ui.sourceVerify = 'all';
  }
  ui.openVerify = null;
  ui.openSuggest = null;
  ui.openSubmitted = null;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!reduce && !(current.name === 'home' && current.params.get('at'))) window.scrollTo(0, 0);
  paint();
}

async function start() {
  try {
    INDEX = await loadDataset();
  } catch (error) {
    main().innerHTML = `<div class="wrap"><h1>Could not load the family history</h1><p>${esc(error.message)}</p></div>`;
    return;
  }
  reconcileStore(INDEX);
  reconcileSuggestions(INDEX);
  document.addEventListener('click', onClick);
  document.addEventListener('submit', onSubmit);
  document.addEventListener('input', onInput);
  document.addEventListener('change', onChange);
  window.addEventListener('hashchange', route);
  route();
}

start();

import {
  DEFAULT_ROOT,
  LINE_ROOTS,
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
  clearLocal,
  effectiveVerification,
  isAttached,
  issueLink,
  markLocal,
  passesVerifyFilter,
  pendingEntries,
  reconcileStore,
  setAttached,
  todayISO,
  verificationCounts,
  verificationPayload,
  verifierName,
} from './verify.js';

const HUMAN_ICON = `<svg class="ico" viewBox="0 0 20 20" aria-hidden="true"><circle cx="7.2" cy="6.2" r="2.7" fill="currentColor"></circle><path d="M2.2 15.2c.5-2.4 2.5-3.7 5-3.7s4.5 1.3 5 3.7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path><path d="M12.6 8.4l1.5 1.5 3.2-3.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path></svg>`;

let INDEX = null;
let cleanup = () => {};
let current = { name: 'home', id: '', params: new URLSearchParams() };
const ui = {
  verifyFilter: 'all',
  onlyUnattached: false,
  openVerify: null,
  peopleLine: 'all',
  sourceType: 'all',
  sourceVerify: 'all',
};
const treeState = { forcedOpen: new Set(), forcedClosed: new Set() };
let treeHandle = null;
let lastTreeKey = '';

const main = () => document.getElementById('content');

function cap(value) {
  const text = String(value || 'unknown').replace(/-/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function statusBadge(status) {
  const value = status || 'unknown';
  return `<span class="badge ${esc(value)}">${esc(cap(value))}</span>`;
}

function humanBadge(verification) {
  if (!verification) return '';
  const bits = ['Human-verified', verification.date, verification.by].filter(Boolean);
  const title = verification.comment ? ` title="${esc(verification.comment)}"` : '';
  const pending = verification.origin === 'local' ? '<span class="pending-flag">pending commit</span>' : '';
  return `<span class="badge human"${title}>${HUMAN_ICON}<span>${esc(bits.join(' · '))}</span></span>${pending}`;
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

function treeHref(id, { depth = '3', ancestors = false } = {}) {
  const params = new URLSearchParams();
  if (depth && String(depth) !== '3') params.set('depth', String(depth));
  if (ancestors) params.set('ancestors', '1');
  const query = params.toString();
  return `#/tree/${encodeURIComponent(id)}${query ? `?${query}` : ''}`;
}

function setLive(message) {
  const live = document.getElementById('live');
  if (live) live.textContent = message;
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
  setLive('Copied to clipboard');
}

function verifyControls(kind, id, record) {
  const verification = effectiveVerification(record, kind, id);
  if (verification?.origin === 'data') return '';
  if (verification?.origin === 'local') {
    return `<button type="button" class="btn btn-small btn-ghost" data-action="clear-verify" data-kind="${esc(kind)}" data-id="${esc(id)}">Remove local mark</button>`;
  }
  const open = ui.openVerify && ui.openVerify.kind === kind && ui.openVerify.id === id;
  if (!open) {
    return `<button type="button" class="btn btn-small" data-action="open-verify" data-kind="${esc(kind)}" data-id="${esc(id)}">Mark verified</button>`;
  }
  return `
    <form class="verify-form" data-kind="${esc(kind)}" data-id="${esc(id)}">
      <label>By <input name="by" required value="${esc(verifierName())}" autocomplete="name"></label>
      <label>Date <input name="date" type="date" required value="${esc(todayISO())}"></label>
      <label>Comment <input name="comment" placeholder="Optional"></label>
      <button type="submit" class="btn btn-small btn-primary">Save</button>
      <button type="button" class="btn btn-small btn-ghost" data-action="cancel-verify">Cancel</button>
    </form>`;
}

function filterButtons(action, current) {
  const options = [
    ['all', 'All'],
    ['verified', 'Human-verified'],
    ['unverified', 'Not yet verified'],
  ];
  return `<div class="segment" role="group" aria-label="Human verification filter">${options.map(([key, label]) => `
    <button type="button" class="${current === key ? 'is-on' : ''}" aria-pressed="${current === key}" data-action="${action}" data-filter="${key}">${label}</button>`).join('')}</div>`;
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

function sourceCard(source, { personId = null, candidate = false } = {}) {
  const people = (source.personIds || []).map((id) => personLink(id)).join(', ') || '<span class="muted">None</span>';
  const image = source.imageUrl || source.thumbUrl || '';
  const thumb = source.thumbUrl || source.imageUrl || '';
  const figure = thumb
    ? `<a class="thumb-link" href="${esc(image || source.url || thumb)}" target="_blank" rel="noopener noreferrer">
        <img class="thumb" src="${esc(thumb)}" alt="Thumbnail of ${esc(source.title)}" data-full="${esc(image || thumb)}" loading="lazy" decoding="async">
      </a>`
    : '<p class="thumb-fallback">No record image linked.</p>';
  const urlButtons = source.url
    ? `<a class="btn btn-small" href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">Archive record</a>
       <button type="button" class="btn btn-small btn-ghost" data-action="copy" data-copy="url" data-source="${esc(source.id)}">Copy URL</button>`
    : '<span class="muted">No archive URL</span>';
  const alts = (source.altUrls || []).map((url, index) =>
    `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Alternate link ${index + 1}</a>`).join(' · ');
  const derived = source.urlDerived
    ? '<p class="warn">This URL was derived from the folder pattern, not copied verbatim. Check it before attaching.</p>'
    : '';
  const checklist = personId
    ? `<label class="check"><input type="checkbox" data-action="fs" data-person="${esc(personId)}" data-source="${esc(source.id)}" ${isAttached(personId, source.id) ? 'checked' : ''}> Added on FamilySearch</label>`
    : '';
  const candidateNote = candidate ? '<p class="warn">Candidate only — not confirmed for this person.</p>' : '';
  return `
    <article class="source-card" id="source-${esc(source.id)}">
      <div class="source-body">
        ${candidateNote}
        <p class="kicker">${esc(source.type || 'Source')} · ${esc(source.id)}</p>
        <h3><a href="${sourceHref(source.id)}">${esc(source.title)}</a></h3>
        <p class="meta-line">${esc([source.date, source.place, source.repository].filter(Boolean).join(' · '))}</p>
        <div class="badge-row">${humanBadge(effectiveVerification(source, 'source', source.id))}</div>
        <div class="verify-slot">${verifyControls('source', source.id, source)}</div>
        ${derived}
        <h4>Transcription</h4>
        <p class="transcription">${esc(source.transcription || 'No transcription')}</p>
        <div class="btn-row">
          <button type="button" class="btn btn-small btn-primary" data-action="copy" data-copy="citation" data-source="${esc(source.id)}">Copy citation</button>
          <button type="button" class="btn btn-small" data-action="copy" data-copy="title" data-source="${esc(source.id)}">Copy title</button>
          ${urlButtons}
        </div>
        ${alts ? `<p class="meta-line">${alts}</p>` : ''}
        <p class="meta-line"><span class="muted">People:</span> ${people}</p>
        ${checklist}
      </div>
      <div class="source-figure">${figure}</div>
    </article>`;
}

function noteArticle(person, note) {
  const sources = (note.sourceIds || []).map((id) => `<a href="${sourceHref(id)}">${esc(INDEX.sourcesById[id]?.id || id)}</a>`).join(', ');
  return `
    <article class="note" id="note-${esc(note.id)}">
      <header class="note-head">
        <time datetime="${esc(note.date)}">${esc(note.date)}</time>
        ${statusBadge(note.status)}
        ${humanBadge(effectiveVerification(note, 'note', note.id))}
        ${verifyControls('note', note.id, note)}
      </header>
      <p>${esc(note.text)}</p>
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
  return `Added on FamilySearch: ${attached} of ${confirmed.length}. The ticks stay in this browser.`;
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
    `<div class="rel">${personLink(link.id)} ${statusBadge(link.status)}</div>`);
  const parents = parentBits.length ? parentBits.join('') : '<p class="muted">None recorded</p>';
  const spouseBits = (person.spouses || []).map((id) => {
    const family = INDEX.data.families.find((item) =>
      (item.husband === person.id && item.wife === id) || (item.wife === person.id && item.husband === id));
    const marriage = family?.marriage;
    const when = marriage && (marriage.date || marriage.place)
      ? `<p class="meta-line">${esc([marriage.date, marriage.place].filter(Boolean).join(' · '))} ${statusBadge(marriage.quality)}</p>`
      : '';
    const notes = (family?.notes || []).map((note) => `<p class="family-note">${esc(note)}</p>`).join('');
    return `<div class="rel">${personLink(id)} ${family ? statusBadge(family.coupleStatus) : ''}${when}${notes}</div>`;
  });
  const spouses = spouseBits.length ? spouseBits.join('') : '<p class="muted">None recorded</p>';
  const childItems = [];
  for (const family of INDEX.data.families) {
    if (family.husband !== person.id && family.wife !== person.id) continue;
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

function vitalBlock(label, vital) {
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
    </div>`;
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
      <p class="kicker"><a href="#/people">People</a> · ${esc(person.line || '')}</p>
      <header class="person-head">
        <div>
          <h1>${esc(personName(person))}</h1>
          ${aka}
          <p class="badge-row">${esc(person.sex === 'F' ? 'Female' : 'Male')} ${livingBadge(person)} <span class="muted">${esc(person.id)}</span></p>
        </div>
        <div class="btn-row">
          ${pid}
          <a class="btn btn-small btn-primary" href="${treeHref(person.id, { ancestors: true, depth: currentTreeDepth() })}">Show in tree</a>
        </div>
      </header>
      <div class="person-layout">
        <div class="person-main">
          <section class="panel">
            <h2>Vitals</h2>
            <div class="vitals">
              ${vitalBlock('Birth', person.birth)}
              ${vitalBlock('Death', person.death)}
            </div>
          </section>
          <section class="panel">${familyHtml(person)}</section>
          <section class="panel">
            <h2>Timeline</h2>
            ${timelineHtml(person)}
          </section>
        </div>
        <div class="person-side">
          <section class="panel">
            <div class="section-head">
              <h2>Research notes</h2>
              <div id="person-filter">${filterButtons('person-verify', ui.verifyFilter)}</div>
            </div>
            <p class="hint">This filter applies to notes and sources. Coloured status is the research assessment. Human-verified is a separate mark, stored in this browser until it is committed to data.json.</p>
            <div id="notes-mount">${notesHtml(person)}</div>
            <h2>Research leads</h2>
            ${leadsHtml(person.id)}
            ${excludedHtml(person.id)}
          </section>
        </div>
        <section class="panel person-sources">
          <div class="section-head">
            <h2>Sources</h2>
            <button type="button" class="btn btn-small ${ui.onlyUnattached ? 'btn-primary' : ''}" data-action="toggle-unattached">${ui.onlyUnattached ? 'Showing sources not yet attached' : 'Show sources not yet attached'}</button>
          </div>
          <p class="hint" id="fs-progress">${fsProgressHtml(person)}</p>
          <div id="sources-mount">${personSourcesHtml(person)}</div>
        </section>
      </div>
    </article>`;
}

function currentTreeDepth() {
  return current.params?.get?.('depth') || '3';
}

function searchResultsHtml(query) {
  const result = searchAll(INDEX, query);
  if (!fold(query).trim()) return '';
  const people = result.people.map((person) => `
    <li><a href="${personHref(person.id)}"><strong>${esc(personName(person))}</strong> <span class="muted">${esc(lifeSpan(person))} · ${esc(person.line || '')}</span></a></li>`).join('');
  const sources = result.sources.map((source) => `
    <li><a href="${sourceHref(source.id)}"><strong>${esc(source.title)}</strong> <span class="muted">${esc(source.date || source.type || '')}</span></a></li>`).join('');
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

function pendingPanel() {
  const entries = pendingEntries(INDEX);
  const rows = entries.map((entry) => `
    <li>
      <strong>${entry.kind === 'note' ? 'Note' : 'Source'}</strong>
      <code>${esc(entry.id)}</code>
      <span class="muted">${esc(entry.label)}</span>
      <span>${esc(entry.by)} · ${esc(entry.date)}${entry.comment ? ` · ${esc(entry.comment)}` : ''}</span>
      <button type="button" class="btn btn-small btn-ghost" data-action="clear-verify" data-kind="${esc(entry.kind)}" data-id="${esc(entry.id)}">Remove</button>
    </li>`).join('');
  return `
    <section class="panel pending-panel" id="pending-panel">
      <div class="section-head">
        <h2>Pending verifications <span class="muted">${entries.length}</span></h2>
        <div class="btn-row">
          <button type="button" class="btn btn-small btn-primary" data-action="open-issue" ${entries.length ? '' : 'disabled'}>Open GitHub issue</button>
          <button type="button" class="btn btn-small" data-action="copy-json" ${entries.length ? '' : 'disabled'}>Copy JSON</button>
        </div>
      </div>
      <p class="hint">Marks live in this browser. The issue asks the research assistant to write <code>humanVerified</code> into data.json. After that commit, the saved field replaces the browser mark.</p>
      ${entries.length ? `<ul class="pending-list">${rows}</ul>` : '<p class="empty">No pending marks.</p>'}
    </section>`;
}

function renderHome() {
  const { data } = INDEX;
  const counts = verificationCounts(INDEX);
  const notes = recentNotes(INDEX, 8).map(({ note, person }) => `
    <li>
      <a href="${personHref(person.id)}?note=${encodeURIComponent(note.id)}"><strong>${esc(personName(person))}</strong></a>
      <span class="muted">${esc(note.date)}</span>
      ${statusBadge(note.status)}
      ${humanBadge(effectiveVerification(note, 'note', note.id))}
      <p class="clamp">${esc(note.text)}</p>
    </li>`).join('');
  const leads = data.researchLeads.map((lead) => `
    <article class="lead">
      <h3>${esc(lead.title)} ${statusBadge(lead.status)}</h3>
      <p>${esc(lead.detail)}</p>
      <p class="meta-line">${(lead.personIds || []).length ? (lead.personIds || []).map(personLink).join(', ') : '<span class="muted">No person linked</span>'}</p>
    </article>`).join('');
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
        <h1>${esc(data.meta.title)}</h1>
        <p class="lede">Research dashboard for the Asturian lines and the Havana Bermúdez line. Generated ${esc(data.meta.generated)}. Everything on this site is read from <code>data/data.json</code>.</p>
      </header>
      <div class="stats">
        <a class="stat" href="#/people"><span class="stat-value">${data.people.length}</span><span class="stat-label">People</span></a>
        <div class="stat"><span class="stat-value">${data.families.length}</span><span class="stat-label">Families</span></div>
        <a class="stat" href="#/sources"><span class="stat-value">${data.sources.length}</span><span class="stat-label">Sources</span></a>
        <button type="button" class="stat" data-action="jump" data-target="leads"><span class="stat-value">${data.researchLeads.length}</span><span class="stat-label">Open leads</span></button>
        <div class="stat"><span class="stat-value">${counts.notesVerified}<span class="stat-of">/${counts.notesTotal}</span></span><span class="stat-label">Notes human-verified</span></div>
        <div class="stat"><span class="stat-value">${counts.sourcesVerified}<span class="stat-of">/${counts.sourcesTotal}</span></span><span class="stat-label">Sources human-verified</span></div>
      </div>
      <p class="hint">Human-verified counts include marks saved in this browser until they are committed. Not yet verified: ${counts.notesTotal - counts.notesVerified} notes, ${counts.sourcesTotal - counts.sourcesVerified} sources.</p>
      <form class="search" role="search" onsubmit="return false">
        <label for="q">Search people and sources</label>
        <input id="q" type="search" placeholder="Try Valdes, Porceyo, Bermúdez" autocomplete="off">
      </form>
      <div id="search-results"></div>
      ${pendingPanel()}
      <div class="split">
        <section class="panel">
          <h2>Recently updated notes</h2>
          <ul class="note-list">${notes}</ul>
        </section>
        <section class="panel" id="leads">
          <h2>Open research leads</h2>
          ${leads}
        </section>
      </div>
      <details class="excluded">
        <summary>Excluded candidates <span class="muted">${data.excluded.length} ruled out — do not re-check</span></summary>
        <ul class="plain">${excluded}</ul>
      </details>
    </div>`;
}

function peopleListHtml(query) {
  const needle = fold(query).trim();
  const people = INDEX.data.people.filter((person) => {
    if (ui.peopleLine !== 'all' && lineKey(person.line) !== ui.peopleLine) return false;
    if (!needle) return true;
    return fold([person.given, person.surnames, person.id, person.line, ...(person.alsoKnownAs || [])].join(' ')).includes(needle);
  }).sort((a, b) => lineKey(a.line).localeCompare(lineKey(b.line)) || fold(personName(a)).localeCompare(fold(personName(b))));
  if (!people.length) return '<p class="empty">No people match.</p>';
  return `<p class="hint">${people.length} people</p><ul class="people-list">${people.map((person) => `
    <li>
      <a href="${personHref(person.id)}">
        <strong>${esc(personName(person))}</strong>
        <span>${esc(lifeSpan(person) || 'dates unknown')}</span>
        <span class="muted">${esc(person.line || '')}</span>
        ${livingBadge(person)}
      </a>
    </li>`).join('')}</ul>`;
}

function renderPeople() {
  const chips = ['all', ...LINE_ROOTS.map(([name]) => name)].map((name) => `
    <button type="button" class="${ui.peopleLine === name ? 'is-on' : ''}" data-action="people-line" data-line="${esc(name)}">${name === 'all' ? 'All lines' : esc(name)}</button>`).join('');
  return `
    <div class="wrap">
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

function sourceListHtml() {
  const needle = fold(document.getElementById('source-q')?.value || '').trim();
  const sources = [...INDEX.data.sources].filter((source) => {
    if (ui.sourceType !== 'all' && source.type !== ui.sourceType) return false;
    if (!passesVerifyFilter(ui.sourceVerify, source, 'source', source.id)) return false;
    if (!needle) return true;
    return fold([source.id, source.title, source.type, source.date, source.place, source.repository, source.transcription, source.citationText].join(' ')).includes(needle);
  }).sort((a, b) => {
    const year = yearOf(a.date).localeCompare(yearOf(b.date));
    if (year && yearOf(a.date) && yearOf(b.date)) return Number(yearOf(a.date)) - Number(yearOf(b.date));
    if (!yearOf(a.date)) return 1;
    if (!yearOf(b.date)) return -1;
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
      <h1>Sources</h1>
      <p class="lede">Citations are ready to paste into FamilySearch. Copy the citation, open the archive record, and tick sources on each person page as you attach them.</p>
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
  const source = INDEX.sourcesById[id];
  if (!source) return missing('source', id);
  return `
    <div class="wrap">
      <p class="kicker"><a href="#/sources">Sources</a></p>
      ${sourceCard(source)}
    </div>`;
}

function renderPending() {
  return `<div class="wrap"><h1>Pending verifications</h1>${pendingPanel()}</div>`;
}

function renderTree(id) {
  const focusId = INDEX.peopleById[id] ? id : DEFAULT_ROOT;
  const depth = current.params.get('depth') || '3';
  const ancestors = current.params.get('ancestors') === '1';
  const key = `${focusId}|${depth}|${ancestors}`;
  if (key !== lastTreeKey) {
    treeState.forcedOpen.clear();
    treeState.forcedClosed.clear();
    lastTreeKey = key;
  }
  const person = INDEX.peopleById[focusId];
  const depths = [['3', '3'], ['4', '4'], ['5', '5'], ['all', 'All']];
  const chips = LINE_ROOTS.map(([name, root]) => `
    <button type="button" class="${lineKey(person.line) === name ? 'is-on' : ''}" data-action="tree-line" data-root="${esc(root)}">${esc(name)}</button>`).join('');
  return `
    <div class="tree-page">
      <div class="tree-toolbar">
        <div>
          <p class="kicker">Tree</p>
          <h1>Descendants of ${esc(personName(person))}</h1>
        </div>
        <div class="segment wrap-segment" aria-label="Line">${chips}</div>
        <div class="toolbar-row">
          <div class="finder">
            <label for="tree-find">Go to a person</label>
            <input id="tree-find" type="search" placeholder="Name, accent optional" autocomplete="off">
            <ul id="tree-suggest" class="suggest" hidden></ul>
          </div>
          <div class="segment" aria-label="Generations shown">${depths.map(([value, label]) => `
            <button type="button" class="${String(depth) === value ? 'is-on' : ''}" data-action="tree-depth" data-depth="${value}">${label}</button>`).join('')}</div>
          <label class="check"><input id="ancestors-toggle" type="checkbox" ${ancestors ? 'checked' : ''}> Show ancestors</label>
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
      <button type="button" class="btn btn-small" data-action="focus-person" data-id="${esc(person.id)}">Make root</button>
    </div>`;
}

function missing(kind, id) {
  return `<div class="wrap"><h1>Not found</h1><p>No ${esc(kind)} with id <code>${esc(id)}</code>.</p><p><a href="#/">Back to the dashboard</a></p></div>`;
}

function updateChrome() {
  const name = current.name === 'person' ? 'people' : current.name === 'source' ? 'sources' : current.name;
  document.querySelectorAll('[data-nav]').forEach((link) => {
    if (link.dataset.nav === name) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  const count = pendingEntries(INDEX).length;
  const pill = document.getElementById('pending-count');
  if (pill) {
    pill.textContent = String(count);
    pill.hidden = count === 0;
  }
  const footer = document.getElementById('footer');
  if (footer) {
    const meta = INDEX.data.meta;
    footer.textContent = `${meta.title}. Data generated ${meta.generated}. The site renders from data/data.json only.`;
  }
}

function titles(route) {
  if (route.name === 'home') return 'Family history';
  if (route.name === 'people') return 'People · Family history';
  if (route.name === 'person') return `${personName(INDEX.peopleById[route.id]) || 'Person'} · Family history`;
  if (route.name === 'sources') return 'Sources · Family history';
  if (route.name === 'source') return `${INDEX.sourcesById[route.id]?.title || 'Source'} · Family history`;
  if (route.name === 'tree') return 'Tree · Family history';
  if (route.name === 'pending') return 'Pending verifications · Family history';
  return 'Family history';
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
  else if (route.name === 'sources') html = renderSources();
  else if (route.name === 'source') html = renderSource(route.id);
  else if (route.name === 'tree') html = renderTree(route.id);
  else if (route.name === 'pending') html = renderPending();
  else html = missing('page', route.name);
  main().innerHTML = html;
  updateChrome();
  bindThumbs(main());
  if (route.name === 'tree') {
    const focusId = INDEX.peopleById[route.id] ? route.id : DEFAULT_ROOT;
    const stage = document.getElementById('tree-stage');
    treeHandle = mountTree(stage, {
      peopleById: INDEX.peopleById,
      families: INDEX.data.families,
    }, {
      focusId,
      depth: route.params.get('depth') || '3',
      ancestors: route.params.get('ancestors') === '1',
      forcedOpen: treeState.forcedOpen,
      forcedClosed: treeState.forcedClosed,
    }, {
      onSelect: (id) => {
        const dock = document.getElementById('tree-dock');
        if (dock) dock.innerHTML = dockHtml(id);
      },
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
  const depth = overrides.depth ?? (current.params.get('depth') || '3');
  const ancestors = overrides.ancestors ?? (current.params.get('ancestors') === '1');
  location.hash = treeHref(id, { depth, ancestors });
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
      toggle.textContent = ui.onlyUnattached ? 'Showing sources not yet attached' : 'Show sources not yet attached';
      toggle.classList.toggle('btn-primary', ui.onlyUnattached);
    }
    updateChrome();
    document.querySelector('.verify-form input[name="by"]')?.focus();
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
    document.querySelector('.verify-form input[name="by"]')?.focus();
    return;
  }
  if (current.name === 'home' || current.name === 'pending' || current.name === 'source') paint();
  else updateChrome();
}

function onClick(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'jump') {
    document.getElementById(button.dataset.target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (action === 'copy') {
    const source = INDEX.sourcesById[button.dataset.source];
    if (!source) return;
    const kind = button.dataset.copy;
    const text = kind === 'title' ? source.title : kind === 'url' ? source.url : source.citationText;
    if (!text) return;
    copyText(text, button);
    return;
  }
  if (action === 'open-verify') {
    ui.openVerify = { kind: button.dataset.kind, id: button.dataset.id };
    refreshVisible();
    return;
  }
  if (action === 'cancel-verify') {
    ui.openVerify = null;
    refreshVisible();
    return;
  }
  if (action === 'clear-verify') {
    clearLocal(button.dataset.kind, button.dataset.id);
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
    const mount = document.getElementById('people-mount');
    if (mount) mount.innerHTML = peopleListHtml(document.getElementById('people-q')?.value || '');
    return;
  }
  if (action === 'tree-line') {
    goTree(button.dataset.root);
    return;
  }
  if (action === 'tree-depth') {
    goTree(current.id || DEFAULT_ROOT, { depth: button.dataset.depth });
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
    if (link.tooLong) {
      copyText(JSON.stringify(verificationPayload(entries), null, 2));
      setLive('The GitHub link was too long. JSON copied — paste it into the issue.');
      window.open(`https://github.com/kyzabee-sudo/family-history/issues/new?${new URLSearchParams({ title: 'Human verifications', labels: 'verification' })}`, '_blank', 'noopener');
      return;
    }
    window.open(link.url, '_blank', 'noopener');
    return;
  }
  if (action === 'copy-json') {
    const entries = pendingEntries(INDEX);
    copyText(JSON.stringify(verificationPayload(entries), null, 2), button);
  }
}

function onSubmit(event) {
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
  markLocal(form.dataset.kind, form.dataset.id, { by, date, comment });
  ui.openVerify = null;
  refreshVisible();
  setLive('Saved in this browser. Open the pending verifications panel to commit it.');
}

function onInput(event) {
  if (event.target.id === 'q') {
    const mount = document.getElementById('search-results');
    if (mount) mount.innerHTML = searchResultsHtml(event.target.value);
  }
  if (event.target.id === 'people-q') {
    const mount = document.getElementById('people-mount');
    if (mount) mount.innerHTML = peopleListHtml(event.target.value);
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

function route() {
  current = parseRoute();
  if (current.name === 'tree' && !current.id) {
    location.replace(treeHref(DEFAULT_ROOT));
    return;
  }
  ui.openVerify = null;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!reduce) window.scrollTo(0, 0);
  paint();
}

async function start() {
  try {
    INDEX = await loadDataset();
  } catch (error) {
    main().innerHTML = `<div class="wrap"><h1>Could not load the dataset</h1><p>${esc(error.message)}</p></div>`;
    return;
  }
  reconcileStore(INDEX);
  document.addEventListener('click', onClick);
  document.addEventListener('submit', onSubmit);
  document.addEventListener('input', onInput);
  document.addEventListener('change', onChange);
  window.addEventListener('hashchange', route);
  route();
}

start();

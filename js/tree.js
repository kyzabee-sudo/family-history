/** Descendant (and optional ancestor) layout plus pan/zoom rendering. */

import { lineColor, lineKey, personName, yearOf } from './model.js';

export const CARD_W = 176;
export const CARD_H = 78;
const COUPLE_GAP = 16;
const SIB_GAP = 20;
const GEN_GAP = 76;

const STATUS_STYLE = {
  verified: { dash: null, color: '#1d6b45' },
  probable: { dash: '9 6', color: '#9a6b12' },
  proposed: { dash: '1.5 5', color: '#2c5f8a' },
  neutral: { dash: null, color: '#8d8274' },
};

function spouseOf(people, id) {
  const spouses = people[id]?.spouses || [];
  return spouses.find((sid) => people[sid]) || null;
}

function parentFamilies(families, id) {
  return families.filter((family) => family.husband === id || family.wife === id);
}

function kidsOf(families, id) {
  const kids = [];
  for (const family of parentFamilies(families, id)) {
    for (const childId of family.children || []) {
      kids.push({ id: childId, family });
    }
  }
  return kids;
}

function orderCouple(people, anchorId) {
  const spouse = spouseOf(people, anchorId);
  if (!spouse) return [anchorId];
  const a = people[anchorId];
  const b = people[spouse];
  if (a.sex === 'F' && b.sex === 'M') return [spouse, anchorId];
  if (a.sex === 'M' && b.sex === 'F') return [anchorId, spouse];
  return [anchorId, spouse];
}

function marriageFamily(families, a, b) {
  return families.find((family) =>
    (family.husband === a && family.wife === b) || (family.husband === b && family.wife === a));
}

function childStatus(family, childId) {
  const link = (family.childLinks || []).find((item) => item.id === childId);
  return link?.status || 'proposed';
}

function parentStatus(people, childId, parentId) {
  const link = (people[childId]?.parentLinks || []).find((item) => item.id === parentId);
  return link?.status || 'proposed';
}

function coupleStatusBetween(families, a, b) {
  return marriageFamily(families, a, b)?.coupleStatus || 'probable';
}

/**
 * @param {{peopleById: object, families: object[]}} model
 * @param {string} focusId
 * @param {{ancestors?: boolean, depth?: string|number, forcedOpen?: Set<string>, forcedClosed?: Set<string>}} options
 */
export function layoutTree(model, focusId, options = {}) {
  const people = model.peopleById;
  const families = model.families;
  const depth = options.depth ?? 3;
  const forcedOpen = options.forcedOpen || new Set();
  const forcedClosed = options.forcedClosed || new Set();
  const nodes = [];
  const edges = [];
  const expanders = [];
  const nodeById = new Map();

  if (!people[focusId]) {
    return { nodes, edges, expanders, bounds: { x: 0, y: 0, w: 10, h: 10 }, shown: 0, total: 0, generations: 0 };
  }

  const auto = autoExpanded(focusId);

  function autoExpanded(rootId) {
    const set = new Set();
    if (String(depth) === 'all') {
      const stack = [rootId];
      const seen = new Set();
      while (stack.length) {
        const id = stack.pop();
        if (!id || seen.has(id) || !people[id]) continue;
        seen.add(id);
        const kids = kidsOf(families, id);
        if (kids.length) {
          set.add(id);
          kids.forEach((kid) => stack.push(kid.id));
        }
      }
      return set;
    }
    const levels = Math.max(1, Number(depth) || 3);
    let level = [rootId];
    const seen = new Set([rootId]);
    for (let generation = 0; generation < levels - 1; generation += 1) {
      const next = [];
      for (const id of level) {
        const kids = kidsOf(families, id);
        if (kids.length) set.add(id);
        for (const kid of kids) {
          if (!seen.has(kid.id) && people[kid.id]) {
            seen.add(kid.id);
            next.push(kid.id);
          }
        }
      }
      level = next;
    }
    return set;
  }

  function isExpanded(id) {
    if (forcedClosed.has(id)) return false;
    if (forcedOpen.has(id)) return true;
    return auto.has(id);
  }

  function measure(id, stack) {
    const couple = orderCouple(people, id).filter((pid) => people[pid]);
    const cw = couple.length * CARD_W + Math.max(0, couple.length - 1) * COUPLE_GAP;
    if (stack.has(id) || !isExpanded(id)) return { id, w: cw, children: [] };
    stack.add(id);
    const childNodes = [];
    for (const kid of kidsOf(families, id)) {
      if (!people[kid.id] || stack.has(kid.id)) continue;
      const child = measure(kid.id, stack);
      child.family = kid.family;
      childNodes.push(child);
    }
    stack.delete(id);
    const inner = childNodes.reduce((sum, child) => sum + child.w, 0)
      + Math.max(0, childNodes.length - 1) * SIB_GAP;
    return { id, w: Math.max(cw, inner), children: childNodes };
  }

  function addNode(node) {
    if (nodeById.has(node.id)) return nodeById.get(node.id);
    nodes.push(node);
    nodeById.set(node.id, node);
    return node;
  }

  function place(node, left, top) {
    const members = orderCouple(people, node.id).filter((pid) => people[pid]);
    const cw = members.length * CARD_W + Math.max(0, members.length - 1) * COUPLE_GAP;
    const coupleLeft = left + (node.w - cw) / 2;
    members.forEach((id, index) => {
      addNode({
        id,
        x: coupleLeft + index * (CARD_W + COUPLE_GAP),
        y: top,
        tier: 'desc',
      });
    });
    if (members.length === 2) {
      edges.push({
        kind: 'marriage',
        status: coupleStatusBetween(families, members[0], members[1]),
        x1: coupleLeft + CARD_W,
        y1: top + CARD_H / 2,
        x2: coupleLeft + CARD_W + COUPLE_GAP,
        y2: top + CARD_H / 2,
      });
    }
    const midX = coupleLeft + cw / 2;
    const allKids = kidsOf(families, node.id).filter((kid) => people[kid.id]);
    if (!isExpanded(node.id)) {
      if (allKids.length) {
        expanders.push({ personId: node.id, x: midX, y: top + CARD_H + 8, count: allKids.length });
      }
      return;
    }
    if (!node.children.length) return;
    const childTop = top + CARD_H + GEN_GAP;
    let cursor = left + (node.w - (node.children.reduce((sum, child) => sum + child.w, 0) + (node.children.length - 1) * SIB_GAP)) / 2;
    const centers = [];
    for (const child of node.children) {
      place(child, cursor, childTop);
      const childMembers = orderCouple(people, child.id).filter((pid) => people[pid]);
      const childCw = childMembers.length * CARD_W + Math.max(0, childMembers.length - 1) * COUPLE_GAP;
      const childMid = cursor + (child.w - childCw) / 2 + childCw / 2;
      centers.push({ mid: childMid, status: childStatus(child.family, child.id) });
      cursor += child.w + SIB_GAP;
    }
    const parentBottom = top + CARD_H;
    if (centers.length === 1) {
      edges.push({
        kind: 'child',
        status: centers[0].status,
        x1: midX,
        y1: parentBottom,
        x2: centers[0].mid,
        y2: childTop,
      });
      return;
    }
    const busY = parentBottom + 16;
    edges.push({
      kind: 'bus',
      status: 'neutral',
      x1: midX,
      y1: parentBottom,
      x2: midX,
      y2: busY,
    });
    edges.push({
      kind: 'bus',
      status: 'neutral',
      x1: centers[0].mid,
      y1: busY,
      x2: centers[centers.length - 1].mid,
      y2: busY,
    });
    for (const center of centers) {
      edges.push({
        kind: 'child',
        status: center.status,
        x1: center.mid,
        y1: busY,
        x2: center.mid,
        y2: childTop,
      });
    }
  }

  const rootMeasure = measure(focusId, new Set());
  place(rootMeasure, 0, 0);

  if (options.ancestors) {
    const focus = nodeById.get(focusId);
    const spouse = spouseOf(people, focusId);
    const spouseNode = spouse ? nodeById.get(spouse) : null;
    let centerX = focus.x + CARD_W / 2;
    let topY = focus.y;
    if (spouseNode) {
      const left = Math.min(focus.x, spouseNode.x);
      const right = Math.max(focus.x, spouseNode.x) + CARD_W;
      centerX = (left + right) / 2;
      topY = Math.min(focus.y, spouseNode.y);
    }
    const ancestorGens = String(depth) === 'all' ? 12 : Math.max(0, Number(depth) || 2);
    if (ancestorGens > 0) placeAncestors(focusId, centerX, topY, new Set([focusId]), ancestorGens);
  }

  function pedWidth(id, seen, remaining) {
    if (remaining <= 1) return CARD_W;
    const parents = orderedParents(id, seen);
    if (!parents.length) return CARD_W;
    if (parents.length === 1) return Math.max(CARD_W, pedWidth(parents[0], new Set([...seen, id]), remaining - 1));
    return Math.max(
      CARD_W,
      pedWidth(parents[0], new Set([...seen, id]), remaining - 1) + SIB_GAP + pedWidth(parents[1], new Set([...seen, id]), remaining - 1),
    );
  }

  function orderedParents(id, seen) {
    const ids = (people[id]?.parents || []).filter((pid) => people[pid] && !seen.has(pid) && !nodeById.has(pid));
    const male = ids.find((pid) => people[pid].sex === 'M');
    const female = ids.find((pid) => people[pid].sex === 'F');
    if (male && female && ids.length === 2) return [male, female];
    return ids;
  }

  function placeAncestors(childId, centerX, cardTop, seen, remaining) {
    if (remaining <= 0) return;
    const parents = orderedParents(childId, seen);
    if (!parents.length) return;
    const nextSeen = new Set([...seen, childId]);
    const widths = parents.map((pid) => pedWidth(pid, nextSeen, remaining));
    const total = widths.reduce((sum, width) => sum + width, 0) + (parents.length === 2 ? SIB_GAP : 0);
    let cursor = centerX - total / 2;
    const y = cardTop - GEN_GAP - CARD_H;
    const placed = [];
    parents.forEach((pid, index) => {
      const width = widths[index];
      const cardX = cursor + (width - CARD_W) / 2;
      addNode({ id: pid, x: cardX, y, tier: 'anc' });
      placed.push({ id: pid, x: cardX, mid: cardX + CARD_W / 2 });
      placeAncestors(pid, cardX + CARD_W / 2, y, nextSeen, remaining - 1);
      cursor += width + (index === 0 && parents.length === 2 ? SIB_GAP : 0);
    });
    if (placed.length === 2) {
      edges.push({
        kind: 'marriage',
        status: coupleStatusBetween(families, placed[0].id, placed[1].id),
        x1: placed[0].x + CARD_W,
        y1: y + CARD_H / 2,
        x2: placed[1].x,
        y2: y + CARD_H / 2,
      });
    }
    const busY = y + CARD_H + 26;
    const statuses = placed.map((parent) => parentStatus(people, childId, parent.id));
    const shared = statuses.every((status) => status === statuses[0]) ? statuses[0] : 'neutral';
    for (const parent of placed) {
      edges.push({
        kind: 'parent',
        status: parentStatus(people, childId, parent.id),
        points: [[parent.mid, y + CARD_H], [parent.mid, busY], [centerX, busY]],
      });
    }
    edges.push({
      kind: 'parent',
      status: shared,
      points: [[centerX, busY], [centerX, cardTop]],
    });
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const include = (x, y, w, h) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  };
  for (const node of nodes) include(node.x, node.y, CARD_W, CARD_H);
  for (const expander of expanders) include(expander.x - 70, expander.y, 140, 24);
  for (const edge of edges) {
    const pts = edge.points || [[edge.x1, edge.y1], [edge.x2, edge.y2]];
    for (const [x, y] of pts) include(x, y, 0, 0);
  }
  const pad = 36;
  const bounds = Number.isFinite(minX)
    ? { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 }
    : { x: 0, y: 0, w: 10, h: 10 };
  const generations = new Set(nodes.filter((node) => node.tier !== 'anc').map((node) => node.y)).size;
  return {
    nodes,
    edges,
    expanders,
    bounds,
    shown: nodes.length,
    total: coneCount(focusId),
    generations,
  };

  function coneCount(rootId) {
    const ids = new Set();
    const stack = [rootId];
    while (stack.length) {
      const id = stack.pop();
      if (!id || ids.has(id) || !people[id]) continue;
      ids.add(id);
      const spouse = spouseOf(people, id);
      if (spouse && people[spouse]) ids.add(spouse);
      for (const kid of kidsOf(families, id)) stack.push(kid.id);
    }
    return ids.size;
  }
}

function clip(value, max) {
  const text = String(value || '');
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function xml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

function cardMeta(person) {
  const birth = yearOf(person.birth?.date);
  const death = yearOf(person.death?.date);
  let life = '';
  if (birth && death) life = `${birth}–${death}`;
  else if (birth) life = birth;
  else if (death) life = `d. ${death}`;
  return [lineKey(person.line), life].filter(Boolean).join(' · ');
}

function edgeMarkup(edge) {
  const style = STATUS_STYLE[edge.status] || STATUS_STYLE.neutral;
  const dash = style.dash ? ` stroke-dasharray="${style.dash}"` : '';
  const common = `fill="none" stroke="${style.color}" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round"${dash}`;
  if (edge.points) {
    const d = edge.points.map((point, index) => `${index ? 'L' : 'M'}${point[0].toFixed(1)} ${point[1].toFixed(1)}`).join(' ');
    return `<path class="edge ${edge.kind}" d="${d}" ${common}><title>${xml(edge.status)}</title></path>`;
  }
  return `<line class="edge ${edge.kind}" x1="${edge.x1}" y1="${edge.y1}" x2="${edge.x2}" y2="${edge.y2}" ${common}><title>${xml(edge.status)}</title></line>`;
}

function edgeLabelMarkup(edge) {
  if (!edge.status || edge.status === 'verified' || edge.status === 'neutral') return '';
  const style = STATUS_STYLE[edge.status] || STATUS_STYLE.neutral;
  const x = edge.points ? edge.points[edge.points.length - 1][0] : edge.x2;
  const y1 = edge.points ? edge.points[0][1] : edge.y1;
  const y2 = edge.points ? edge.points[edge.points.length - 1][1] : edge.y2;
  const y = (y1 + y2) / 2;
  return `<text class="edge-label" x="${(x + 8).toFixed(1)}" y="${y.toFixed(1)}" fill="${style.color}">${xml(edge.status)}</text>`;
}

function nodeMarkup(node, person, { selected, focus }) {
  const color = lineColor(person.line);
  const classes = ['node'];
  if (selected) classes.push('is-selected');
  if (focus) classes.push('is-focus');
  return `
    <g class="${classes.join(' ')}" data-id="${xml(node.id)}" transform="translate(${node.x} ${node.y})" tabindex="0" role="button">
      <title>${xml(personName(person))}</title>
      <rect class="card" width="${CARD_W}" height="${CARD_H}" rx="10" stroke="${color}"></rect>
      <text class="given" x="12" y="28">${xml(clip(person.given, 16))}</text>
      <text class="surnames" x="12" y="46">${xml(clip(person.surnames || '—', 16))}</text>
      <text class="meta" x="12" y="66">${xml(clip(cardMeta(person), 22))}</text>
      <g class="set-root" data-id="${xml(node.id)}" transform="translate(148 6)" tabindex="0" role="button" aria-label="Set as root">
        <title>Set as root</title>
        <rect width="22" height="22" rx="6"></rect>
        <path d="M6 15.5h10M11 15.5V7.5M8 10.2l3-3 3 3"></path>
      </g>
    </g>`;
}

function expanderMarkup(expander) {
  const label = `+ ${expander.count} ${expander.count === 1 ? 'child' : 'children'}`;
  const width = Math.max(108, label.length * 7.2);
  return `
    <g class="expander" data-id="${xml(expander.personId)}" transform="translate(${(expander.x - width / 2).toFixed(1)} ${expander.y})" tabindex="0" role="button">
      <title>Show children</title>
      <rect width="${width.toFixed(1)}" height="24" rx="12"></rect>
      <text x="${(width / 2).toFixed(1)}" y="16" text-anchor="middle">${xml(label)}</text>
    </g>`;
}

export function mountTree(container, model, state, hooks) {
  const viewport = document.createElement('div');
  viewport.className = 'tree-viewport';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'tree-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Family tree');
  viewport.appendChild(svg);
  const hud = document.createElement('div');
  hud.className = 'tree-hud';
  hud.innerHTML = `
    <p class="tree-caption"></p>
    <div class="zoom-controls">
      <button type="button" data-zoom="in" aria-label="Zoom in">+</button>
      <button type="button" data-zoom="out" aria-label="Zoom out">−</button>
      <button type="button" data-zoom="fit">Fit all</button>
      <button type="button" data-zoom="reset">Reset view</button>
    </div>`;
  container.replaceChildren(hud, viewport);

  let layout = null;
  let selectedId = state.focusId;
  let tx = 0;
  let ty = 0;
  let scale = 1;
  let userMoved = false;
  const world = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  svg.appendChild(world);

  function relayout() {
    layout = layoutTree(model, state.focusId, {
      ancestors: state.ancestors,
      depth: state.depth,
      forcedOpen: state.forcedOpen,
      forcedClosed: state.forcedClosed,
    });
    const caption = hud.querySelector('.tree-caption');
    const anc = state.ancestors ? `${state.depth} generations of ancestors` : `${state.depth} generations`;
    caption.textContent = `${layout.shown} people shown. ${anc}.`;
    paintWorld();
  }

  function paintWorld() {
    const parts = ['<defs><filter id="cardshadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="1" stdDeviation="1.4" flood-opacity="0.16"/></filter></defs>'];
    for (const edge of layout.edges) parts.push(edgeMarkup(edge));
    for (const edge of layout.edges) parts.push(edgeLabelMarkup(edge));
    for (const node of layout.nodes) {
      const person = model.peopleById[node.id];
      if (!person) continue;
      parts.push(nodeMarkup(node, person, { selected: node.id === selectedId, focus: node.id === state.focusId }));
    }
    for (const expander of layout.expanders) parts.push(expanderMarkup(expander));
    world.innerHTML = parts.join('');
    applyTransform();
  }

  function applyTransform() {
    world.setAttribute('transform', `translate(${tx} ${ty}) scale(${scale})`);
  }

  function zoomAt(px, py, factor) {
    const next = Math.min(2.6, Math.max(0.12, scale * factor));
    const k = next / scale;
    tx = px - (px - tx) * k;
    ty = py - (py - ty) * k;
    scale = next;
    userMoved = true;
    applyTransform();
  }

  function fitAll() {
    const box = viewport.getBoundingClientRect();
    if (box.width < 40 || !layout) return;
    const pad = 28;
    scale = Math.min((box.width - pad * 2) / layout.bounds.w, (box.height - pad * 2) / layout.bounds.h, 1.15);
    scale = Math.max(scale, 0.08);
    tx = (box.width - layout.bounds.w * scale) / 2 - layout.bounds.x * scale;
    ty = (box.height - layout.bounds.h * scale) / 2 - layout.bounds.y * scale;
    applyTransform();
  }

  function resetView() {
    const box = viewport.getBoundingClientRect();
    if (box.width < 40 || !layout) return;
    const pad = 32;
    const fitS = Math.min((box.width - pad * 2) / layout.bounds.w, (box.height - pad * 2) / layout.bounds.h);
    if (fitS >= 0.5) {
      scale = Math.min(fitS, 1.05);
      tx = (box.width - layout.bounds.w * scale) / 2 - layout.bounds.x * scale;
      ty = (box.height - layout.bounds.h * scale) / 2 - layout.bounds.y * scale;
    } else {
      scale = 0.92;
      const root = layout.nodes.find((node) => node.id === state.focusId) || layout.nodes[0];
      tx = box.width / 2 - (root.x + CARD_W / 2) * scale;
      ty = 28 - layout.bounds.y * scale;
    }
    userMoved = false;
    applyTransform();
  }

  function pointerPoint(event) {
    const rect = svg.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  let drag = null;
  const pointers = new Map();

  function onPointerDown(event) {
    if (event.button != null && event.button !== 0) return;
    svg.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, pointerPoint(event));
    const interactive = event.target.closest?.('.set-root, .expander, .node');
    drag = {
      x: event.clientX,
      y: event.clientY,
      tx,
      ty,
      moved: false,
      interactive,
    };
  }

  function onPointerMove(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, pointerPoint(event));
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      if (!drag.pinchDist) {
        drag.pinchDist = dist;
        drag.pinchScale = scale;
      }
      const factor = dist / drag.pinchDist;
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const next = Math.min(2.6, Math.max(0.12, drag.pinchScale * factor));
      const k = next / scale;
      tx = cx - (cx - tx) * k;
      ty = cy - (cy - ty) * k;
      scale = next;
      userMoved = true;
      drag.moved = true;
      applyTransform();
      return;
    }
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.hypot(dx, dy) > 5) drag.moved = true;
    if (drag.moved) {
      tx = drag.tx + dx;
      ty = drag.ty + dy;
      userMoved = true;
      applyTransform();
    }
  }

  function onPointerUp(event) {
    pointers.delete(event.pointerId);
    if (!drag || event.pointerId == null) {
      drag = null;
      return;
    }
    if (!drag.moved && drag.interactive) {
      const setRoot = drag.interactive.closest?.('.set-root');
      const expander = drag.interactive.closest?.('.expander');
      const node = drag.interactive.closest?.('.node');
      if (setRoot) hooks.onSetRoot?.(setRoot.getAttribute('data-id'));
      else if (expander) hooks.onExpand?.(expander.getAttribute('data-id'));
      else if (node) hooks.onOpen?.(node.getAttribute('data-id'));
    }
    drag = null;
  }

  function onWheel(event) {
    event.preventDefault();
    const point = pointerPoint(event);
    zoomAt(point.x, point.y, event.deltaY < 0 ? 1.09 : 1 / 1.09);
  }

  function onKey(event) {
    const node = event.target.closest?.('.set-root, .expander, .node');
    if (!node) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (node.classList.contains('set-root')) hooks.onSetRoot?.(node.getAttribute('data-id'));
    else if (node.classList.contains('expander')) hooks.onExpand?.(node.getAttribute('data-id'));
    else hooks.onOpen?.(node.getAttribute('data-id'));
  }

  function onHudClick(event) {
    const button = event.target.closest('[data-zoom]');
    if (!button) return;
    const action = button.getAttribute('data-zoom');
    const rect = viewport.getBoundingClientRect();
    if (action === 'in') zoomAt(rect.width / 2, rect.height / 2, 1.2);
    if (action === 'out') zoomAt(rect.width / 2, rect.height / 2, 1 / 1.2);
    if (action === 'fit') {
      fitAll();
      userMoved = true;
    }
    if (action === 'reset') resetView();
  }

  svg.addEventListener('pointerdown', onPointerDown);
  svg.addEventListener('pointermove', onPointerMove);
  svg.addEventListener('pointerup', onPointerUp);
  svg.addEventListener('pointercancel', onPointerUp);
  svg.addEventListener('wheel', onWheel, { passive: false });
  svg.addEventListener('keydown', onKey);
  hud.addEventListener('click', onHudClick);

  const observer = new ResizeObserver(() => {
    if (!userMoved) resetView();
  });
  observer.observe(viewport);

  relayout();
  requestAnimationFrame(resetView);

  return {
    destroy() {
      observer.disconnect();
      svg.removeEventListener('pointerdown', onPointerDown);
      svg.removeEventListener('pointermove', onPointerMove);
      svg.removeEventListener('pointerup', onPointerUp);
      svg.removeEventListener('pointercancel', onPointerUp);
      svg.removeEventListener('wheel', onWheel);
      svg.removeEventListener('keydown', onKey);
      hud.removeEventListener('click', onHudClick);
    },
    expand(id) {
      if (state.forcedOpen.has(id)) return;
      state.forcedClosed.delete(id);
      state.forcedOpen.add(id);
      relayout();
    },
    select(id) {
      selectedId = id;
      paintWorld();
    },
  };
}

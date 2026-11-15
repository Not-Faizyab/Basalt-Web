/*
 * Graph view — canvas force-directed graph (global graph tab + local graph panel).
 */
import { h, clear, bus } from '../lib/dom.js';
import { App } from '../lib/app-context.js';
import { vault, mdFiles, resolveVaultPath, settings } from '../lib/state.js';
import { stripMd, baseName } from '../shared/links.cjs';

export function createGraphView({ mode = 'global', focusPath = null, depth = 1, small = false }) {
  const host = h('div', { class: 'graph-host' });
  const canvas = document.createElement('canvas');
  canvas.width = 600; canvas.height = 400;
  host.append(canvas);
  const ctx2d = canvas.getContext('2d');

  const state = {
    nodes: new Map(),   // path -> {id, x, y, vx, vy, r, label, degree, unresolved, current}
    edges: [],          // {a, b}
    alpha: 1,
    transform: { x: 0, y: 0, k: 1 },
    hovered: null,
    dragNode: null,
    panning: false,
    lastMouse: { x: 0, y: 0 },
    params: { repel: 1, link: 1, center: 1, linkDist: 110 },
    filterText: '',
    showOrphans: true,
    focusPath,
    depth,
  };

  let raf = null;
  let running = true;

  /* -------------------------------------------------------------- build */
  function build() {
    state.nodes.clear();
    state.edges = [];
    const nodes = state.nodes;
    const addNode = (id, unresolved = false) => {
      if (!nodes.has(id)) {
        const w = canvas.clientWidth || 600, hh = canvas.clientHeight || 400;
        const ang = Math.random() * Math.PI * 2;
        const rad = 60 + Math.random() * Math.min(w, hh) / 3;
        nodes.set(id, {
          id, x: w / 2 + Math.cos(ang) * rad, y: hh / 2 + Math.sin(ang) * rad,
          vx: 0, vy: 0, r: 4, degree: 0, unresolved, label: stripMd(baseName(id)),
        });
      }
      return nodes.get(id);
    };

    if (mode === 'local' && focusPath) {
      // BFS from focus
      const seen = new Map([[focusPath, 0]]);
      const queue = [focusPath];
      addNode(focusPath).current = true;
      while (queue.length) {
        const cur = queue.shift();
        const d = seen.get(cur);
        if (d >= depth) continue;
        const outs = (vault.notes[cur]?.links || []).map(l => resolveVaultPath(l.target, cur).file).filter(Boolean);
        const ins = Object.entries(vault.notes)
          .filter(([, n]) => (n.links || []).some(l => resolveVaultPath(l.target, cur).file === cur))
          .map(([p]) => p);
        for (const next of [...outs, ...ins]) {
          if (!vault.notes[next]) continue;
          if (!seen.has(next)) { seen.set(next, d + 1); queue.push(next); }
          if (d + 1 <= depth && seen.get(next) <= depth) {
            addNode(next);
            state.edges.push({ a: cur, b: next });
          }
        }
      }
    } else {
      for (const f of mdFiles()) addNode(f.path);
      for (const [p, note] of Object.entries(vault.notes)) {
        for (const link of note.links || []) {
          const r = resolveVaultPath(link.target, p);
          if (r.file && vault.notes[r.file] && r.file !== p) {
            state.edges.push({ a: p, b: r.file });
          } else if (!r.file && link.target) {
            const uname = '· ' + stripMd(link.target);
            const un = addNode(uname, true);
            un.label = stripMd(link.target);
            state.edges.push({ a: p, b: uname });
          }
        }
      }
    }

    // degree & radius
    for (const e of state.edges) {
      const a = nodes.get(e.a), b = nodes.get(e.b);
      if (a) a.degree++;
      if (b) b.degree++;
    }
    for (const n of nodes.values()) {
      n.r = 4 + Math.min(10, Math.sqrt(n.degree) * 2.4);
    }
    // filter
    if (state.filterText) {
      const q = state.filterText.toLowerCase();
      const keep = new Set([...nodes.values()].filter(n => n.label.toLowerCase().includes(q)).map(n => n.id));
      for (const [id, n] of nodes) if (!keep.has(id) && !n.unresolved) { /* keep unless orphan under filter */ }
      state.edges = state.edges.filter(e => keep.has(e.a) && keep.has(e.b));
      for (const id of [...nodes.keys()]) if (!keep.has(id)) nodes.delete(id);
    }
    if (!state.showOrphans) {
      const deg = new Set();
      state.edges.forEach(e => { deg.add(e.a); deg.add(e.b); });
      for (const [id, n] of nodes) if (!deg.has(id)) nodes.delete(id);
    }
    state.alpha = 1;
  }

  /* ---------------------------------------------------------------- sim */
  function step() {
    const nodes = [...state.nodes.values()];
    const P = state.params;
    const k = state.transform.k;
    const w = (canvas.clientWidth || 600), h = (canvas.clientHeight || 400);
    const cx = w / 2, cy = h / 2;
    const N = nodes.length;
    // repulsion O(n²) — fine for typical vaults; guard big ones
    const cap = 1600;
    for (let i = 0; i < Math.min(N, cap); i++) {
      const a = nodes[i];
      for (let j = i + 1; j < Math.min(N, cap); j++) {
        const b = nodes[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
        if (d2 > 400000) continue;
        const f = (1600 * P.repel * state.alpha) / d2;
        const d = Math.sqrt(d2);
        const fx = (dx / d) * f, fy = (dy / d) * f;
        a.vx -= fx; a.vy -= fy;
        b.vx += fx; b.vy += fy;
      }
    }
    // springs
    for (const e of state.edges) {
      const a = state.nodes.get(e.a), b = state.nodes.get(e.b);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const rest = P.linkDist;
      const f = (d - rest) * 0.045 * P.link * Math.min(1, state.alpha + 0.3);
      const fx = (dx / d) * f, fy = (dy / d) * f;
      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
    }
    // center gravity + integrate
    for (const n of nodes) {
      n.vx += (cx - n.x) * 0.012 * P.center * state.alpha;
      n.vy += (cy - n.y) * 0.012 * P.center * state.alpha;
      if (state.dragNode === n) { n.vx = 0; n.vy = 0; continue; }
      n.vx *= 0.85; n.vy *= 0.85;
      n.x += n.vx; n.y += n.vy;
    }
    state.alpha *= 0.995;
  }

  /* ---------------------------------------------------------------- draw */
  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr; canvas.height = h * dpr;
    }
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2d.clearRect(0, 0, w, h);
    ctx2d.translate(state.transform.x, state.transform.y);
    ctx2d.scale(state.transform.k, state.transform.k);

    const accent = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#9d7cff';
    const textCol = getComputedStyle(document.body).getPropertyValue('--text-muted').trim() || '#999';
    const linkCol = getComputedStyle(document.body).getPropertyValue('--text-faint').trim() || '#666';
    const hovered = state.hovered;

    const neighbor = new Set();
    if (hovered) {
      for (const e of state.edges) {
        if (e.a === hovered.id) neighbor.add(e.b);
        if (e.b === hovered.id) neighbor.add(e.a);
      }
    }

    // edges
    ctx2d.lineWidth = 1 / state.transform.k;
    for (const e of state.edges) {
      const a = state.nodes.get(e.a), b = state.nodes.get(e.b);
      if (!a || !b) continue;
      let alpha = 0.35;
      if (hovered) alpha = (hovered.id === e.a || hovered.id === e.b) ? 0.9 : 0.08;
      ctx2d.strokeStyle = hovered && (hovered.id === e.a || hovered.id === e.b) ? accent : linkCol;
      ctx2d.globalAlpha = alpha;
      ctx2d.beginPath();
      ctx2d.moveTo(a.x, a.y);
      ctx2d.quadraticCurveTo((a.x + b.x) / 2 + (a.y - b.y) * 0.08, (a.y + b.y) / 2 + (b.x - a.x) * 0.08, b.x, b.y);
      ctx2d.stroke();
    }
    ctx2d.globalAlpha = 1;

    // nodes
    for (const n of state.nodes.values()) {
      let alpha = 1;
      if (hovered) alpha = (n === hovered || neighbor.has(n.id)) ? 1 : 0.15;
      ctx2d.globalAlpha = alpha;
      if (n.unresolved) {
        ctx2d.setLineDash([3, 3]);
        ctx2d.strokeStyle = linkCol;
        ctx2d.lineWidth = 1.2 / state.transform.k;
        ctx2d.beginPath();
        ctx2d.arc(n.x, n.y, n.r * 0.7, 0, Math.PI * 2);
        ctx2d.stroke();
        ctx2d.setLineDash([]);
      } else {
        ctx2d.fillStyle = accent;
        ctx2d.beginPath();
        ctx2d.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx2d.fill();
        if (n.current) {
          ctx2d.strokeStyle = accent;
          ctx2d.lineWidth = 2 / state.transform.k;
          ctx2d.beginPath();
          ctx2d.arc(n.x, n.y, n.r + 3, 0, Math.PI * 2);
          ctx2d.stroke();
        }
      }
      // labels
      const showLabel = (hovered && (n === hovered || neighbor.has(n.id))) || state.transform.k > 0.85 || n.degree >= 4 || N < 40;
      if (showLabel) {
        ctx2d.globalAlpha = alpha * (n === hovered ? 1 : 0.85);
        ctx2d.fillStyle = n === hovered ? accent : textCol;
        ctx2d.font = `${11 / Math.max(0.6, state.transform.k)}px "Segoe UI", sans-serif`;
        ctx2d.textAlign = 'center';
        ctx2d.fillText(n.label, n.x, n.y + n.r + 11);
      }
      ctx2d.globalAlpha = 1;
    }
  }

  function loop() {
    if (!running || !host.isConnected) return;
    if (state.alpha > 0.02 || state.dragNode) { step(); }
    draw();
    raf = requestAnimationFrame(loop);
  }

  /* ---------------------------------------------------------- interact */
  function canvasPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function toWorld(p) {
    return {
      x: (p.x - state.transform.x) / state.transform.k,
      y: (p.y - state.transform.y) / state.transform.k,
    };
  }
  function hitTest(p) {
    const w = toWorld(p);
    let best = null, bestD = 1e9;
    for (const n of state.nodes.values()) {
      const d = (n.x - w.x) ** 2 + (n.y - w.y) ** 2;
      if (d < (n.r + 6) ** 2 && d < bestD) { best = n; bestD = d; }
    }
    return best;
  }

  canvas.addEventListener('mousedown', (e) => {
    const p = canvasPos(e);
    const n = hitTest(p);
    if (n) { state.dragNode = n; n._dragOff = { dx: n.x - toWorld(p).x, dy: n.y - toWorld(p).y }; }
    else { state.panning = true; canvas.classList.add('panning'); }
    state.lastMouse = p;
    state._moved = 0;
  });
  window.addEventListener('mousemove', (e) => {
    if (!host.isConnected) return;
    const p = canvasPos(e);
    if (state.dragNode) {
      const w = toWorld(p);
      state.dragNode.x = w.x + state.dragNode._dragOff.dx;
      state.dragNode.y = w.y + state.dragNode._dragOff.dy;
      state._moved += 1;
      state.alpha = Math.max(state.alpha, 0.25);
    } else if (state.panning) {
      state.transform.x += p.x - state.lastMouse.x;
      state.transform.y += p.y - state.lastMouse.y;
      state._moved += Math.abs(p.x - state.lastMouse.x) + Math.abs(p.y - state.lastMouse.y);
      state.lastMouse = p;
    } else {
      state.hovered = hitTest(p);
      canvas.style.cursor = state.hovered ? 'pointer' : 'grab';
    }
  });
  window.addEventListener('mouseup', (e) => {
    if (state.dragNode && state._moved < 4) {
      const n = state.dragNode;
      if (n.unresolved) {
        App.openFile(n.label, {}); // creates the note
      } else {
        App.openFile(n.id, { ctrlKey: false });
      }
    }
    state.dragNode = null;
    state.panning = false;
    canvas.classList.remove('panning');
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = canvasPos(e);
    const old = state.transform.k;
    const factor = Math.exp(-e.deltaY * 0.0012);
    const nk = Math.min(4, Math.max(0.15, old * factor));
    state.transform.x = p.x - ((p.x - state.transform.x) / old) * nk;
    state.transform.y = p.y - ((p.y - state.transform.y) / old) * nk;
    state.transform.k = nk;
  }, { passive: false });

  /* --------------------------------------------------------- controls */
  const controls = mode === 'global' ? h('div', { class: 'graph-controls' },
    h('div', { class: 'gc-title' }, 'Graph'),
    h('label', {}, 'Repel', h('input', { type: 'range', min: '0.2', max: '2.5', step: '0.1', value: '1', oninput: (e) => { state.params.repel = +e.target.value; state.alpha = 1; } })),
    h('label', {}, 'Link force', h('input', { type: 'range', min: '0.2', max: '2.5', step: '0.1', value: '1', oninput: (e) => { state.params.link = +e.target.value; state.alpha = 1; } })),
    h('label', {}, 'Center', h('input', { type: 'range', min: '0', max: '3', step: '0.1', value: '1', oninput: (e) => { state.params.center = +e.target.value; state.alpha = 1; } })),
    h('label', {}, 'Link distance', h('input', { type: 'range', min: '40', max: '260', step: '10', value: '110', oninput: (e) => { state.params.linkDist = +e.target.value; state.alpha = 1; } })),
    h('input', { type: 'text', placeholder: 'Filter by name…', oninput: (e) => { state.filterText = e.target.value; build(); } }),
    h('label', { class: 'gc-toggle' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => { state.showOrphans = e.target.checked; build(); } }), 'Show orphans'),
  ) : null;

  const legend = mode === 'global' ? h('div', { class: 'graph-legend' }, `${state.nodes.size} notes · ${state.edges.length} links · drag to arrange, scroll to zoom`) : null;

  /* ------------------------------------------------------------- resize */
  const ro = new ResizeObserver(() => { /* canvas auto-adapts in draw() */ });
  ro.observe(host);

  build();
  if (controls) host.append(controls);
  if (legend) host.append(legend);
  requestAnimationFrame(loop);

  const offIndex = bus.on('index-updated', () => {
    if (!host.isConnected) return;
    build();
    if (legend) legend.textContent = `${state.nodes.size} notes · ${state.edges.length} links · drag to arrange, scroll to zoom`;
  });
  const offTheme = bus.on('appearance-changed', () => { /* colors read at draw time */ });

  return {
    dom: () => host,
    destroy() {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      offIndex(); offTheme();
    },
    rebuild: build,
    focus(path) {
      focusPath = path;
      build();
    },
  };
}

/* Local graph panel (right sidebar) */
export function mountLocalGraphPanel(el) {
  let ctrl = null;
  let depth = 1;
  const controls = h('div', { class: 'local-graph-controls' },
    h('span', {}, 'Depth'),
    h('input', { type: 'range', min: '1', max: '4', step: '1', value: '1', style: { width: '90px' }, oninput: (e) => { depth = +e.target.value; render(); } }),
    h('button', { class: 'ghost', title: 'Open full graph', onclick: () => App.runCommand('workspace:open-graph') }, 'Open graph ↗'),
  );
  const graphHost = h('div', { class: 'local-graph-host' });
  el.append(controls, graphHost);

  function render() {
    const tab = App.activeTab?.();
    if (ctrl) { ctrl.destroy(); ctrl = null; }
    clear(graphHost);
    if (!tab || tab.type !== 'file' || !tab.path) {
      graphHost.append(h('div', { class: 'bl-empty', style: { padding: '12px' } }, 'Open a note to see its local graph.'));
      return;
    }
    ctrl = createGraphView({ mode: 'local', focusPath: tab.path, depth, small: true });
    graphHost.append(ctrl.dom());
  }
  bus.on('tab-activated', render);
  render();
  return { refresh: render };
}

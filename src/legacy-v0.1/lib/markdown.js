/*
 * Markdown → HTML pipeline with obsidian-style extensions:
 * wikilinks, embeds, tags, callouts, highlights, math, properties.
 * renderMarkdown() is pure string→string (node-safe, used by smoke tests);
 * wirePreview() attaches interaction handlers in the DOM.
 */
import { marked } from 'marked';
import katex from 'katex';
import { isImage, baseName, stripMd, slugify } from '../shared/links.cjs';
import { iconSvg } from './icon-paths.js';

export const CALLOUTS = {
  note: { label: 'Note', color: 'var(--callout-note)', icon: 'pencil' },
  abstract: { label: 'Abstract', color: 'var(--callout-abstract)', icon: 'list' },
  summary: { label: 'Summary', color: 'var(--callout-abstract)', icon: 'list' },
  tldr: { label: 'TL;DR', color: 'var(--callout-abstract)', icon: 'list' },
  info: { label: 'Info', color: 'var(--callout-info)', icon: 'info' },
  todo: { label: 'Todo', color: 'var(--callout-info)', icon: 'check' },
  tip: { label: 'Tip', color: 'var(--callout-tip)', icon: 'flame' },
  hint: { label: 'Hint', color: 'var(--callout-tip)', icon: 'flame' },
  important: { label: 'Important', color: 'var(--callout-tip)', icon: 'alert' },
  success: { label: 'Success', color: 'var(--callout-success)', icon: 'check' },
  check: { label: 'Check', color: 'var(--callout-success)', icon: 'check' },
  done: { label: 'Done', color: 'var(--callout-success)', icon: 'check' },
  question: { label: 'Question', color: 'var(--callout-question)', icon: 'info' },
  help: { label: 'Help', color: 'var(--callout-question)', icon: 'info' },
  faq: { label: 'FAQ', color: 'var(--callout-question)', icon: 'info' },
  caution: { label: 'Caution', color: 'var(--callout-warning)', icon: 'alert' },
  warning: { label: 'Warning', color: 'var(--callout-warning)', icon: 'alert' },
  attention: { label: 'Attention', color: 'var(--callout-warning)', icon: 'alert' },
  failure: { label: 'Failure', color: 'var(--callout-failure)', icon: 'x' },
  fail: { label: 'Failure', color: 'var(--callout-failure)', icon: 'x' },
  missing: { label: 'Missing', color: 'var(--callout-failure)', icon: 'x' },
  danger: { label: 'Danger', color: 'var(--callout-danger)', icon: 'alert' },
  error: { label: 'Error', color: 'var(--callout-danger)', icon: 'alert' },
  bug: { label: 'Bug', color: 'var(--callout-bug)', icon: 'alert' },
  example: { label: 'Example', color: 'var(--callout-example)', icon: 'book' },
  quote: { label: 'Quote', color: 'var(--callout-quote)', icon: 'quote' },
  cite: { label: 'Citation', color: 'var(--callout-quote)', icon: 'quote' },
};

let codeStore = [];
let renderCtx = null;

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let configured = false;
function configure() {
  if (configured) return;
  configured = true;

  const ext = (def) => marked.use({ extensions: [def] });

  // [[wikilink]] and ![[embed]]
  ext({
    name: 'wikilink', level: 'inline',
    start(src) { const i = src.indexOf('![') >= 0 && src.indexOf('![[') >= 0 ? src.indexOf('![[') : src.indexOf('[['); return i; },
    tokenizer(src) {
      const m = /^!\[\[([^\[\]\n]+)\]\]/.exec(src) || /^\[\[([^\[\]\n]+)\]\]/.exec(src);
      if (!m) return;
      let inner = m[1].trim();
      const embed = m[0].startsWith('!');
      let alias = null;
      const pipe = inner.indexOf('|');
      if (pipe >= 0) { alias = inner.slice(pipe + 1).trim(); inner = inner.slice(0, pipe).trim(); }
      let heading = null, block = null;
      const hash = inner.indexOf('#');
      if (hash >= 0) {
        let frag = inner.slice(hash + 1).trim();
        inner = inner.slice(0, hash).trim();
        if (frag.startsWith('^')) block = frag.slice(1); else heading = frag;
      }
      return { type: 'wikilink', raw: m[0], target: inner, alias, heading, block, embed };
    },
    renderer(t) { return renderWikilink(t); },
  });

  // #tag
  ext({
    name: 'tag', level: 'inline',
    start(src) { return src.search(/#[\p{L}_]/u); },
    tokenizer(src) {
      const m = /^#([\p{L}_][\p{L}\p{N}_\/-]*)/u.exec(src);
      if (!m) return;
      return { type: 'tag', raw: m[0], tag: m[1] };
    },
    renderer(t) { return `<span class="tag bs-tag-ctl" data-tag="${esc(t.tag)}">#${esc(t.tag)}</span>`; },
  });

  // ==highlight==
  ext({
    name: 'hl', level: 'inline',
    start(src) { return src.indexOf('=='); },
    tokenizer(src) {
      const m = /^==(?!=)([^=\n]+)==/.exec(src);
      if (!m) return;
      return { type: 'hl', raw: m[0], tokens: this.lexer.inlineTokens(m[1]) };
    },
    renderer(t) { return `<mark>${this.parser.parseInline(t.tokens)}</mark>`; },
  });

  // $inline math$
  ext({
    name: 'math', level: 'inline',
    start(src) { return src.indexOf('$'); },
    tokenizer(src) {
      const m = /^\$(?!\s)((?:\\\$|[^\$\n])+?)(?<!\s)\$(?!\d)/.exec(src);
      if (!m) return;
      return { type: 'math', raw: m[0], tex: m[1] };
    },
    renderer(t) { return katexToHtml(t.tex, false); },
  });

  // $$block math$$
  ext({
    name: 'mathblock', level: 'block',
    start(src) { return src.indexOf('$$'); },
    tokenizer(src) {
      const m = /^\$\$([\s\S]+?)\$\$(?:\n+|$)/.exec(src);
      if (!m) return;
      return { type: 'mathblock', raw: m[0], tex: m[1].trim() };
    },
    renderer(t) { return `<p class="math-block">${katexToHtml(t.tex, true)}</p>`; },
  });
}

function katexToHtml(tex, displayMode) {
  try {
    return katex.renderToString(tex, { throwOnError: false, displayMode, output: 'html' });
  } catch (e) {
    return `<code class="bs-math-raw">${esc(tex)}</code>`;
  }
}

function renderWikilink(t) {
  const ctx = renderCtx;
  const display = t.alias || (t.target ? stripMd(baseName(t.target)) : (t.heading ? '#' + t.heading : '^' + t.block));
  if (t.embed) {
    const r = ctx ? ctx.resolve(t.target, ctx.fromPath) : { file: null };
    if (r && r.file && isImage(r.file)) {
      return `<div class="embed"><span class="embed-title" data-open="${esc(r.file)}">${calloutIconSvg('eye')} ${esc(baseName(r.file))}</span><img class="embed-img" src="${ctx.assetUrl(r.file)}" alt="${esc(display)}"></div>`;
    }
    if (r && r.file && ctx.getNote) {
      const inner = ctx.getNote(r.file, t.heading, t.block, (ctx.depth || 0) + 1);
      if (inner !== null) {
        return `<div class="embed"><span class="embed-title" data-open="${esc(r.file)}">${calloutIconSvg('link')} ${esc(stripMd(baseName(r.file)))}</span>${inner}</div>`;
      }
    }
    return `<span class="embed-missing faint">![[${esc((t.target || '') + (t.heading ? '#' + t.heading : '') + (t.block ? '^' + t.block : ''))}]]</span>`;
  }
  const r = ctx ? ctx.resolve(t.target, ctx.fromPath) : null;
  const cls = r && r.file ? 'internal-link' : 'internal-link unresolved';
  const attrs = `data-target="${esc(t.target)}" data-heading="${esc(t.heading || '')}" data-block="${esc(t.block || '')}"`;
  return `<a class="${cls}" ${attrs}>${esc(display)}</a>`;
}

function calloutIconSvg(name) {
  return iconSvg(name, 'icon', 16);
}

/* Custom renderers over marked's object syntax. */
marked.use({
  renderer: {
    heading(token) {
      const text = this.parser.parseInline(token.tokens);
      const id = 'h-' + slugify(token.text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*`~=]/g, ''));
      return `<h${token.depth} id="${id}">${text}</h${token.depth}>`;
    },
    code(token) {
      const lang = (token.lang || '').split(/\s/)[0];
      const id = codeStore.push(token.text) - 1;
      const body = esc(token.text);
      const head = `<div class="code-head"><span class="code-lang">${esc(lang || 'text')}</span><span class="copy-btn" data-code="${id}">Copy</span></div>`;
      return `<div class="code-block">${head}<pre><code>${body}</code></pre></div>`;
    },
    blockquote(token) {
      // Detect callout: first raw line starts with [!type]
      const firstLine = (token.raw || '').split('\n')[0];
      const m = /^>\s*\[!(\w+)\]([+-])?\s*(.*)$/.exec(firstLine.trim());
      if (!m) return `<blockquote>${this.parser.parse(token.tokens)}</blockquote>`;
      const type = m[1].toLowerCase();
      const def = CALLOUTS[type] || { label: m[1], color: 'var(--accent)', icon: 'info' };
      const foldable = m[2] === '-' || m[2] === '+';
      const startOpen = m[2] !== '-';
      const title = m[3].trim();
      const bodyRaw = (token.raw || '').split('\n').slice(1).join('\n').replace(/^>\s?/gm, '');
      const body = bodyRaw.trim() ? marked.parse(bodyRaw) : '';
      const fold = foldable ? ` data-fold="${startOpen ? 'open' : 'closed'}"` : '';
      return `<div class="callout" data-callout="${type}" style="--callout-clr:${def.color}"${fold}>
        <div class="callout-title">${calloutIconSvg(def.icon)}<span>${esc(title || def.label)}</span></div>
        <div class="callout-body"${foldable && !startOpen ? ' style="display:none"' : ''}>${body}</div>
      </div>`;
    },
    link(token) {
      const text = this.parser.parseInline(token.tokens);
      const href = token.href || '';
      if (/^https?:\/\//i.test(href)) {
        return `<a class="external-link" href="${esc(href)}" data-external="1">${text}</a>`;
      }
      const clean = decodeURIComponent(href.replace(/^\.\//, '').replace(/\.md$/i, ''));
      return `<a class="internal-link" data-target="${esc(clean)}" data-heading="">${text}</a>`;
    },
    image(token) {
      let src = token.href || '';
      if (!/^[a-z][a-z0-9+.-]*:/i.test(src)) {
        const r = renderCtx && renderCtx.resolve ? renderCtx.resolve(decodeURIComponent(src.replace(/^\.\//, '')), renderCtx.fromPath) : null;
        if (r && r.file) src = renderCtx.assetUrl(r.file);
        else if (renderCtx) src = renderCtx.assetUrl(decodeURIComponent(src.replace(/^\.\//, '')));
      }
      return `<img src="${esc(src)}" alt="${esc(token.text || '')}">`;
    },
    checkbox(token) {
      return `<input type="checkbox" ${token.checked ? 'checked' : ''}>`;
    },
  },
});

configure();

/* ------------------------------------------------------------ public API */

export function renderMarkdown(content, ctx = {}) {
  const outerStore = codeStore;
  codeStore = [];
  renderCtx = {
    resolve: ctx.resolve || (() => ({ file: null })),
    getNote: ctx.getNote || null,
    fromPath: ctx.fromPath || '',
    assetUrl: ctx.assetUrl || 'data:,',
    depth: ctx.depth || 0,
  };
  const fm = splitFrontmatter(content);
  let html = marked.parse(fm.body || '');
  // re-enable task checkboxes (marked renders them disabled)
  html = html.replace(/<input( [^>]*?)type="checkbox"( [^>]*?)?( disabled)?>/g, (m, a = '', b = '') => `<input${a}type="checkbox"${b}>`);
  let props = '';
  if (fm.properties && Object.keys(fm.properties).length) {
    const rows = Object.entries(fm.properties)
      .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${Array.isArray(v) ? v.map(x => `<span class="prop-badge">${esc(x)}</span>`).join(' ') : esc(v)}</td></tr>`)
      .join('');
    props = `<table class="properties">${rows}</table>`;
  }
  renderCtx = null;
  const store = codeStore;
  codeStore = outerStore;
  return { html: props + html, codeStore: store };
}

export function splitFrontmatter(text) {
  if (!/^---\r?\n/.test(text)) return { body: text, properties: null };
  const m = /\r?\n---\s*(\r?\n|$)/.exec(text.slice(3));
  if (!m) return { body: text, properties: null };
  const yaml = text.slice(4, 3 + m.index);
  const body = text.slice(3 + m.index + m[0].length);
  const properties = {};
  let key = null;
  for (const line of yaml.split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (kv) {
      key = kv[1];
      const val = kv[2].trim();
      if (/^\[.*\]$/.test(val)) properties[key] = val.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      else if (val) properties[key] = val.replace(/^["']|["']$/g, '');
      else properties[key] = [];
    } else if (/^\s+-\s+/.test(line) && key && Array.isArray(properties[key])) {
      properties[key].push(line.replace(/^\s+-\s+/, '').trim().replace(/^["']|["']$/g, ''));
    }
  }
  return { body, properties };
}

/* Attach interactions to rendered preview HTML. */
export function wirePreview(container, handlers) {
  const { onInternalLink, onExternalLink, onTag, onToggleTask } = handlers;
  const getCodeStore = typeof handlers.codeStore === 'function' ? handlers.codeStore : () => handlers.codeStore || [];
  container.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (a) {
      if (a.dataset.external) { e.preventDefault(); onExternalLink(a.getAttribute('href')); return; }
      if (a.classList.contains('internal-link')) {
        e.preventDefault();
        onInternalLink(a.dataset.target, a.dataset.heading, a.dataset.block, e.ctrlKey);
        return;
      }
      e.preventDefault();
    }
    const tag = e.target.closest('.tag');
    if (tag) { onTag(tag.dataset.tag); return; }
    const open = e.target.closest('[data-open]');
    if (open) { onInternalLink(open.dataset.open, '', '', e.ctrlKey); return; }
    const copy = e.target.closest('.copy-btn');
    if (copy) {
      const idx = Number(copy.dataset.code);
      const code = getCodeStore()[idx] != null ? getCodeStore()[idx] : '';
      navigator.clipboard?.writeText(code).catch(() => {});
      copy.textContent = 'Copied!';
      setTimeout(() => { copy.textContent = 'Copy'; }, 1200);
      return;
    }
    const ct = e.target.closest('.callout-title');
    if (ct && ct.parentElement.dataset.fold) {
      const body = ct.nextElementSibling;
      const callout = ct.parentElement;
      if (body) {
        const open = body.style.display !== 'none';
        body.style.display = open ? 'none' : '';
        callout.dataset.fold = open ? 'closed' : 'open';
      }
      return;
    }
    const cb = e.target.closest('input[type="checkbox"]');
    if (cb) {
      const idx = [...container.querySelectorAll('input[type="checkbox"]')].indexOf(cb);
      if (idx >= 0) onToggleTask(idx, cb.checked);
    }
  });
}

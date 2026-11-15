/*
 * Live-preview decoration builder — the "obsidian look" while editing:
 * styles headings/lists/quotes, hides markdown syntax on inactive lines and
 * replaces links/images/math/tasks with interactive widgets.
 */
import { Decoration, ViewPlugin } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { isImage, stripMd, baseName } from '../../shared/links.cjs';
import { CALLOUTS } from '../../lib/markdown.js';
import { assetUrl } from '../../lib/ipc.js';
import {
  CheckboxWidget, ImgWidget, EmbedWidget, MathWidget, CalloutHeaderWidget, CopyCodeWidget,
} from './widgets.js';

/* ViewPlugin that recomputes decorations on every update (cheap: viewport-bounded). */
export function livePreviewPlugin(ctx) {
  return ViewPlugin.fromClass(
    class {
      constructor(view) { this.decorations = safeBuild(view, ctx); }
      update(u) { this.decorations = safeBuild(u.view, ctx); }
    },
    { decorations: (v) => v.decorations },
  );
}

function safeBuild(view, ctx) {
  try {
    return Decoration.set(build(view, ctx), true);
  } catch (e) {
    console.error('live preview decoration build failed:', e);
    return Decoration.none;
  }
}

export function build(view, ctx) {
  const deco = [];
  const state = view.state;
  const doc = state.doc;
  const activeLine = state.selection.main.head;

  // --- code ranges (from the lezer tree, block-level only) ---
  const codeRanges = [];      // [blockFrom, blockTo]
  const codeContent = [];     // [contentFrom, contentTo]
  try {
    syntaxTree(state).iterate({
      enter(node) {
        if (node.name === 'FencedCode' || node.name === 'CodeBlock') {
          codeRanges.push([node.from, node.to]);
          const first = doc.lineAt(node.from);
          const last = doc.lineAt(node.to);
          codeContent.push([Math.min(first.to + 1, node.to), Math.max(first.to + 1, last.from - 1)]);
        }
      },
    });
  } catch { /* tree unavailable */ }
  const inCode = (pos) => codeRanges.some(([a, b]) => pos >= a && pos < b);

  // --- frontmatter range ---
  let fmEnd = -1;
  if (doc.lines >= 2 && doc.line(1).text.trim() === '---') {
    for (let n = 2; n <= Math.min(doc.lines, 200); n++) {
      if (doc.line(n).text.trim() === '---') { fmEnd = n; break; }
    }
  }

  // active-line predicate
  const isActive = (lineFrom, lineTo) => activeLine >= lineFrom && activeLine <= lineTo;

  const vpFrom = view.visibleRanges.length ? view.visibleRanges[0].from : 0;
  const vpTo = view.visibleRanges.length ? view.visibleRanges[view.visibleRanges.length - 1].to : doc.length;
  const firstLine = doc.lineAt(vpFrom).number;
  const lastLine = doc.lineAt(vpTo).number;

  // track callout state across lines
  let calloutActive = null; // {type, firstLine}

  for (let n = firstLine; n <= lastLine; n++) {
    const line = doc.line(n);
    const text = line.text;

    // ---- frontmatter ----
    if (fmEnd > 0 && n <= fmEnd) {
      deco.push(Decoration.line({ class: 'bs-fm-line' }).range(line.from));
      continue;
    }

    // ---- fenced code ----
    if (inCode(line.from)) {
      deco.push(Decoration.line({ class: 'bs-codeline' }).range(line.from));
      continue;
    }

    // ---- horizontal rule ----
    if (/^(\s{0,3})(-{3,}|\*{3,}|_{3,})\s*$/.test(text)) {
      deco.push(Decoration.line({ class: 'bs-hr' }).range(line.from));
      continue;
    }

    // ---- heading ----
    let contentStart = line.from;
    let inlineText = text;
    const hm = /^(\s{0,3})(#{1,6})(\s+)(.*)$/.exec(text);
    if (hm) {
      const level = hm[2].length;
      deco.push(Decoration.line({ class: 'bs-h' + level }).range(line.from));
      if (!isActive(line.from, line.to)) {
        deco.push(Decoration.mark({ class: 'bs-syntax bs-hidden' }).range(line.from + hm[1].length, line.from + hm[1].length + hm[2].length + 1));
      } else {
        deco.push(Decoration.mark({ class: 'bs-syntax' }).range(line.from + hm[1].length, line.from + hm[1].length + hm[2].length + 1));
      }
      contentStart = line.from + hm[0].length - hm[4].length;
      inlineText = hm[4];
    }

    // ---- blockquote / callout ----
    const qm = /^(\s{0,3})>(\s?)(.*)$/.exec(text);
    if (qm) {
      const body = qm[3];
      const cm = /^\[!(\w+)\]([+-])?\s*(.*)$/.exec(body);
      if (cm) {
        calloutActive = { type: cm[1].toLowerCase(), title: cm[3], hasWidget: true };
        const def = CALLOUTS[calloutActive.type] || { color: 'var(--accent)' };
        deco.push(Decoration.line({
          class: 'bs-callout bs-quote',
          attributes: { style: `--callout-clr:${def.color}` },
        }).range(line.from));
        if (!isActive(line.from, line.to)) {
          const from = line.from + qm[1].length;
          const to = line.from + qm[0].length - (cm[3] ? 0 : 0);
          // replace "> [!type] title" up to end of that segment
          deco.push(Decoration.replace({
            widget: new CalloutHeaderWidget(calloutActive.type, calloutActive.title),
          }).range(from, line.to));
        }
      } else {
        deco.push(Decoration.line({
          class: 'bs-quote' + (calloutActive ? ' bs-callout' : ''),
          attributes: calloutActive ? { style: `--callout-clr:${(CALLOUTS[calloutActive.type] || {}).color || 'var(--accent)'}` } : {},
        }).range(line.from));
        // hide the "> " when inactive
        if (!isActive(line.from, line.to) && qm[2] !== undefined) {
          deco.push(Decoration.mark({ class: 'bs-syntax bs-hidden' }).range(line.from + qm[1].length, line.from + qm[1].length + 1 + qm[2].length));
        }
      }
      // blockquote body: no list/inline except scan inline
      scanInline(deco, state, ctx, line, qm[3], line.from + qm[1].length + 1 + qm[2].length, isActive, activeLine, inCode);
      continue;
    } else if (calloutActive) {
      // continuation lines "lazy" without > end the callout
      calloutActive = null;
    }

    // ---- list item ----
    const lm = /^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\](\s+))?(.*)$/.exec(text);
    if (lm) {
      const bulletFrom = line.from + lm[1].length;
      const bulletTo = bulletFrom + lm[2].length;
      if (lm[4]) {
        // task item — checkbox widget replaces "[ ]"
        const taskFrom = bulletTo + lm[3].length;
        const checked = /\[[xX]\]/.test(lm[4]);
        deco.push(Decoration.replace({ widget: new CheckboxWidget(checked, taskFrom) }).range(taskFrom, taskFrom + 3));
        if (checked) {
          deco.push(Decoration.mark({ class: 'bs-task-done' }).range(taskFrom + 3 + lm[5].length, line.to));
        }
      } else {
        deco.push(Decoration.mark({
          class: 'bs-listmark' + (isActive(line.from, line.to) ? '' : ' bs-hidden'),
        }).range(bulletFrom, bulletTo + lm[3].length));
      }
      scanInline(deco, state, ctx, line, lm[6], line.from + lm[0].length - lm[6].length, isActive, activeLine, inCode);
      continue;
    }

    // ---- plain line: inline scan ----
    scanInline(deco, state, ctx, line, inlineText, contentStart, isActive, activeLine, inCode);
  }

  // copy buttons for fenced code blocks (end of first line of each block)
  for (const [i, [from]] of codeRanges.entries()) {
    if (from >= vpFrom - 2000 && from <= vpTo + 2000) {
      const l = doc.lineAt(from);
      const [cFrom, cTo] = codeContent[i];
      deco.push(Decoration.widget({ widget: new CopyCodeWidget(cFrom, cTo), side: 1 }).range(Math.min(l.to, doc.length)));
    }
  }

  return deco;
}

/* ------------------------------------------------------------------ inline */

const INLINE_PATTERNS = [
  { re: /!\[\[([^\[\]\n]+)\]\]/y, type: 'embedwiki' },
  { re: /\[\[([^\[\]\n]+)\]\]/y, type: 'wiki' },
  { re: /!\[([^\]\n]*)\]\(\s*<?([^)\s<>]+)>?[^\)]*\)/y, type: 'mdimg' },
  { re: /\[([^\]\n]*)\]\(\s*<?([^)\s<>]+)>?[^\)]*\)/y, type: 'mdlink' },
  { re: /`([^`\n]+)`/y, type: 'icode' },
  { re: /\$\$([^$]+?)\$\$/y, type: 'bmath' },
  { re: /\$([^$\n]+?)\$/y, type: 'imath' },
  { re: /==([^=\n]+)==/y, type: 'hl' },
  { re: /\*\*([^*\n]+?)\*\*/y, type: 'strong' },
  { re: /__([^_\n]+?)__/y, type: 'strong2' },
  { re: /\*([^*\n]+?)\*/y, type: 'em' },
  { re: /_([^_\n]+?)_/y, type: 'em2' },
  { re: /(?:^|(?<=\s))(#[\p{L}_][\p{L}\p{N}_\/-]*)/yu, type: 'tag' },
];

function scanInline(deco, state, ctx, line, text, offset, isActive, activeLine, inCode) {
  if (!text) return;
  const doc = state.doc;
  const active = isActive(line.from, line.to);

  const pushHidden = (from, to) => deco.push(Decoration.mark({ class: 'bs-syntax bs-hidden' }).range(from, to));
  const pushSyntax = (from, to) => deco.push(Decoration.mark({ class: 'bs-syntax' }).range(from, to));

  let pos = 0;
  const guardEnd = text.length;
  let guard = 0;
  while (pos < guardEnd && guard++ < 4000) {
    let matched = null, mType = null;
    for (const p of INLINE_PATTERNS) {
      p.re.lastIndex = pos;
      const m = p.re.exec(text);
      if (m && m.index === pos) { matched = m; mType = p.type; break; }
    }
    if (!matched) { pos++; continue; }
    const from = offset + matched.index;
    const to = offset + matched.index + matched[0].length;

    switch (mType) {
      case 'embedwiki': {
        const inner = matched[1].trim();
        const r = ctx.resolve(inner, ctx.getPath());
        if (!active) {
          let target = inner, heading = '', block = '';
          const hash = target.indexOf('#');
          if (hash >= 0) { const f = target.slice(hash + 1); target = target.slice(0, hash); if (f.startsWith('^')) block = f.slice(1); else heading = f; }
          if (r && r.file && isImage(r.file)) {
            deco.push(Decoration.replace({ widget: new ImgWidget(assetUrl(r.file), stripMd(baseName(r.file))) }).range(from, to));
            pos = matched.index + matched[0].length;
            continue;
          }
          const html = r && r.file ? ctx.renderEmbed(r.file, heading, block) : null;
          deco.push(Decoration.replace({
            widget: new EmbedWidget(html || '', (r && r.file) ? stripMd(baseName(r.file)) : inner, r && r.file ? r.file : '', !html),
          }).range(from, to));
        } else {
          deco.push(Decoration.mark({ class: 'bs-math-raw bs-embed-raw' }).range(from, to));
        }
        break;
      }
      case 'wiki': {
        const inner = matched[1];
        const pipe = inner.indexOf('|');
        const target = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim();
        const alias = pipe >= 0 ? inner.slice(pipe + 1).trim() : null;
        const r = ctx.resolve(target, ctx.getPath());
        const hash = target.indexOf('#');
        let linkTarget = target, heading = '';
        if (hash >= 0) { linkTarget = target.slice(0, hash); heading = target.slice(hash + 1); }
        deco.push(Decoration.mark({
          class: 'bs-wikilink' + (r && r.file ? '' : ' unresolved'),
          attributes: {
            'data-target': linkTarget || '',
            'data-heading': heading || '',
            'data-block': heading.startsWith('^') ? heading.slice(1) : '',
          },
        }).range(from, to));
        if (!active) {
          if (alias != null) {
            // hide "[[target|" and "]]"
            pushHidden(from, from + 2 + (pipe >= 0 ? inner.slice(0, pipe).length : 0) + 1);
            pushHidden(to - 2, to);
          } else {
            pushHidden(from, from + 2);
            pushHidden(to - 2, to);
          }
        } else {
          pushSyntax(from, from + 2);
          pushSyntax(to - 2, to);
        }
        break;
      }
      case 'mdimg': {
        if (!active) {
          const href = matched[2];
          if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
            deco.push(Decoration.replace({ widget: new ImgWidget(href, matched[1]) }).range(from, to));
          } else {
            const r = ctx.resolve(href, ctx.getPath());
            if (r && r.file) {
              deco.push(Decoration.replace({ widget: new ImgWidget(assetUrl(r.file), matched[1] || '') }).range(from, to));
            } else {
              deco.push(Decoration.mark({ class: 'bs-inlinecode' }).range(from, to));
            }
          }
        } else {
          deco.push(Decoration.mark({ class: 'bs-math-raw' }).range(from, to));
        }
        break;
      }
      case 'mdlink': {
        const href = matched[2];
        const isExt = /^[a-z][a-z0-9+.-]*:/i.test(href);
        deco.push(Decoration.mark({
          class: isExt ? 'bs-link-ext' : 'bs-internallink',
          attributes: isExt
            ? { 'data-external': href }
            : { 'data-target': decodeURIComponent(href.replace(/^\.\//, '').replace(/\.md$/i, '')) },
        }).range(from, to));
        if (!active) {
          pushHidden(from, from + 1);
          pushHidden(from + 1 + matched[1].length, to);
        }
        break;
      }
      case 'icode': {
        deco.push(Decoration.mark({ class: 'bs-inlinecode' }).range(from + 1, to - 1));
        if (!active) { pushHidden(from, from + 1); pushHidden(to - 1, to); }
        break;
      }
      case 'bmath':
      case 'imath': {
        if (!active) {
          deco.push(Decoration.replace({ widget: new MathWidget(matched[1], mType === 'bmath') }).range(from, to));
        } else {
          deco.push(Decoration.mark({ class: 'bs-math-raw' }).range(from, to));
        }
        break;
      }
      case 'hl': {
        deco.push(Decoration.mark({ class: 'bs-highlight' }).range(from + 2, to - 2));
        if (!active) { pushHidden(from, from + 2); pushHidden(to - 2, to); }
        scanInline(deco, state, ctx, line, matched[1], from + 2, isActive, activeLine, inCode);
        break;
      }
      case 'strong':
      case 'strong2': {
        deco.push(Decoration.mark({ class: 'bs-strong' }).range(from + 2, to - 2));
        if (!active) { pushHidden(from, from + 2); pushHidden(to - 2, to); }
        scanInline(deco, state, ctx, line, matched[1], from + 2, isActive, activeLine, inCode);
        break;
      }
      case 'em':
      case 'em2': {
        deco.push(Decoration.mark({ class: 'bs-em' }).range(from + 1, to - 1));
        if (!active) { pushHidden(from, from + 1); pushHidden(to - 1, to); }
        scanInline(deco, state, ctx, line, matched[1], from + 1, isActive, activeLine, inCode);
        break;
      }
      case 'tag': {
        const tag = matched[1];
        if (tag.startsWith('#')) {
          deco.push(Decoration.mark({ class: 'bs-tag', attributes: { 'data-tag': tag.slice(1) } }).range(from, to));
        }
        break;
      }
    }
    pos = matched.index + matched[0].length;
  }
}

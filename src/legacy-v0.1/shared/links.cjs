/*
 * obsidian shared note-scanning engine.
 * Plain CommonJS so the Electron main process can require() it and the
 * esbuild renderer bundle can import it. No DOM, no Node-specific APIs —
 * pure functions over strings so it runs anywhere.
 */
'use strict';

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif']);
const AUDIO_EXT = new Set(['.mp3', '.wav', '.ogg', '.m4a', 'flac', '.webm']);
const MD_EXT = new Set(['.md', '.markdown']);

function extOf(p) {
  const i = p.lastIndexOf('.');
  return i < 0 ? '' : p.slice(i).toLowerCase();
}
function isMarkdown(p) { return MD_EXT.has(extOf(p)); }
function isImage(p) { return IMAGE_EXT.has(extOf(p)); }
function baseName(p) {
  const seg = p.split('/');
  return seg[seg.length - 1];
}
function stripMd(p) {
  return p.replace(/\.(md|markdown)$/i, '');
}
function dirName(p) {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}
function joinPath(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a + '/' + b;
}

/* Replace code spans/blocks with spaces so scanners ignore them,
 * preserving length and newlines so line numbers stay correct. */
function stripCode(text) {
  let out = '';
  const lines = text.split('\n');
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      out += ' '.repeat(line.length) + '\n';
      continue;
    }
    if (inFence) { out += ' '.repeat(line.length) + '\n'; continue; }
    out += line.replace(/`[^`]*`/g, m => ' '.repeat(m.length)) + '\n';
  }
  return out;
}

/* Minimal frontmatter parse: returns {raw, body, aliases, title, fmTags}. */
function parseFrontmatter(text) {
  const res = { raw: '', body: text, aliases: [], title: null, fmTags: [] };
  if (!/^---\r?\n/.test(text)) return res;
  const m = /\r?\n---\s*(\r?\n|$)/.exec(text.slice(3));
  if (!m) return res;
  const end = 3 + m.index + m[0].length;
  res.raw = text.slice(0, end);
  res.body = text.slice(end);
  const yaml = text.slice(4, 3 + m.index);
  const lines = yaml.split(/\r?\n/);
  let key = null;
  for (const line of lines) {
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (kv) {
      key = kv[1].toLowerCase();
      const val = kv[2].trim();
      if (key === 'aliases' || key === 'alias') {
        const arr = /^\[(.*)\]$/.exec(val);
        if (arr) res.aliases.push(...arr[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean));
        else if (val && !/^\.\.\.$/.test(val)) res.aliases.push(val.replace(/^["']|["']$/g, ''));
      } else if (key === 'tags' || key === 'tag') {
        const arr = /^\[(.*)\]$/.exec(val);
        if (arr) res.fmTags.push(...arr[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, '').replace(/^#/, '')).filter(Boolean));
        else if (val) res.fmTags.push(val.replace(/^["']|["']$/g, '').replace(/^#/, ''));
      } else if (key === 'title' && val) {
        res.title = val.replace(/^["']|["']$/g, '');
      } else if (val) {
        key = null;
      }
    } else if (/^\s+-\s+/.test(line) && (key === 'aliases' || key === 'alias')) {
      const v = line.replace(/^\s+-\s+/, '').trim().replace(/^["']|["']$/g, '');
      if (v) res.aliases.push(v);
    } else if (/^\s+-\s+/.test(line) && (key === 'tags' || key === 'tag')) {
      const v = line.replace(/^\s+-\s+/, '').trim().replace(/^["']|["']$/g, '').replace(/^#/, '');
      if (v) res.fmTags.push(v);
    } else if (line.trim() === '') { /* keep */ }
    else { key = null; }
  }
  return res;
}

function slugify(text) {
  return text.toLowerCase().trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');
}

/*
 * Scan one markdown note.
 * Returns { links, tags, headings, aliases, title, blocks }
 *  links:   [{ raw, target, heading, block, embed, line, alias }]
 *  tags:    unique tag strings (without leading #)
 *  headings:[{ level, text, slug, line }]
 *  blocks:  [{ id, line }]  (^block-id definitions)
 */
function scanNote(text) {
  const fm = parseFrontmatter(text);
  const clean = stripCode(fm.body);
  const bodyOffset = fm.raw ? fm.raw.split('\n').length - 1 : 0;
  const links = [];
  const tags = new Set();
  const headings = [];
  const blocks = [];

  const lines = clean.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = bodyOffset + i + 1; // 1-based line in the original file

    // Headings
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) headings.push({ level: h[1].length, text: h[2].trim(), slug: slugify(h[2]), line: lineNo });

    // Wikilinks / embeds  [[target]] [[target|alias]] [[t#head]] [[t^block]] ![[...]]
    let re = /!?\[\[([^\[\]\n]+)\]\]/g;
    let m;
    while ((m = re.exec(line))) {
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
        if (frag.startsWith('^')) block = frag.slice(1);
        else heading = frag;
      }
      if (!inner && !heading && !block) continue;
      links.push({ raw: m[0], target: inner, heading, block, embed, line: lineNo, alias });
    }

    // Markdown links → internal only when target isn't a URL/anchor-only
    re = /\[([^\]\n]*)\]\(([^)\n]*)\)/g;
    while ((m = re.exec(line))) {
      let hrefRaw = m[2].trim();
      let href;
      if (hrefRaw.startsWith('<')) href = hrefRaw.slice(1, hrefRaw.indexOf('>') >= 0 ? hrefRaw.indexOf('>') : hrefRaw.length).trim();
      else href = hrefRaw.split(/\s+/)[0];
      if (!href) continue;
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) continue; // http:, mailto:, etc.
      if (href.startsWith('#')) continue;
      links.push({ raw: m[0], target: decodeURIComponent(href), heading: null, block: null, embed: false, line: lineNo, alias: m[1] || null, mdStyle: true });
    }

    // Tags #tag or #nested/tag — not headings (headings consumed above by ^#\s),
    // avoid pure numbers (#5) and require word start
    re = /(^|[\s(\[])#([\p{L}_][\p{L}\p{N}_\/-]*)/gu;
    while ((m = re.exec(line))) tags.add(m[2]);

    // Block id definitions  ... ^block-id
    const b = /\^([A-Za-z0-9-]+)\s*$/.exec(line);
    if (b) blocks.push({ id: b[1], line: lineNo });
  }
  return { links, tags: [...new Set([...tags, ...fm.fmTags])], headings, aliases: fm.aliases, title: fm.title, blocks, frontmatter: fm.raw };
}

/*
 * Resolve a link target (wikilink or md-style) against the vault index.
 * index = { byPath: Map<path, {isFolder}>, byName: Map<basename, path[]> }
 * Returns { file, heading, block } or { file: null, heading, block }.
 */
function resolveTarget(target, fromPath, index) {
  let t = (target || '').trim();
  if (!t) return { file: null };
  let heading = null, block = null;
  const hash = t.indexOf('#');
  if (hash >= 0) {
    let frag = t.slice(hash + 1);
    t = t.slice(0, hash);
    if (frag.startsWith('^')) block = frag.slice(1); else heading = decodeURIComponent(frag);
  }
  const norm = t.replace(/\\/g, '/');
  let file = null;
  if (!norm) {
    file = fromPath || null;
  } else {
    // 1) exact path (with or without .md)
    if (index.byPath.has(norm)) file = norm;
    else if (index.byPath.has(norm + '.md')) file = norm + '.md';
    else if (index.byPath.has(norm + '.markdown')) file = norm + '.markdown';
    else {
      // 2) unique basename (try with and without extension keys)
      const base = baseName(norm);
      const cands = [...(index.byName.get(base) || []), ...(index.byName.get(base + '.md') || [])]
        .filter(p => isMarkdown(p));
      const uniq = [...new Set(cands)];
      if (uniq.length === 1) file = uniq[0];
      else if (uniq.length > 1) {
        // prefer same-folder match, then shortest path
        const sameDir = uniq.filter(p => dirName(p) === dirName(fromPath));
        const pool = sameDir.length ? sameDir : uniq;
        file = pool.slice().sort((a, b) => a.length - b.length)[0];
      }
    }
  }
  return { file, heading, block };
}

/*
 * Rewrite all links pointing at oldPath so they point at newPath.
 * Returns { content, count }.
 */
function rewriteLinks(content, oldPath, newPath, index) {
  let count = 0;
  const oldNoExt = stripMd(oldPath);
  const newNoExt = stripMd(newPath);
  const newBase = stripMd(baseName(newPath));

  const pointsToOld = (target, fromPath) => {
    const r = resolveTarget(target, fromPath, index);
    return r.file === oldPath;
  };

  // Wikilinks
  let out = content.replace(/(!?)\[\[([^\[\]\n]+)\]\]/g, (full, bang, inner) => {
    const pipe = inner.indexOf('|');
    let target = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim();
    const rest = pipe >= 0 ? inner.slice(pipe) : '';
    if (!pointsToOld(target, '__from__')) return full;
    // Rebuild using just the basename (obsidian "shortest path" default)
    const rebuilt = `${bang}[[${newBase}${rest}]]`;
    if (rebuilt !== full) count++;
    return rebuilt;
  });

  // Markdown-style links [text](target)
  out = out.replace(/\[([^\]\n]*)\]\(([^)\n]*)\)/g, (full, text, raw2) => {
    let hrefRaw = raw2.trim();
    let href;
    if (hrefRaw.startsWith('<')) href = hrefRaw.slice(1, hrefRaw.indexOf('>') >= 0 ? hrefRaw.indexOf('>') : hrefRaw.length).trim();
    else href = hrefRaw.split(/\s+/)[0];
    if (!href) return full;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href) || href.startsWith('#')) return full;
    if (!pointsToOld(decodeURIComponent(href), '__from__')) return full;
    const frag = href.indexOf('#') >= 0 ? href.slice(href.indexOf('#')) : '';
    const rebuilt = `[${text}](<${newBase}${frag}>)`;
    if (rebuilt !== full) count++;
    return rebuilt;
  });
  return { content: out, count };
}

module.exports = {
  IMAGE_EXT, MD_EXT, extOf, isMarkdown, isImage, baseName, stripMd, dirName, joinPath,
  stripCode, parseFrontmatter, slugify, scanNote, resolveTarget, rewriteLinks
};

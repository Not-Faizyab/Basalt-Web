/* Editor widgets for the live preview: checkboxes, images, embeds, math, callout headers. */
import { EditorView, Decoration, WidgetType } from '@codemirror/view';
import { iconSvg } from '../../lib/icon-paths.js';
import { CALLOUTS } from '../../lib/markdown.js';

class CheckboxWidget extends WidgetType {
  constructor(checked, pos) { super(); this.checked = checked; this.pos = pos; }
  eq(other) { return other.checked === this.checked && other.pos === this.pos; }
  toDOM() {
    const wrap = document.createElement('span');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'bs-checkbox';
    if (this.checked) input.checked = true;
    input.dataset.pos = String(this.pos);
    wrap.append(input);
    return wrap;
  }
  ignoreEvent() { return false; }
}

class ImgWidget extends WidgetType {
  constructor(url, alt) { super(); this.url = url; this.alt = alt; }
  eq(o) { return o.url === this.url && o.alt === this.alt; }
  toDOM(view) {
    const wrap = document.createElement('span');
    const img = document.createElement('img');
    img.className = 'bs-img-widget';
    img.src = this.url;
    img.alt = this.alt || '';
    img.loading = 'lazy';
    img.addEventListener('error', () => {
      wrap.innerHTML = '';
      const err = document.createElement('span');
      err.className = 'bs-img-error';
      err.textContent = '⚠ image not found' + (this.alt ? `: ${this.alt}` : '');
      wrap.append(err);
    });
    wrap.append(img);
    return wrap;
  }
  ignoreEvent() { return false; }
}

class EmbedWidget extends WidgetType {
  constructor(html, title, path, missing) { super(); this.html = html; this.title = title; this.path = path; this.missing = missing; this.key = html + '|' + path + '|' + (missing ? 1 : 0); }
  eq(o) { return o.key === this.key; }
  toDOM() {
    const wrap = document.createElement('span');
    wrap.className = 'bs-embed-widget';
    if (this.missing) {
      wrap.textContent = this.title;
      wrap.style.opacity = '0.6';
      wrap.style.fontStyle = 'italic';
      return wrap;
    }
    const head = document.createElement('span');
    head.className = 'embed-title';
    head.innerHTML = iconSvg('link', 'icon', 12) + '<span class="embed-title-text"></span>';
    head.querySelector('.embed-title-text').textContent = this.title;
    const body = document.createElement('div');
    body.className = 'embed-body';
    body.innerHTML = this.html;
    wrap.append(head, body);
    return wrap;
  }
  ignoreEvent() { return false; }
}

class MathWidget extends WidgetType {
  constructor(tex, display) { super(); this.tex = tex; this.display = display; }
  eq(o) { return o.tex === this.tex && o.display === this.display; }
  toDOM() {
    const wrap = document.createElement('span');
    import('katex').then(({ default: katex }) => {
      try {
        wrap.innerHTML = katex.renderToString(this.tex, { throwOnError: false, displayMode: this.display, output: 'html' });
      } catch {
        wrap.textContent = this.tex;
      }
    });
    return wrap;
  }
  ignoreEvent() { return false; }
}

class CalloutHeaderWidget extends WidgetType {
  constructor(type, title) { super(); this.type = type; this.title = title; this.key = type + '|' + title; }
  eq(o) { return o.key === this.key; }
  toDOM() {
    const def = CALLOUTS[this.type] || { label: this.type, icon: 'info', color: 'var(--accent)' };
    const wrap = document.createElement('span');
    wrap.className = 'bs-callout-title';
    wrap.style.setProperty('--callout-clr', def.color);
    wrap.innerHTML = iconSvg(def.icon, 'icon', 15) + '<span></span>';
    wrap.querySelector('span:last-child').textContent = this.title || def.label;
    return wrap;
  }
  ignoreEvent() { return false; }
}

class CopyCodeWidget extends WidgetType {
  constructor(from, to) { super(); this.from = from; this.to = to; }
  eq(o) { return o.from === this.from && o.to === this.to; }
  toDOM() {
    const wrap = document.createElement('span');
    wrap.className = 'bs-code-btn';
    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.dataset.from = String(this.from);
    btn.dataset.to = String(this.to);
    btn.textContent = 'Copy';
    wrap.append(btn);
    return wrap;
  }
  ignoreEvent() { return false; }
}

export function widgetDeco(cls, widget, from, to) {
  return Decoration.replace({ class: cls, widget }).range(from, to);
}
export { CheckboxWidget, ImgWidget, EmbedWidget, MathWidget, CalloutHeaderWidget, CopyCodeWidget };

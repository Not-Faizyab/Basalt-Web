/*
 * Settings modal: Appearance / Editor / Files & links / Daily notes / Hotkeys / Privacy / About.
 */
import { h, clear, icon, bus } from '../lib/dom.js';
import { settings, saveSettings, applyAppearance } from '../lib/state.js';
import { App } from '../lib/app-context.js';
import { modal } from './ui.js';
import { fuzzyRank } from '../lib/fuzzy.js';

const SECTIONS = [
  { id: 'appearance', label: 'Appearance', icon: 'eye' },
  { id: 'editor', label: 'Editor', icon: 'pencil' },
  { id: 'files', label: 'Files & links', icon: 'file' },
  { id: 'daily', label: 'Daily notes', icon: 'calendar' },
  { id: 'hotkeys', label: 'Hotkeys', icon: 'command' },
  { id: 'privacy', label: 'Privacy', icon: 'shield' },
  { id: 'about', label: 'About', icon: 'info' },
];

export function openSettings(section = 'appearance') {
  const nav = h('div', { class: 'settings-nav' });
  const body = h('div', { class: 'settings-body' });

  const m = modal({
    title: 'Settings',
    iconName: 'settings',
    width: 760,
    body: h('div', { class: 'row', style: { minHeight: '420px', maxHeight: '62vh', margin: '-14px -16px' } }, nav, body),
  });
  m.box.style.maxWidth = '92vw';

  function show(id) {
    for (const s of SECTIONS) s._el?.classList.toggle('active', s.id === id);
    clear(body);
    renderers[id]?.(body);
  }
  for (const s of SECTIONS) {
    s._el = h('div', { class: 'nav-item', onclick: () => show(s.id) }, icon(s.icon), h('span', {}, s.label));
    nav.append(s._el);
  }
  show(section);

  const onAppearance = bus.on('appearance-changed', () => { /* colors update via CSS vars */ });
  const origClose = m.close.bind(m);
  m.close = () => { onAppearance(); origClose(); };
  return m;
}

/* ------------------------------------------------------------ builders */

function row(name, desc, control) {
  return h('div', { class: 'setting-row' },
    h('div', { class: 's-info' },
      h('div', { class: 's-name' }, name),
      desc ? h('div', { class: 's-desc' }, desc) : null),
    control);
}

const renderers = {
  appearance(body) {
    body.append(h('h2', {}, 'Appearance'));
    const themeSel = h('select', {},
      h('option', { value: 'dark' }, 'Dark'),
      h('option', { value: 'light' }, 'Light'));
    themeSel.value = settings.appearance.theme;
    themeSel.addEventListener('change', () => { settings.appearance.theme = themeSel.value; applyAppearance(); saveSettings(); });
    body.append(row('Base theme', 'Dark is the default, like a certain volcanic glass app.', themeSel));

    const accent = h('input', { type: 'color', value: settings.appearance.accent });
    accent.addEventListener('input', () => { settings.appearance.accent = accent.value; applyAppearance(); saveSettings(); });
    body.append(row('Accent color', 'Used for links, highlights and the graph.', accent));

    const size = h('input', { type: 'range', min: '12', max: '20', step: '1', value: String(settings.appearance.fontSize) });
    const sizeLabel = h('span', { class: 'kbd' }, settings.appearance.fontSize + 'px');
    size.addEventListener('input', () => { settings.appearance.fontSize = +size.value; sizeLabel.textContent = size.value + 'px'; applyAppearance(); saveSettings(); });
    body.append(row('Font size', 'Interface and editor text size.', h('div', { class: 'row' }, size, sizeLabel)));

    const readable = h('input', { type: 'checkbox', checked: settings.appearance.readable });
    readable.addEventListener('change', () => {
      settings.appearance.readable = readable.checked;
      saveSettings();
      document.querySelectorAll('.editor-host').forEach(el => el.classList.toggle('readable', readable.checked));
    });
    body.append(row('Readable line length', 'Constrain editor width for comfortable reading (recommended).', readable));
  },

  editor(body) {
    body.append(h('h2', {}, 'Editor'));
    const mode = h('select', {}, h('option', { value: 'live' }, 'Live preview'), h('option', { value: 'reading' }, 'Reading view'));
    mode.value = settings.app.editor.defaultViewMode;
    mode.addEventListener('change', () => { settings.app.editor.defaultViewMode = mode.value; saveSettings(); });
    body.append(row('Default view for new tabs', 'Toggle per note with Ctrl+E.', mode));

    const ln = h('input', { type: 'checkbox', checked: settings.app.editor.lineNumbers });
    ln.addEventListener('change', () => { settings.app.editor.lineNumbers = ln.checked; saveSettings(); App.refreshEditors?.(); });
    body.append(row('Show line numbers', 'Display a gutter with line numbers.', ln));

    const sc = h('input', { type: 'checkbox', checked: settings.app.editor.spellcheck });
    sc.addEventListener('change', () => { settings.app.editor.spellcheck = sc.checked; saveSettings(); });
    body.append(row('Spellcheck', 'Underlines misspelled words (set before opening notes).', sc));

    const slb = h('input', { type: 'checkbox', checked: settings.app.editor.strictLineBreaks });
    slb.addEventListener('change', () => { settings.app.editor.strictLineBreaks = slb.checked; saveSettings(); });
    body.append(row('Strict line breaks', 'Single newlines render as line breaks (CommonMark off).', slb));

    const sf = h('input', { type: 'checkbox', checked: settings.app.editor.showFrontmatter });
    sf.addEventListener('change', () => { settings.app.editor.showFrontmatter = sf.checked; saveSettings(); });
    body.append(row('Show properties', 'Render a properties panel for notes with YAML frontmatter.', sf));
  },

  files(body) {
    body.append(h('h2', {}, 'Files & links'));
    const attach = h('input', { type: 'text', value: settings.app.files.attachmentFolder, style: { width: '180px' } });
    attach.addEventListener('change', () => { settings.app.files.attachmentFolder = attach.value.trim(); saveSettings(); });
    body.append(row('Attachment folder', 'Where pasted images are saved (inside your vault).', attach));

    const loc = h('select', {}, h('option', { value: 'root' }, 'Vault root'), h('option', { value: 'same' }, 'Same folder as current file'));
    loc.value = settings.app.files.newNoteLocation;
    loc.addEventListener('change', () => { settings.app.files.newNoteLocation = loc.value; saveSettings(); });
    body.append(row('New note location', 'Default folder for newly created notes.', loc));

    const style = h('select', {}, h('option', { value: 'wikilink' }, 'Wikilinks ([[note]])'), h('option', { value: 'mdlink' }, 'Markdown links ([text](note.md))'));
    style.value = settings.app.files.linkStyle;
    style.addEventListener('change', () => { settings.app.files.linkStyle = style.value; saveSettings(); });
    body.append(row('Link format used by Ctrl+K', 'You can always type either syntax manually.', style));

    const upd = h('input', { type: 'checkbox', checked: settings.app.files.autoUpdateLinks });
    upd.addEventListener('change', () => { settings.app.files.autoUpdateLinks = upd.checked; saveSettings(); });
    body.append(row('Automatically update internal links', 'When you rename or move a note, links are rewritten.', upd));

    const hidden = h('input', { type: 'checkbox', checked: settings.app.files.showHidden });
    hidden.addEventListener('change', () => { settings.app.files.showHidden = hidden.checked; saveSettings(); App.refreshExplorer?.(); });
    body.append(row('Detect all file extensions', 'Show dot-files and unsupported types in the explorer.', hidden));
  },

  daily(body) {
    body.append(h('h2', {}, 'Daily notes'));
    const folder = h('input', { type: 'text', value: settings.app.daily.folder, style: { width: '180px' } });
    folder.addEventListener('change', () => { settings.app.daily.folder = folder.value.trim(); saveSettings(); });
    body.append(row('Daily note folder', 'Notes are created here when you press Ctrl+D.', folder));

    const fmt = h('input', { type: 'text', value: settings.app.daily.format, style: { width: '180px' } });
    fmt.addEventListener('change', () => { settings.app.daily.format = fmt.value.trim() || 'YYYY-MM-DD'; saveSettings(); });
    body.append(row('Date format', 'YYYY-MM-DD, DD.MM.YYYY, YYYY/MM/DD …', fmt));

    const tpl = h('input', { type: 'text', value: settings.app.daily.template, placeholder: 'Templates/Daily.md', style: { width: '180px' } });
    tpl.addEventListener('change', () => { settings.app.daily.template = tpl.value.trim(); saveSettings(); });
    body.append(row('Template file', 'Optional note path used as the daily note template.', tpl));

    const open = h('input', { type: 'checkbox', checked: settings.app.daily.openOnStartup });
    open.addEventListener('change', () => { settings.app.daily.openOnStartup = open.checked; saveSettings(); });
    body.append(row('Open daily note on startup', '', open));
  },

  hotkeys(body) {
    body.append(h('h2', {}, 'Hotkeys'));
    body.append(h('p', { class: 's-desc', style: { marginTop: 0 } }, 'Click a hotkey, then press the new key combination. Click ✕ to reset.'));
    const search = h('input', { type: 'text', placeholder: 'Filter commands…', style: { width: '260px', marginBottom: '8px' } });
    body.append(search);
    const list = h('div', {});
    body.append(list);

    function renderList() {
      clear(list);
      const q = search.value.trim().toLowerCase();
      for (const c of App.commands || []) {
        if (q && !c.name.toLowerCase().includes(q)) continue;
        const hotkeyCell = h('div', { class: 'hotkey-cell' });
        const update = () => {
          clear(hotkeyCell);
          const combo = settings.hotkeys[c.id] != null ? settings.hotkeys[c.id] : c.defaultHotkey;
          const kbd = h('span', { class: 'kbd clickable' }, combo || '—');
          kbd.addEventListener('click', () => {
            clear(hotkeyCell);
            hotkeyCell.append(h('span', { class: 'kbd', style: { borderStyle: 'dashed' } }, 'Press keys…'));
            const onKey = (e) => {
              e.preventDefault();
              if (e.key === 'Escape') { window.removeEventListener('keydown', onKey, true); update(); return; }
              if (!['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
                const comboStr = [
                  e.ctrlKey || e.metaKey ? 'Mod' : '',
                  e.shiftKey ? 'Shift' : '',
                  e.altKey ? 'Alt' : '',
                  e.key.length === 1 ? e.key.toUpperCase() : e.key,
                ].filter(Boolean).join('+');
                settings.hotkeys[c.id] = comboStr;
                saveSettings();
                App.rebuildHotkeys?.();
                window.removeEventListener('keydown', onKey, true);
                update();
              }
            };
            window.addEventListener('keydown', onKey, true);
          });
          hotkeyCell.append(kbd);
          if (settings.hotkeys[c.id] != null) {
            const reset = h('span', { class: 'icon-btn', title: 'Reset' }, icon('x'));
            reset.addEventListener('click', () => { delete settings.hotkeys[c.id]; saveSettings(); App.rebuildHotkeys?.(); update(); });
            hotkeyCell.append(reset);
          }
        };
        update();
        list.append(h('div', { class: 'setting-row', style: { padding: '7px 2px' } },
          h('div', { class: 's-info' }, h('div', { class: 's-name' }, c.name)),
          hotkeyCell));
      }
    }
    search.addEventListener('input', renderList);
    renderList();
  },

  privacy(body) {
    body.append(h('h2', {}, 'Privacy & security'));
    body.append(h('div', { class: 'privacy-box' },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 650, marginBottom: '6px' } }, icon('shield'), 'obsidian never talks to the network.'),
      h('div', {}, 'No telemetry, no update pings, no cloud sync, no analytics. A strict Content-Security-Policy blocks remote content. Every note stays a plain .md file in the vault folder you chose. Settings live in .obsidian/ inside the vault. Deleting that folder resets the app.'),
    ));
    const links = h('select', {},
      h('option', { value: 'ask' }, 'Ask before opening'),
      h('option', { value: 'open' }, 'Open immediately'),
      h('option', { value: 'block' }, 'Never open'));
    links.value = settings.app.privacy.externalLinks;
    links.addEventListener('change', () => { settings.app.privacy.externalLinks = links.value; saveSettings(); });
    body.append(row('Clicking external links', 'What happens when you click an http(s) link in a note.', links));

    const remote = h('input', { type: 'checkbox', checked: settings.app.privacy.allowRemoteImages });
    remote.addEventListener('change', () => {
      settings.app.privacy.allowRemoteImages = remote.checked;
      saveSettings();
      App.notice?.('Remote images setting applies after reopening the vault.', { type: 'warn' });
    });
    body.append(row('Allow remote images', 'Off (default): images are only loaded from your vault. On: notes may load images from the web.', remote));
  },

  about(body) {
    body.append(h('h2', {}, 'About obsidian'));
    body.append(h('div', { class: 'about-logo' }, h('img', { src: '../../assets/icon.png', alt: 'obsidian logo' })));
    body.append(h('p', {}, 'obsidian ', h('b', {}, '0.1.0'), ' — a local-first Markdown knowledge base for Windows.'));
    body.append(h('p', { class: 'muted' }, 'An original, open implementation inspired by the obsidian workflow. Not affiliated with obsidian (Dynalist Inc.).'));
    body.append(h('h3', {}, 'How your data is stored'));
    body.append(h('p', { class: 'muted' }, 'Notes are plain Markdown files in your vault folder. Links use standard [[Wikilink]] or Markdown syntax. The app adds only a .obsidian/ config folder — remove it and any other Markdown tool can read your vault.'));
    body.append(h('h3', {}, 'Bundled open-source libraries'));
    body.append(h('p', { class: 'muted' }, 'Electron · CodeMirror 6 (MIT) · marked (MIT) · KaTeX (MIT) · esbuild (MIT). Full license texts ship with the source.'));
    body.append(h('h3', {}, 'Verify it yourself'));
    body.append(h('p', { class: 'muted' }, 'The full source is included. Audit it, block the app in your firewall — nothing breaks.'));
  },
};

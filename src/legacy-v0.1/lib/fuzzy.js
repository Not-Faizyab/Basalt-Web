/* Fuzzy matcher — greedy scoring with bonuses, returns {score, positions} or null. */
export function fuzzyMatch(query, target) {
  if (!query) return { score: 0, positions: [] };
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  const positions = [];
  let score = 0, qi = 0, last = -2;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      positions.push(i);
      score += 10;
      if (i === last + 1) score += 12;                 // consecutive
      if (i === 0 || /[\s\-_/.]/.test(t[i - 1])) score += 14; // word start
      if (target[i] >= 'A' && target[i] <= 'Z') score += 4;  // camel case
      last = i;
      qi++;
    }
  }
  if (qi < q.length) return null;
  score -= Math.max(0, target.length - q.length) * 0.4;
  return { score, positions };
}

export function highlight(text, positions) {
  if (!positions || !positions.length) return escapeHtml(text);
  let out = '', idx = 0;
  const set = new Set(positions);
  for (let i = 0; i < text.length; i++) {
    if (set.has(i)) {
      if (idx <= i) { out += escapeHtml(text.slice(idx, i)); idx = i; }
      out += '<mark>' + escapeHtml(text[i]) + '</mark>';
      idx = i + 1;
    }
  }
  out += escapeHtml(text.slice(idx));
  return out;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* Rank a list of items [{text, sub, ...}] against query. */
export function fuzzyRank(query, items, getText = (it) => it.text) {
  if (!query) return items.map(it => ({ item: it, score: 0, positions: [] }));
  const out = [];
  for (const it of items) {
    const m = fuzzyMatch(query, getText(it));
    if (m) out.push({ item: it, ...m });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

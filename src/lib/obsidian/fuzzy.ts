// ─── Fuzzy matching (quick switcher, command palette, autocomplete) ──────────

export interface FuzzyResult {
  score: number
  positions: number[] // indices of matched chars in the haystack
}

function scoreSingleToken(q: string, h: string): FuzzyResult | null {
  if (!q) return { score: 0, positions: [] }
  let best: FuzzyResult | null = null

  // Try starting alignment from each occurrence of q[0] so later contiguous runs beat scattered prefixes
  for (let startHi = 0; startHi < h.length; startHi++) {
    if (h[startHi] !== q[0]) continue
    let qi = 0
    let score = 0
    let lastPos = -2
    const positions: number[] = []
    for (let hi = startHi; hi < h.length && qi < q.length; hi++) {
      if (h[hi] === q[qi]) {
        const isWordStart = hi === 0 || /[\s/_\-.:[(]/.test(h[hi - 1] ?? " ")
        let bonus = 0
        if (hi === 0) bonus += 12
        else if (isWordStart) bonus += 8
        if (lastPos === hi - 1) bonus += 6
        if (/[0-9]/.test(h[hi]) && hi > 0 && /[a-z]/.test(h[hi - 1])) bonus += 2
        score += 10 + bonus
        positions.push(hi)
        lastPos = hi
        qi++
      }
    }
    if (qi < q.length) break
    score -= Math.max(0, h.length - q.length) * 0.05
    if (h.includes(q)) score += 25
    if (h === q) score += 40
    if (!best || score > best.score) best = { score: Math.round(score), positions }
    if (best && positions.length === q.length && positions[q.length - 1] - positions[0] === q.length - 1) break
  }

  return best
}

/**
 * Subsequence fuzzy match with bonuses for consecutive runs, word starts,
 * prefix matches, and multi-token space-separated queries. Case-insensitive.
 */
export function fuzzyMatch(query: string, haystack: string): FuzzyResult | null {
  if (!query) return { score: 0, positions: [] }
  const q = query.toLowerCase()
  const h = haystack.toLowerCase()
  const tokens = q.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return { score: 0, positions: [] }
  if (tokens.length === 1) return scoreSingleToken(tokens[0], h)

  let totalScore = 0
  const posSet = new Set<number>()
  for (const tok of tokens) {
    const res = scoreSingleToken(tok, h)
    if (!res) return null
    totalScore += res.score
    for (const p of res.positions) posSet.add(p)
  }
  return { score: totalScore, positions: [...posSet].sort((a, b) => a - b) }
}

export function fuzzyRank<T>(
  query: string,
  items: T[],
  getText: (item: T) => string,
): { item: T; result: FuzzyResult }[] {
  const out: { item: T; result: FuzzyResult }[] = []
  for (const item of items) {
    const res = fuzzyMatch(query, getText(item))
    if (res) out.push({ item, result: res })
  }
  out.sort((a, b) => b.result.score - a.result.score)
  return out
}

/** Highlight helper: split text by matched positions → runs of matched/unmatched */
export function highlightRanges(text: string, positions: number[]): { text: string; matched: boolean }[] {
  const set = new Set(positions)
  const runs: { text: string; matched: boolean }[] = []
  let current = ""
  let currentMatched = set.has(0)
  for (let i = 0; i < text.length; i++) {
    const m = set.has(i)
    if (m === currentMatched) current += text[i]
    else {
      runs.push({ text: current, matched: currentMatched })
      current = text[i]
      currentMatched = m
    }
  }
  if (current) runs.push({ text: current, matched: currentMatched })
  return runs
}

export type SearchableContentType = "movie" | "anime" | "series";
export type SearchQueryForm = { text: string; alias: boolean };

/**
 * Expandable, normalized alias list. Add new short names and alternate titles
 * here; no catalog/database migration is needed.
 */
export const SEARCH_ALIASES: Readonly<Record<string, readonly string[]>> = {
  jjk: ["Jujutsu Kaisen"],
  dbz: ["Dragon Ball Z"],
  sao: ["Sword Art Online"],
  aot: ["Attack on Titan"],
  snk: ["Attack on Titan"],
  "shingeki no kyojin": ["Attack on Titan"],
  mha: ["My Hero Academia"],
  bnha: ["My Hero Academia"],
  "boku no hero academia": ["My Hero Academia"],
  hxh: ["Hunter x Hunter"],
  opm: ["One Punch Man"],
  fma: ["Fullmetal Alchemist"],
  fmab: ["Fullmetal Alchemist Brotherhood"],
  csm: ["Chainsaw Man"],
  jjba: ["JoJo's Bizarre Adventure"],
  "kimetsu no yaiba": ["Demon Slayer"],
  "demon slayer": ["Kimetsu no Yaiba"],
  "yakusoku no neverland": ["The Promised Neverland"],
  lotr: ["The Lord of the Rings"],
  hp: ["Harry Potter"],
  "fast and furious": ["Fast & Furious"],
  "f f": ["Fast & Furious"],
};

export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function getSearchQueryForms(query: string): SearchQueryForm[] {
  const normalized = normalizeSearchText(query);
  if (!normalized) return [];
  const forms = new Map<string, SearchQueryForm>();
  forms.set(normalized, { text: normalized, alias: false });

  for (const alias of SEARCH_ALIASES[normalized] ?? []) {
    const text = normalizeSearchText(alias);
    if (text) forms.set(text, { text, alias: true });
  }

  const expandedTokens = normalized.split(" ").flatMap((token) => {
    const replacement = SEARCH_ALIASES[token]?.[0];
    return replacement ? normalizeSearchText(replacement).split(" ") : [token];
  });
  const expanded = expandedTokens.join(" ");
  if (expanded !== normalized && expanded) forms.set(expanded, { text: expanded, alias: true });
  return [...forms.values()].slice(0, 8);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function addContainsPattern(patterns: Set<string>, value: string): void {
  const normalized = normalizeSearchText(value);
  if (normalized.length >= 2) patterns.add(`%${escapeLike(normalized)}%`);
}

/** Candidate ILIKE patterns, bounded before reaching the database. */
export function getSearchCandidatePatterns(query: string, options: { fuzzy?: boolean } = {}): string[] {
  const patterns = new Set<string>();
  const forms = getSearchQueryForms(query);
  for (const form of forms) addContainsPattern(patterns, form.text);
  const tokens = [...new Set(forms.flatMap((form) => form.text.split(" ")))];
  for (const token of tokens) addContainsPattern(patterns, token);
  if (options.fuzzy === false) return [...patterns].slice(0, 24);

  for (const token of tokens) {
    if (token.length < 5) continue;
    addContainsPattern(patterns, token.slice(0, 3));
    const positions = Math.min(token.length - 1, 10);
    for (let i = 0; i < positions; i++) {
      const before = token.slice(0, i);
      const after = token.slice(i + 1);
      // Dropping one typed character handles an extra-letter typo.
      if (token.length > 5) addContainsPattern(patterns, `${before}${after}`);
      // A single SQL wildcard at every gap handles a missing typed character.
      const gapPattern = `%${escapeLike(before)}_${escapeLike(token.slice(i))}%`;
      patterns.add(gapPattern);
      // Adjacent transposition handles swaps such as Kasien -> Kaisen.
      if (token[i] !== token[i + 1]) {
        addContainsPattern(patterns, `${token.slice(0, i)}${token[i + 1]}${token[i]}${token.slice(i + 2)}`);
      }
    }
  }
  return [...patterns].slice(0, 64);
}

function damerauLevenshtein(left: string, right: string): number {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  const rows = left.length + 1;
  const columns = right.length + 1;
  const matrix = Array.from({ length: rows }, () => new Array<number>(columns).fill(0));
  for (let i = 0; i < rows; i++) matrix[i][0] = i;
  for (let j = 0; j < columns; j++) matrix[0][j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < columns; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
      if (i > 1 && j > 1 && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1]) {
        matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + 1);
      }
    }
  }
  return matrix[left.length][right.length];
}

function tokenSimilarity(queryToken: string, candidateToken: string): number {
  if (queryToken === candidateToken) return 1;
  if (queryToken.length >= 3 && candidateToken.startsWith(queryToken)) return 0.9 + 0.1 * queryToken.length / candidateToken.length;
  if (candidateToken.length >= 4 && queryToken.startsWith(candidateToken) && candidateToken.length / queryToken.length >= 0.65) {
    return 0.86 + 0.1 * candidateToken.length / queryToken.length;
  }
  if (queryToken.length < 4 || candidateToken.length < 4) return 0;
  const maxLength = Math.max(queryToken.length, candidateToken.length);
  const distance = damerauLevenshtein(queryToken, candidateToken);
  const maxDistance = maxLength >= 8 ? 2 : 1;
  const similarity = 1 - distance / maxLength;
  return distance <= maxDistance && similarity >= 0.74 ? similarity : 0;
}

function tokenCoverage(query: string, candidate: string): { score: number; allExact: boolean } | null {
  const queryTokens = query.split(" ").filter(Boolean);
  const candidateTokens = candidate.split(" ").filter(Boolean);
  if (!queryTokens.length || !candidateTokens.length) return null;
  const scores = queryTokens.map((token) => Math.max(...candidateTokens.map((candidateToken) => tokenSimilarity(token, candidateToken))));
  if (scores.some((score) => score === 0)) return null;
  return { score: scores.reduce((sum, score) => sum + score, 0) / scores.length, allExact: scores.every((score) => score === 1) };
}

export type SearchMatch = { score: number; via: "title" | "episode" | "description" };

export function rankSearchMatch(query: string, candidate: string, via: SearchMatch["via"] = "title"): SearchMatch | null {
  const normalizedQuery = normalizeSearchText(query);
  const normalizedCandidate = normalizeSearchText(candidate);
  if (!normalizedQuery || !normalizedCandidate) return null;
  const episodePenalty = via === "episode" ? 18 : via === "description" ? 160 : 0;
  let best = 0;

  for (const form of getSearchQueryForms(query)) {
    if (normalizedCandidate === form.text) {
      best = Math.max(best, form.alias ? 380 : 500);
      continue;
    }
    if (normalizedCandidate.includes(form.text)) {
      best = Math.max(best, form.alias ? 355 : 430);
      continue;
    }
    const coverage = tokenCoverage(form.text, normalizedCandidate);
    if (coverage) {
      const score = coverage.allExact
        ? (form.alias ? 340 : 395)
        : (form.alias ? 205 : 255) + Math.round(coverage.score * 30);
      best = Math.max(best, score);
    }
  }

  if (!best) return null;
  return { score: best - episodePenalty, via };
}

export function isSearchableContentType(value: string | null | undefined): value is SearchableContentType {
  return value === "movie" || value === "anime" || value === "series";
}

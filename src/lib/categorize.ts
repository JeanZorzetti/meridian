// Category inference from a bill name / spend note. The single copy — imported
// by both the API (src/pages/api) and the seed scripts (scripts/*.mjs), so it
// must stay dependency-free.

export const CATEGORIES = [
  "Assinaturas",
  "Cartões",
  "Empréstimos",
  "Contas fixas",
  "Mercado & Casa",
  "Saúde",
  "Pessoal",
  "Outros",
] as const;

// ---- learned model -------------------------------------------------------
// The rules below are a cold start: they only know the names that were in the
// original spreadsheet. Everything here learns the rest from the categories the
// user has actually confirmed — see `category_source` in db/schema.sql.

export interface CategoryModel {
  exact: Map<string, string>; // normalized text -> category
  tokens: Map<string, Map<string, number>>; // category -> token -> count
  totals: Map<string, number>; // category -> total tokens seen
  docs: Map<string, number>; // category -> confirmed texts (the prior)
  vocab: Set<string>;
  size: number; // total confirmed texts
}

export const EMPTY_MODEL: CategoryModel = {
  exact: new Map(), tokens: new Map(), totals: new Map(),
  docs: new Map(), vocab: new Set(), size: 0,
};

/** "Nubank 2/4" -> "nubank". Strips accents and the installment counter so the
 *  same bill matches itself across months (rolloverMonth advances 2/4 -> 3/4). */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD").replace(/\p{M}/gu, "") // "saúde" -> "saude"
    .replace(/\b\d+\s*\/\s*\d+\b/g, " ") // installment counter
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Words worth counting: no 1-char noise, no bare numbers (a value, not a hint). */
function tokenize(text: string): string[] {
  return normalize(text).split(" ").filter((t) => t.length > 1 && !/^\d+$/.test(t));
}

// Below this the token counts are noise, not a pattern — same reasoning as
// MIN_SAMPLES in insights.ts. The exact lookup still works from the first row.
const MIN_TRAIN = 5;
// How much more likely the winner must be than the runner-up, in log space
// (~2.7x). ponytail: picked to be conservative, not tuned — the regex fallback
// is a fine answer, a confidently wrong guess is not.
const MIN_MARGIN = 1;

/** Build the model from rows the user confirmed. Deduped by normalized text,
 *  newest wins: a recurring bill copied across 9 months is one lesson, not nine,
 *  and the user's latest correction is the one that counts. */
export function buildModel(rows: { text: string; category: string }[]): CategoryModel {
  const exact = new Map<string, string>();
  for (const r of rows) {
    const key = normalize(r.text);
    const cat = r.category?.trim();
    if (key && cat) exact.set(key, cat);
  }

  const m: CategoryModel = {
    exact, tokens: new Map(), totals: new Map(),
    docs: new Map(), vocab: new Set(), size: exact.size,
  };
  for (const [text, cat] of exact) {
    m.docs.set(cat, (m.docs.get(cat) ?? 0) + 1);
    let counts = m.tokens.get(cat);
    if (!counts) m.tokens.set(cat, (counts = new Map()));
    for (const t of tokenize(text)) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
      m.totals.set(cat, (m.totals.get(cat) ?? 0) + 1);
      m.vocab.add(t);
    }
  }
  return m;
}

export interface Guess {
  category: string;
  /** Mirrors `category_source` in db/schema.sql — only 'user' trains the model.
   *  'user' — this exact text was confirmed by a human, so the answer is as
   *  good as their correction. 'auto' — a guess (naive Bayes, or the rules).
   *  'llm'  — Claude's guess; classify() never returns it (see classify-llm.ts). */
  source: "user" | "auto" | "llm";
}

/** Naive Bayes over the confirmed corpus. Null when it has no business
 *  answering: too little training data, no known words, or a photo finish.
 *  ponytail: add-one smoothing, no bigrams — the corpus is a few hundred short
 *  names. Revisit if it ever grows past a few thousand. */
function bayes(text: string, m: CategoryModel): string | null {
  if (m.size < MIN_TRAIN) return null;
  const words = tokenize(text).filter((t) => m.vocab.has(t));
  if (words.length === 0) return null; // nothing in common with what we know

  let best = { cat: "", score: -Infinity };
  let second = -Infinity;
  for (const [cat, docs] of m.docs) {
    const total = m.totals.get(cat) ?? 0;
    const counts = m.tokens.get(cat);
    let score = Math.log(docs / m.size);
    for (const w of words) {
      score += Math.log(((counts?.get(w) ?? 0) + 1) / (total + m.vocab.size));
    }
    if (score > best.score) { second = best.score; best = { cat, score }; }
    else if (score > second) second = score;
  }
  return best.score - second >= MIN_MARGIN ? best.cat : null;
}

/** The cascade, most trustworthy first: a category the user confirmed for this
 *  exact text, then what the corpus suggests, then the hardcoded rules.
 *  Null means nothing matched — the caller decides whether to try harder
 *  (src/lib/classify-llm.ts) or settle for a default. */
export function classify(text: string, model: CategoryModel = EMPTY_MODEL): Guess | null {
  const hit = model.exact.get(normalize(text));
  if (hit) return { category: hit, source: "user" };

  const guess = bayes(text, model);
  if (guess) return { category: guess, source: "auto" };

  const ruled = categorize(text);
  return ruled === RULES_FALLBACK ? null : { category: ruled, source: "auto" };
}

// ---- cold-start rules ----------------------------------------------------

/** What categorize() returns when no rule matched. It's a default, not a
 *  match — classify() treats it as "don't know" rather than an answer. */
export const RULES_FALLBACK = "Pessoal";

/** "farmacia sao joao" -> "Saúde". Falls back to "Pessoal". */
export function categorize(name: string): string {
  const s = name.toLowerCase();
  if (/spot|disney|hbo|crunch|chrun|cloud|google one|claude|anime|netflix/.test(s)) return "Assinaturas";
  if (/nubank|\bbb\b|banco|cart[aã]o/.test(s)) return "Cartões";
  if (/emprest|mercado pago|\bm[aã]e\b|cheque/.test(s)) return "Empréstimos";
  if (/energia|claro|\bmei\b|internet|\bluz\b|[aá]gua|aluguel|faculdade|metro|passe/.test(s)) return "Contas fixas";
  if (/compra|carne|mercado|supermerc|geladeira|micro/.test(s)) return "Mercado & Casa";
  if (/remedio|remédio|consulta|psico|farm|sa[uú]de|barbeiro/.test(s)) return "Saúde";
  return "Pessoal";
}

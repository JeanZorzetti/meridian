// Self-check for the category cascade. Run: node --experimental-strip-types src/lib/categorize.test.ts
import assert from "node:assert";
import { buildModel, categorize, classify, EMPTY_MODEL, normalize } from "./categorize.ts";

// --- normalize: what makes a bill match itself across months ---
assert.equal(normalize("Nubank 2/4"), "nubank");
assert.equal(normalize("Nubank 3/4"), "nubank", "installment counter must not split the lesson");
assert.equal(normalize("Saúde"), "saude");
assert.equal(normalize("  Mãe 2/2  "), "mae");
assert.equal(normalize("Google One"), "google one");
assert.equal(normalize(""), "");

// --- empty model: falls straight through to the rules, never throws ---
assert.equal(classify("farmacia sao joao")?.category, "Saúde");
assert.equal(classify("farmacia sao joao")?.source, "auto");
assert.equal(buildModel([]).size, 0);
// Nothing matched -> "don't know", not a "Pessoal" guess dressed as an answer.
// This null is what lets the caller decide to ask Claude (classify-llm.ts).
assert.equal(classify("qualquer coisa", EMPTY_MODEL), null);

// --- exact lookup beats the rules, from the very first confirmed row ---
{
  // The rules would say "Pessoal" — a user correction must win.
  assert.equal(categorize("Padaria do Zé"), "Pessoal");
  const m = buildModel([{ text: "Padaria do Zé", category: "Mercado & Casa" }]);
  const g = classify("Padaria do Zé", m);
  assert.equal(g?.category, "Mercado & Casa", "user correction must beat the rules");
  assert.equal(g?.source, "user");
  // Same bill next month, installment advanced: still the same lesson.
  assert.equal(classify("padaria do ze 2/3", m)?.category, "Mercado & Casa");
}

// --- dedupe: newest wins, and a recurring bill is one lesson, not nine ---
{
  const m = buildModel([
    { text: "Claude", category: "Pessoal" }, // corrected in an older month...
    { text: "Claude", category: "Assinaturas" }, // ...then again, more recently
  ]);
  assert.equal(m.size, 1, "same text must collapse to one lesson");
  assert.equal(classify("Claude", m)?.category, "Assinaturas", "latest correction wins");
}

// --- naive Bayes: generalizes to an unseen name from known words ---
{
  const m = buildModel([
    { text: "Farmacia Pague Menos", category: "Saúde" },
    { text: "Farmacia Sao Joao", category: "Saúde" },
    { text: "Drogaria Araujo", category: "Saúde" },
    { text: "Mercado Extra", category: "Mercado & Casa" },
    { text: "Mercado Dia", category: "Mercado & Casa" },
    { text: "Supermercado BH", category: "Mercado & Casa" },
  ]);
  // Never seen this exact name, and no rule matches "pague" or "bh".
  const g = classify("Pague Menos Drogaria", m);
  assert.equal(g?.category, "Saúde", "Bayes should generalize from known words");
  assert.equal(g?.source, "auto", "a statistical guess is not a confirmation");
}

// --- Bayes stays quiet when it has no business answering ---
{
  const tiny = buildModel([
    { text: "Extra Bairro", category: "Mercado & Casa" },
    { text: "Dia Centro", category: "Mercado & Casa" },
  ]);
  // Two rows is not a pattern. With Bayes running this would say "Mercado &
  // Casa"; below MIN_TRAIN it must stay quiet and report "don't know".
  assert.equal(classify("Extra Dia", tiny), null, "Bayes must stay quiet below MIN_TRAIN");

  const m = buildModel([
    { text: "Farmacia Pague Menos", category: "Saúde" },
    { text: "Drogaria Araujo", category: "Saúde" },
    { text: "Mercado Extra", category: "Mercado & Casa" },
    { text: "Mercado Dia", category: "Mercado & Casa" },
    { text: "Netflix", category: "Assinaturas" },
  ]);
  // No word in common with the corpus and no rule matches -> "don't know",
  // which is exactly the case worth spending an LLM call on.
  assert.equal(classify("Uber", m), null, "unknown words must not invent a category");
  assert.equal(classify("consulta psico", m)?.category, "Saúde", "rules still answer for known words");
}

console.log("categorize.test.ts ✓");

// The last rung of the category cascade: a description neither the confirmed
// corpus nor the rules could place. Server-only, optional — no key, no call.
// categorize.ts stays dependency-free (the seed scripts import it); the network
// lives here.
import Anthropic from "@anthropic-ai/sdk";
import {
  CATEGORIES, classify, RULES_FALLBACK,
  type CategoryModel, type Guess,
} from "@meridian/core/categorize";

// `import.meta.env?` — populated by Vite in dev/build, undefined when this
// module is imported from a plain node script; process.env covers both that and
// the standalone Node runtime in production.
const key = import.meta.env?.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
const client = key ? new Anthropic({ apiKey: key }) : null;

const SYSTEM =
  "Você classifica descrições de despesas pessoais de um brasileiro. " +
  "Responda com a categoria que melhor descreve a despesa. " +
  'Use "Outros" quando a descrição não for suficiente para decidir.';

/** Best-effort: null when there's no key, the call fails, or the answer is
 *  unusable. The category is a guess — never worth failing the request over. */
export async function classifyLLM(text: string): Promise<string | null> {
  if (!client) return null;
  try {
    const res = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 64, // it's a classification
      system: SYSTEM,
      messages: [{ role: "user", content: text }],
      output_config: {
        // Naming a store's category is recall, not reasoning — no thinking,
        // lowest effort. The enum makes an invented category unrepresentable.
        effort: "low",
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: { category: { type: "string", enum: [...CATEGORIES] } },
            required: ["category"],
            additionalProperties: false,
          },
        },
      },
    });

    const block = res.content.find((b) => b.type === "text");
    if (!block) return null;
    const { category } = JSON.parse(block.text);
    // The schema already constrains this; re-checking costs one comparison and
    // means a bad answer can never reach the database.
    return CATEGORIES.includes(category) ? category : null;
  } catch {
    return null; // offline, rate-limited, refused, malformed — all the same here
  }
}

/** The whole cascade: confirmed corpus -> learned model -> rules -> Claude ->
 *  the rules' default. Claude only ever sees text the cheap steps couldn't
 *  place, and its answer is marked 'llm' so it never trains the model. */
export async function classifyWithLLM(text: string, model: CategoryModel): Promise<Guess> {
  const guess = classify(text, model);
  if (guess) return guess;

  const llm = await classifyLLM(text);
  if (llm) return { category: llm, source: "llm" };

  return { category: RULES_FALLBACK, source: "auto" };
}

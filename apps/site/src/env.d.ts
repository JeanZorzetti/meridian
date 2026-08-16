/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly DATABASE_URL: string;
  /** Optional — unset disables the LLM step of the category cascade. */
  readonly ANTHROPIC_API_KEY?: string;
}

declare namespace App {
  interface Locals {
    user: { id: number; username: string } | null;
  }
}

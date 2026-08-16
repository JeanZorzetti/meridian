# Meridian — Handoff

**Última atualização:** 2026-08-15
**Estado:** funcionando, verificado, **não commitado e não publicado**

Este é o documento de referência do estado atual. O `handoff.md` na raiz do
projeto é de julho e está desatualizado — ignore-o.

---

## 1. O que foi feito nesta sessão

Duas mudanças estruturais, ambas verificadas:

1. **Sistema de migrações de banco de dados** — resolve a armadilha de o deploy
   nunca atualizar o banco.
2. **Reorganização em monorepo** — separa a matemática do dinheiro do site, para
   que o app novo (Next.js) possa usar exatamente o mesmo código, sem cópia.

Nenhuma funcionalidade mudou. O site renderiza **exatamente** o mesmo HTML de
antes — isso foi comparado byte a byte.

---

## 2. Migrações de banco — o que é e por que existe

### O problema

O banco de dados é onde o Meridian guarda contas, gastos e cartões. Quando uma
funcionalidade nova precisa de uma **coluna nova** no banco, essa mudança de
estrutura se chama **migração**.

Quando você dá `git push`, o EasyPanel sobe o código novo — **mas não mexe no
banco**. O código novo procura uma coluna que não existe e o app quebra por
dentro, enquanto o site continua respondendo 200 normalmente. É uma falha
invisível de fora.

Isso já aconteceu: o commit `2938b8f` (cartões de crédito, julho) criou as
tabelas `cards` e `card_invoices`, e até hoje ninguém confirmou se alguém rodou
o comando no banco de produção.

### A solução

Uma lista numerada das mudanças do banco, em `packages/db/migrations/`, e um
comando que aplica o que estiver faltando. Ele anota o que já fez numa tabela
(`schema_migrations`), então rodar duas vezes não faz mal nenhum.

```
npm run db:migrate -- --status   # só olha: o que está aplicado e o que falta
npm run db:migrate               # aplica o que falta (seguro repetir)
npm run db:seed                  # cria/redefine o usuário admin do .env
```

### Três proteções embutidas

- **Editar uma migração já aplicada é recusado.** O comando guarda uma
  "impressão digital" de cada arquivo aplicado. Se o arquivo mudar, ele para e
  explica que se corrige para frente, com uma migração nova. Sem isso, dois
  ambientes divergem sem ninguém perceber.
- **Trava de concorrência** — dois containers subindo ao mesmo tempo não aplicam
  a mesma migração duas vezes.
- **Cada migração roda dentro de uma transação** — se falhar no meio, o banco
  fica na versão anterior, nunca numa versão pela metade.

### Regras para escrever uma migração nova

- Nome no formato `NNNN_nome_em_minusculas.sql` (ex: `0002_contas_de_usuario.sql`).
- **Nunca edite uma migração que já rodou em algum lugar.** Crie uma nova.
- A `0001_baseline.sql` é o schema que já existia, e é idempotente de propósito:
  o banco de produção, que já tem tudo, a adota sem recriar nada. **Da `0002` em
  diante** são passos simples, aplicados uma vez só — sem `if not exists`.
- Se a migração não puder rodar em transação (`create index concurrently`),
  ponha `-- migrate:no-transaction` numa linha só dela.

### Bug encontrado e corrigido

O antigo `scripts/init-db.mjs` lia dois arquivos CSV em `docs/Julho/` que **não
existem mais**. Num banco novo ele criava o schema e o usuário e depois **morria
com erro de arquivo não encontrado**. O script foi removido; aplicar o schema
agora é `db:migrate`, criar o usuário é `db:seed`, e importar meses reais já era
coberto melhor por `packages/db/seed-xlsx.mjs`.

---

## 3. A nova estrutura (monorepo)

```
meridian/
├─ apps/
│  └─ site/          Astro — site institucional, e por enquanto /login, /admin, /api/*
├─ packages/
│  ├─ core/          matemática do dinheiro: budget, insights, cards, categorize
│  ├─ db/            Postgres, sessões, migrações
│  └─ ui/            tokens Dark Swiss + primitivas shadcn
├─ docs/
└─ package.json      (workspaces — todo comando roda daqui, da raiz)
```

### Por que separar

`packages/core` é o único lugar que decide **quanto dinheiro você tem**. É
TypeScript puro, sem banco, sem rede, com testes. Quando o app Next existir, ele
importa daí. Se essa matemática fosse copiada para os dois lugares, o Meridian
começaria a dar dois números diferentes para a mesma pergunta — e ninguém
perceberia até um deles estar errado na tela de alguém.

**Prova de que a matemática não mudou:** todos os testes continuam passando e
**nenhum arquivo de teste precisou ser tocado**.

### Como um pacote importa o outro

Sempre pelo nome do pacote, nunca por caminho relativo saindo da pasta:

```ts
import { summarize } from "@meridian/core/budget";
import { getMonthView } from "@meridian/db";
import { getSessionUser } from "@meridian/db/auth";
import { Badge } from "@meridian/ui/components/badge";
```

O que dá para importar de cada pacote está listado no `exports` do `package.json`
dele.

---

## 4. Comandos

Todos rodam da **raiz** do projeto.

| Comando | O que faz |
|---|---|
| `npm run dev` | servidor de desenvolvimento |
| `npm run build` | build de produção |
| `npm test` | todos os testes (matemática + migrações) |
| `npm run db:migrate` | aplica migrações pendentes |
| `npm run db:migrate -- --status` | só inspeciona, não muda nada |
| `npm run db:seed` | cria/redefine o usuário admin |

---

## 5. O que foi verificado

| Prova | Resultado |
|---|---|
| `npm test` | 5 suítes passam, arquivos de teste inalterados |
| `npm run build` | passa, 3 páginas pré-renderizadas, 0 erros |
| Servidor real de pé | `/`, `/pricing`, `/styleguide`, `/login` → 200; `/admin` → 302 para o login |
| HTML comparado byte a byte | **idêntico** ao de antes (só mudam os `uid` aleatórios do Astro) |
| CSS comparado | 10 classes a menos — todas falso-positivo, nenhuma usada (veja abaixo) |

### Sobre o CSS 1.258 bytes menor

Sumiram exatamente 10 classes: `.table`, `.filter`, `.shadow`, `.uppercase`,
`.visible`, `.invisible`, `.contents`, `.lowercase`, `.tabular-nums`,
`.running`. O Tailwind antigo as gerava por engano ao ler essas palavras soltas
em README e documentação. Foi verificado no HTML gerado: **nenhuma era usada em
lugar nenhum**. O build novo está mais correto, não mais pobre.

### O que NÃO foi verificado

**A metade do sistema de migrações que fala com o banco.** Não há Postgres, nem
Docker, nem `.env` nesta máquina — só deu para testar a lógica de leitura dos
arquivos (ordem, nomes, impressão digital), que tem teste automatizado. A parte
que conecta e escreve precisa ser rodada contra o banco real. Veja a seção 8.

---

## 6. Armadilhas conhecidas (leia antes de mexer)

- **Nunca apague o `package-lock.json`.** Aconteceu nesta sessão: apagar o
  arquivo fez o npm resolver um Astro mais novo, cujo pacote `cookie` colide com
  o que o `shadcn` traz junto pelo express, e o build quebrou no prerender.
  Restaurar o arquivo pelo git resolveu. Deixe o npm reconciliar sozinho.
- **App novo tem que ficar dentro de `apps/`.** O Tailwind v4 acha as classes
  pelos `@source` no topo de `packages/ui/src/styles/global.css`, que apontam
  para `apps/`. Fora dali, o sintoma é CSS que silenciosamente não existe.
- **Os pacotes exportam `.ts` cru.** O bundler de cada app precisa inliná-los —
  veja `ssr.noExternal` no `apps/site/astro.config.mjs`. Sem isso o build passa
  e o servidor morre no primeiro import.
- `reserve_cents` (reserva do cartão) existe no banco e na API, mas não tem campo
  na tela. O formulário de cartão em `BudgetApp.tsx` só pede nome, fecha, vence e
  limite.
- O `README.md` ainda é o texto padrão do Astro, e o `handoff.md` da raiz é de
  julho. Ambos desatualizados.

---

## 7. Decisões tomadas nesta conversa

| Assunto | Decisão |
|---|---|
| **Site** | continua em **Astro**, pelo SEO e pelo blog que vem |
| **App do usuário/admin** | vai ser um app **Next.js** separado, em `apps/app` |
| **Endereço** | `meridian.roilabs.com.br/app` (caminho, não subdomínio) |
| **Painel de operação** | fica em `/app/admin` — consequência da escolha acima |
| **Backend do agente de IA** | fica em Node, não em Python/FastAPI |
| **Cadastro** | verificação por e-mail + 2FA + login pelo Google |
| **Migração no deploy** | **manual por enquanto** — nada muda em produção agora |

### Sobre Astro + Next.js — a correção que importa

A ideia original era ir para Next.js "para aguentar mais usuários". Isso não se
sustenta: o Astro com adapter Node já faz servidor igual ao Next — os dois rodam
Node no mesmo container. **O que limita a capacidade do Meridian hoje são três
coisas no código, que continuariam existindo em Next.js:**

1. `getSpendHistory` carrega **todos** os gastos já registrados a cada abertura
   de mês.
2. O modelo de categorias é reconstruído do zero a cada gasto registrado.
3. O bloqueio por tentativa de login vive na memória do processo — para de
   funcionar com mais de um container.

Trocar de framework não resolve nenhum dos três (isso é a Fase 3 do plano).

**Mesmo assim vale ir para Next.js**, por razões melhores: login com Google,
verificação de e-mail e 2FA saem quase prontos com biblioteca, e o `/admin` já é
uma peça React de 1.223 linhas — sintoma de que o modelo de "ilhas" do Astro não
serve mais ali. **Decisão certa, motivo diferente.**

---

## 8. Pendências — o que fazer a seguir

### 8.1. Rodar a migração em produção ⚠️ prioridade

É o que finalmente resolve a pendência dos cartões, aberta desde julho.

1. Preencher a `DATABASE_URL` no arquivo `.env` da raiz (já criado, com
   instruções dentro). O valor está no EasyPanel → serviço de Postgres →
   credenciais. **Use a URL externa** (com número de IP depois do `@`), não a
   interna (com nome).
2. Rodar, nesta ordem:
   ```
   npm run db:migrate -- --status   # deve mostrar 0001 como "pendente"
   npm run db:migrate               # aplica
   npm run db:migrate               # deve dizer "nada pendente"
   ```

Se o EasyPanel não mostrar URL externa, **não abra a porta do banco para a
internet**. Existe um caminho melhor: rodar o comando pelo terminal do próprio
servidor, por dentro do EasyPanel.

> **Nunca cole a `DATABASE_URL` num chat.** Ela contém a senha do banco de
> produção. Ela vai direto no arquivo `.env`, que o git ignora.

### 8.2. Publicar este checkpoint

Nada foi commitado nem publicado. O deploy vai subir o site exatamente igual ao
que já está no ar — o build provou isso. Vale ter um ponto de retorno seguro no
GitHub antes da próxima etapa, que é grande.

### 8.3. Próxima etapa (o resto da Fase 1)

Criar o `apps/app` em Next.js, mover `/login`, `/admin` e as 15 rotas de API para
lá, e quebrar o `BudgetApp.tsx` em telas separadas (`/app/orcamento`,
`/app/cartoes`, `/app/metas`). Depois disso o Astro fica só com o institucional
e o blog.

---

## 9. Onde está o plano completo

O plano das 7 rodadas — incluindo o motor de dívidas com a Lei 14.690/2023, o
perfil comportamental de Klontz, o agente conversacional com guardrails da CVM e
as finanças colaborativas — está em:

```
C:\Users\dudin\.claude\plans\c-users-dudin-desktop-pasta-das-empresa-ancient-quail.md
```

A pesquisa que originou tudo: [`docs/Pesquisa Estratégica Projeto Merdian.md`](Pesquisa%20Estrat%C3%A9gica%20Projeto%20Merdian.md).

| Rodada | Entrega | Estado |
|---|---|---|
| 1 | Migrações versionadas | ✅ feito |
| 2 | Monorepo + app Next | 🔨 metade (monorepo feito, Next falta) |
| 3 | Contas, e-mail, 2FA, Google, LGPD | ⏳ |
| 4 | Capacidade e observabilidade | ⏳ |
| 5 | Perfil Klontz + motor de dívidas | ⏳ |
| 6 | Agente conversacional | ⏳ |
| 7 | ZBB adaptado, contratos prévios, colaborativo, monetização | ⏳ |

# Meridian — Handoff

**Última atualização:** 2026-08-16
**Estado:** no ar, estável e verificado rota por rota. Migração `0001` aplicada
no banco de produção, e confirmado que o container fala com o banco. **A migração
automática no deploy foi tentada, derrubou o site por 7 minutos e foi
revertida** — leia a 8.5 inteira antes de tentar de novo; ela tem um passo de
diagnóstico que precisa vir primeiro.

**O app em Next.js existe e está verificado localmente, mas não está no ar** — o
que está em produção continua sendo só o site em Astro, servindo `/admin` e
`/login` como sempre. Subir o app é a **rodada B da 8.3**, e depende de você
criar o serviço no EasyPanel.

Este é o documento de referência do estado atual. O `handoff.md` na raiz do
projeto é de julho e está desatualizado — ignore-o.

---

## 0. Onde estamos, em português claro

Hoje existe **um site no ar** (`meridian.roilabs.com.br`), e dentro dele mora
também o seu painel de orçamento, em `/admin`. Tudo isso funciona e não foi
mexido.

O que fizemos foi **construir uma segunda versão do painel**, em outra tecnologia
(Next.js), que vai morar em `meridian.roilabs.com.br/app`. Ela está pronta e
guardada no repositório, mas **não está ligada** — hoje quem abrir `/app` recebe
"página não encontrada". Isso é esperado, não é defeito: falta o último passo,
que é criar o "serviço" dela no EasyPanel.

Pense assim: o código é o motor, e o serviço no EasyPanel é a tomada. O motor
está pronto e testado; ninguém plugou ainda.

### O que falta, em ordem

São três coisas independentes. **Nenhuma delas é urgente** — o site está no ar e
estável. Você pode fazer uma hoje e outra semana que vem.

| Ordem | O quê | Quanto dá trabalho | Por que fazer |
|---|---|---|---|
| 1ª | **Trocar a senha do banco** (8.4) | ~15 min, e o site pisca | A senha atual passou por um chat em 2026-08-16. É a única com risco de segurança de verdade. |
| 2ª | **Ligar o app novo** (8.3, rodada B) | ~15 min, sem risco pro site | É o que faz todo o trabalho de hoje virar algo que você consegue abrir. |
| 3ª | **Descobrir por que o deploy caiu** (8.5, Passo 0) | 2 comandos, só leitura | Fecha a única dúvida técnica em aberto. Dá para fazer junto com a 2ª, na mesma tela. |

As três dependem de **você**, porque exigem entrar no EasyPanel — não há como
fazer pelo código. Cada uma tem o passo a passo na seção correspondente lá
embaixo, e todas podem ser feitas com alguém te guiando.

### O que NÃO precisa fazer

- Não precisa mexer no site que está no ar. Ele está bem.
- Não precisa rodar migração de banco agora — nada mudou no schema hoje.
- Não precisa entender Next.js para ligar o app. É preencher dois campos.

---

## 1. O que foi feito

Três mudanças estruturais, todas verificadas:

1. **Sistema de migrações de banco de dados** — resolve a armadilha de o deploy
   nunca atualizar o banco.
2. **Reorganização em monorepo** — separa a matemática do dinheiro do site, para
   que o app novo (Next.js) possa usar exatamente o mesmo código, sem cópia.
3. **O app em Next.js (`apps/app`)** — construído, verificado e publicado no
   repositório, mas **ainda não servindo ninguém**: falta criar o serviço dele no
   EasyPanel. Detalhe na 8.3.

Nenhuma funcionalidade mudou. O site renderiza **exatamente** o mesmo HTML de
antes — isso foi comparado byte a byte.

**A linha do tempo de 2026-08-16, em commits:**

| Commit | O que é |
|---|---|
| `ed92196` | monorepo + sistema de migrações (89 arquivos) |
| `4b9d0a2` | documentação do checkpoint |
| `66f0302` | registro do deploy verificado |
| `83caaf1` | ferramental do spec-kit versionado (pendência 8.7) |
| `9866ca8` | migração automática no deploy — **derrubou o site, revertido** |
| `71b9cc2` | documentação (escrita antes de o deploy falhar, corrigida depois) |
| `de35e6f` | revert do `9866ca8`, site de volta no ar |
| `c574746` | correção do HANDOFF, que descrevia um 8.5 que não existe mais |
| `2f3124c` | o diagnóstico que faltava e como ler os logs do EasyPanel |
| `73f577b` | **`apps/app` em Next.js** — login, painel e as 15 rotas de API (37 arquivos) |
| `e50b036` | registro deste deploy e da pin frouxa do Node |

O push do checkpoint saiu às 13:31 e o deploy do EasyPanel entrou no ar às
13:32:57 — cerca de um minuto e meio. As provas de produção estão na seção 5.

Mais tarde, o `9866ca8` derrubou o site às 14:06; o revert `de35e6f` o trouxe de
volta às 14:13:37, cerca de um minuto depois do push. Sete minutos fora do ar.
Depois disso o site foi verificado rota por rota e ficou estável ao longo do
deploy seguinte (8 medições seguidas em 200).

Já no fim do dia, os dois commits do app entraram **sem nenhuma queda**: push do
`73f577b` às 15:13:28 e deploy no ar às 15:14:51 (1m23s); push do `e50b036` e
deploy às 15:18:07. O site respondeu 200 em todas as medições atravessando as
duas trocas. O deploy foi detectado pelo cabeçalho `Etag` de `/`, que muda quando
uma versão nova entra — mais barato que comparar o HTML inteiro, e sem depender
da API do EasyPanel.

**Uma lição do `66f0302`:** ele ficou commitado na máquina e nunca publicado, e
só foi descoberto na sessão seguinte, ao comparar `main` com `origin/main`. A
documentação do deploy existia num computador só — se ele sumisse, sumia junto.
Commit não é publicação; só o `push` é. Vale conferir com
`git status -sb`, que mostra `[ahead 1]` quando há commit parado.

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
tabelas `cards` e `card_invoices`, e por meses ninguém soube dizer se alguém
tinha rodado o comando no banco de produção. (Tinha rodado — só se descobriu em
2026-08-16, inspecionando o banco. A questão é ter passado meses sem saber.)

### A solução

Uma lista numerada das mudanças do banco, em `packages/db/migrations/`, e um
comando que aplica o que estiver faltando. Ele anota o que já fez numa tabela
(`schema_migrations`), então rodar duas vezes não faz mal nenhum.

```
npm run db:migrate -- --status   # só olha: o que está aplicado e o que falta
npm run db:migrate               # aplica o que falta (seguro repetir)
npm run db:seed                  # cria/redefine o usuário admin do .env
```

**No deploy isso NÃO roda sozinho** — ainda é preciso rodar `db:migrate` da sua
máquina depois de um push que mexa no schema. Automatizar isso é a pendência
8.5, que já foi tentada uma vez e derrubou o site.

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
│  ├─ site/          Astro — site institucional, e até a virada /login, /admin, /api/*
│  └─ app/           Next.js — o mesmo login, painel e API, montados em /app
├─ packages/
│  ├─ core/          matemática do dinheiro: budget, insights, cards, categorize
│  ├─ db/            Postgres, sessões, migrações
│  └─ ui/            tokens Dark Swiss + primitivas shadcn
├─ docs/
└─ package.json      (workspaces — todo comando roda daqui, da raiz)
```

Por enquanto **os dois apps têm o painel, e só o site está no ar** — ver 8.3.

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
| `npm run dev` | servidor de desenvolvimento do **site** |
| `npm run build` | build de produção do **site** |
| `npm start` | sobe o site em produção — é o que o container do site roda |
| `npm run dev:app` | servidor de desenvolvimento do **app** (`localhost:3000/app`) |
| `npm run build:app` | build de produção do **app** |
| `npm run start:app` | sobe o app em produção — é o que o container do app roda |
| `npm run build:all` | os dois builds; é o que conferir antes de um push |
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
| Servidor real de pé (local) | `/`, `/pricing`, `/styleguide`, `/login` → 200; `/admin` → 302 para o login |
| HTML comparado byte a byte | **idêntico** ao de antes (só mudam os `uid` aleatórios do Astro) |
| CSS comparado | 10 classes a menos — todas falso-positivo, nenhuma usada (veja abaixo) |
| **Produção, depois do deploy** | ver logo abaixo |

### Produção depois do deploy de 2026-08-16

| Rota em `meridian.roilabs.com.br` | Resposta |
|---|---|
| `/`, `/pricing`, `/styleguide`, `/login` | 200 |
| `/admin` | 302 → `/login` |
| `/api/trends`, `/api/month/2026-08` | 401 |

**Os 401 são a prova que importa.** Eles vêm do middleware e do código de sessão,
que agora moram em `@meridian/db` — um pacote separado. Se o bundler não tivesse
inlinado os pacotes no build de produção, o servidor teria morrido no primeiro
import e a resposta seria 502, não 401. Era esse o risco real da reorganização, e
ele não se concretizou.

O deploy foi detectado comparando o hash do HTML de `/` antes e depois: o Astro
gera `uid`s aleatórios a cada build, então o HTML muda quando uma versão nova
entra no ar. É um jeito barato de saber que o deploy terminou de verdade, sem
acesso à API do EasyPanel.

### O container fala com o banco — provado sem usar senha

Isto estava em aberto como pendência 8.6: os 401 são devolvidos **antes** de
qualquer consulta, então não provam nada sobre a conexão com o banco. A dúvida
era se a `DATABASE_URL` do container ainda funcionava.

O truque que responde isso sem precisar da senha de ninguém: um `POST` em
`/api/login` com um usuário que não existe. A primeira linha de `authenticate()`
é `select ... from users where username = ...` — sem cache, sem atalho. Então:

| Resposta | Significa |
|---|---|
| `302 → /login?error=1` | consultou o banco, não achou o usuário |
| `500` | não conseguiu falar com o banco |

Produção devolveu **`302 → /login?error=1`**. A conexão funciona.

Dois detalhes de quem for repetir isso: o POST precisa do cabeçalho
`Origin: https://meridian.roilabs.com.br`, senão o Astro barra como CSRF e
devolve **403 antes de chegar no código de login** — um 403 aqui não diz nada
sobre o banco. E o login trava o IP após 5 falhas em 15 minutos, então faça
**uma** tentativa, não um laço.

**O que ainda assim não foi provado:** que a tela do `/admin` mostra os 428
lançamentos. São consultas diferentes das do login. O risco que importava (o
container sem banco) está descartado; o que falta é conferência visual.

### Sobre o CSS 1.258 bytes menor

Sumiram exatamente 10 classes: `.table`, `.filter`, `.shadow`, `.uppercase`,
`.visible`, `.invisible`, `.contents`, `.lowercase`, `.tabular-nums`,
`.running`. O Tailwind antigo as gerava por engano ao ler essas palavras soltas
em README e documentação. Foi verificado no HTML gerado: **nenhuma era usada em
lugar nenhum**. O build novo está mais correto, não mais pobre.

### A metade que faltava, verificada em 2026-08-16

A parte do sistema de migrações que fala com o banco foi rodada contra o
Postgres de produção:

| Prova | Resultado |
|---|---|
| `--status` antes | `0001_baseline.sql` **pendente** — o banco nunca teve controle de migração |
| Schema inspecionado antes de aplicar | as 8 tabelas já existiam, **0 colunas faltando**, 11 índices presentes |
| `db:migrate` | `✓ 0001_baseline.sql 892ms` |
| `db:migrate` de novo | `nada pendente` — a proteção contra reaplicar funciona |
| Contagem de linhas antes e depois | **idêntica**: 2 usuários, 428 contas, 151 gastos, 3 cartões, 3 faturas |

**A dúvida de julho está respondida:** `cards` e `card_invoices` existem em
produção, com `reserve_cents` e tudo mais. Alguém rodou o schema na época. A
baseline, sendo idempotente, não recriou nada — só registrou a linha em
`schema_migrations`. Da `0002` em diante o `db:migrate` aplica o que falta sem
ninguém escrever SQL à mão — mas alguém ainda precisa **rodar o comando** depois
do deploy. Tirar essa última pessoa do caminho é a pendência 8.5.

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
  `ssr.noExternal` no `apps/site/astro.config.mjs`, `transpilePackages` no
  `apps/app/next.config.ts`. Sem isso o build passa e o servidor morre no
  primeiro import.
- **No app Next, caminho absoluto passa pelo `appPath()`.** O `basePath: "/app"`
  é aplicado sozinho ao `<Link>` e ao `redirect()`, mas **não** ao `fetch()` nem
  a um cabeçalho `Location` escrito à mão. Um `/api/...` cru sai do app e cai no
  site ao lado — que responde 404, ou coisa pior antes da virada da rodada C.
- **Um pacote compartilhado não pode usar os tipos ambiente de um app.** O
  `packages/db` lia `import.meta.env.DATABASE_URL`, e quem declara `ImportMetaEnv`
  é o app que está compilando: funcionava no Astro, erro de tipo no Next.
- **`.reveal` e `.bar` dependem de JavaScript do layout.** O `global.css` deixa
  todo `.reveal` com `opacity: 0` enquanto o `<html>` tem a classe `.js`, e as
  barras de categoria só ganham largura em `.js .reveal.is-visible .bar`. Um app
  novo que use esses componentes precisa do observer (no Next, o
  `Enhancements.tsx`), senão a tela some e as barras aparecem todas cheias.
- **O container roda uma versão do Node diferente da sua máquina, e o `.nvmrc`
  não diz qual.** Ele contém só `22`, então o Nixpacks escolhe alguma 22.x — e
  a máquina de desenvolvimento hoje roda Node 24. Foi essa diferença que
  derrubou o site em 2026-08-16 (ver 8.5). **Testar um comando de deploy
  localmente não prova que ele roda no container.** Qualquer coisa que dependa
  de recurso recente do Node precisa ou de uma versão fixa no `.nvmrc`, ou de
  não depender do recurso.
- **Ler os logs do EasyPanel engana de três jeitos.** (1) O painel de Logs mostra
  o container **que está vivo agora** — um container que morreu levou os logs
  dele junto, então depois de um revert você está olhando justamente o que deu
  certo. (2) Os horários ali são **UTC**, três horas à frente do relógio de
  Brasília: `17:18:29` no log é `14:18:29` para você. (3) Um bloco
  `npm error signal SIGTERM` / `npm error command failed` no fim **é
  desligamento normal**, não defeito: é o EasyPanel encerrando o container
  antigo quando o novo entra no lugar, e aparece em todo deploy bem-sucedido.
  Para diagnosticar de verdade, use o **terminal do container** (ícone `>_`),
  que responde no presente em vez de depender de log preservado.
- **Cuidado com "válvula de escape" que mora dentro do processo que quebra.**
  A tentativa do 8.5 tinha uma variável `MIGRATE_SKIP=1` documentada como saída
  de emergência — mas ela era lida por uma linha de JavaScript, e na falha real
  o Node morria antes de executar qualquer linha. Uma proteção só vale se
  sobreviver ao modo de falha de que ela deveria proteger.
- **Os campos de build do EasyPanel têm que continuar vazios.** É o Nixpacks
  lendo o `package.json` da raiz que faz o monorepo funcionar sem Dockerfile.
  Escrever um caminho à mão ali (`node ./dist/server/entry.mjs`, por exemplo)
  quebra o deploy, porque o `dist/` saiu da raiz e foi para `apps/site/`.
  Detalhe completo na seção 8.2.
- `reserve_cents` (reserva do cartão) existe no banco e na API, mas não tem campo
  na tela. O formulário de cartão em `BudgetApp.tsx` só pede nome, fecha, vence e
  limite.
- O `README.md` ainda é o texto padrão do Astro, e o `handoff.md` da raiz é de
  julho. Ambos desatualizados.
- **`git` no PowerShell desta máquina não funciona direito.** Existe um arquivo
  vazio em `C:\Windows\system32\git` que tem precedência sobre o git de verdade:
  dentro de um pipeline dá erro (`CantActivateDocumentInPipeline`) e fora dele o
  comando devolve **saída vazia**, o que parece "repositório sem nada" e leva a
  conclusões erradas sobre o estado do projeto. Use o caminho completo —
  `& "C:\Program Files\Git\cmd\git.exe" status` — ou o Git Bash, onde o problema
  não existe.
- **Ao mexer em `.specify/`**, lembre que `.specify/memory/constitution.md` é
  conteúdo do projeto (hoje ainda o template intacto), não ferramental. Ele está
  versionado de propósito — veja 8.7.

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
| **Migração no deploy** | **manual** — quem publica roda `db:migrate` depois. Automatizar foi tentado e revertido (ver 8.5) |
| **Build no EasyPanel** | Nixpacks com os campos vazios; sem Dockerfile no repo (ver 8.2) |

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

| # | O quê | Estado |
|---|---|---|
| 8.1 | Rodar a migração em produção | ✅ 2026-08-16 |
| 8.2 | Publicar o checkpoint | ✅ 2026-08-16 |
| 8.3 | `apps/app` em Next.js (resto da Fase 1) | 🔨 **construído e verificado local; falta subir** |
| 8.4 | Trocar a senha do Postgres | ⚠️ **aberta, e só você pode fazer** |
| 8.5 | Migração automática no deploy | ❌ **tentada e revertida** — leia antes de repetir |
| 8.6 | Confirmar que o app lê o banco em produção | ✅ 2026-08-16 |
| 8.7 | Decidir o que fazer com `.claude/` e `.specify/` | ✅ 2026-08-16 |

### 8.1. ~~Rodar a migração em produção~~ ✅ feito em 2026-08-16

Aplicada. As provas estão na seção 5.

Daqui em diante, **depois de todo deploy que mexa no schema**, rode da sua
máquina com o `.env` preenchido:

```
npm run db:migrate -- --status   # o que está aplicado, o que falta
npm run db:migrate               # aplica o que falta
```

Automatizar esse passo é a pendência 8.5 — tentada em 2026-08-16 e revertida,
então por enquanto continua dependendo de alguém lembrar.

> **A `DATABASE_URL` foi colada num chat em 2026-08-16.** Ela contém a senha do
> banco de produção. Trocar essa senha no EasyPanel é a pendência 8.4.
> O lugar dela é o `.env`, que o git ignora — nunca um chat, um ticket ou um
> print.

### 8.2. ~~Publicar este checkpoint~~ ✅ feito em 2026-08-16

`b20dcf4..4b9d0a2` no `main`: `ed92196` (monorepo + migrações) e `4b9d0a2` (esta
documentação). O deploy do EasyPanel dispara sozinho a cada push, levou cerca de
um minuto e meio, e o site foi verificado de pé depois — provas na seção 5.

**Como o EasyPanel constrói o serviço do site** (conferido, não está em arquivo
nenhum do repo): fonte GitHub `JeanZorzetti/meridian`, branch `main`, Build Path
`/`, builder **Nixpacks**, com Install/Build/Start **todos vazios** — ou seja, o
Nixpacks lê o `package.json` da raiz e usa `npm ci`, `npm run build` e
`npm start`. Os dois últimos repassam para `apps/site` via `-w`, então a mudança
de `dist/` para `apps/site/dist/` não quebrou nada. **Se algum dia alguém
escrever um caminho à mão nesses campos, o monorepo quebra o deploy.**

Isto vale para o **serviço do site**. O serviço do app, quando existir, é o
contrário: ele *precisa* de Build e Start preenchidos (`npm run build:app` e
`npm run start:app`), porque os nomes sem sufixo já são do site. Ver a rodada B
na 8.3.

Guarde isto para quando o 8.5 for refeito: no dia em que o `npm start` da raiz
voltar a migrar antes de servir, esse campo Start vazio fica importante de um
jeito mais traiçoeiro. Escrever `node ./apps/site/dist/server/entry.mjs` ali
**não quebraria nada visível** — o site subiria respondendo 200 — e simplesmente
deixaria de migrar o banco, sem aviso: a falha invisível de volta, escondida num
campo de formulário que não existe em arquivo nenhum do repositório.

### 8.3. `apps/app` em Next.js 🔨 rodada A feita em 2026-08-16

Dividido em três rodadas, para que nada vá para produção antes de ter sido visto
funcionando. **A rodada A está pronta e não mudou nada no ar** — o site continua
servindo `/login` e `/admin` exatamente como antes.

| Rodada | O quê | Estado |
|---|---|---|
| A | criar o `apps/app`, portar login, painel e as 15 rotas de API | ✅ 2026-08-16 |
| B | subir o serviço novo no EasyPanel e conferir o `/app` no ar | ⏳ **precisa de você** |
| C | tirar `/admin`, `/login` e `/api/*` do Astro, e redirecionar | ⏳ depois de B |

**O que a rodada A fez:** Next 16.3.1 com App Router, React 19 e os mesmos tokens
do `packages/ui`. As 15 rotas de API foram portadas com os contratos JSON
idênticos. O `BudgetApp.tsx` foi copiado com três mudanças mecânicas: `"use
client"` no topo, o `fetch` passando pelo `appPath()`, e o formulário de logout
idem.

**A decisão de forma que mais importa:** o Next está montado com
`basePath: "/app"`, ou seja, **ele só reivindica `/app`** — foi conferido que
`/`, `/login` e `/api/trends` respondem 404 no app. Isso é o que torna a rodada B
segura: a regra nova no EasyPanel aponta para `/app` e não tem como engolir uma
rota do site, mesmo se estiver errada.

**Não há middleware.** No Astro o `middleware.ts` guardava `/admin` e `/api/*`, e
cada rota conferia `locals.user` de novo por cima. O middleware do Next roda por
padrão no runtime *edge*, onde o driver do Postgres não vai — então a sessão
seria ou uma exceção de runtime, ou um "tem cookie?" que não é autenticação. A
conferência passou a morar junto do dado: toda página chama `requireUser()`, toda
rota chama `apiUser()`. Rota nova sem nenhum dos dois quebra na primeira leitura
de `user.id`, em vez de escapar calada de um padrão de matcher.

**Duas coisas que quase passaram batido:**

- O `global.css` esconde todo `.reveal` enquanto a classe `.js` está no `<html>`,
  e é ele que dá largura às barras (`.js .reveal.is-visible .bar`). Sem portar o
  observer, quatro blocos do painel ficariam com `opacity: 0` para sempre e
  **toda barra apareceria cheia** — os mesmos números, desenhados errado. Está em
  `src/components/Enhancements.tsx`.
- O `packages/db` lia `import.meta.env.DATABASE_URL`, cujo tipo `ImportMetaEnv`
  quem declara é o app que está compilando. Compilava no Astro e dava erro de
  tipo no Next. Um pacote que dois apps importam não pode depender dos tipos de
  nenhum dos dois; agora lê pelo mesmo caminho com um cast local.

**O que foi verificado** (o servidor de verdade de pé, não só o build):

| Prova | Resultado |
|---|---|
| `npm run build:app` | passa, 15 rotas de API + `/` + `/login`, todas dinâmicas |
| `npm run build` (site) | passa, 3 páginas pré-renderizadas, 0 erros |
| `npm test` | 5 suítes passam, arquivos de teste inalterados |
| `/app/login` | 200 |
| `/app` sem sessão | 307 → `/app/login` |
| `/app/api/trends`, `/app/api/month/2026-08` | 401 |
| `/`, `/login`, `/api/trends` no app | **404** — o Next não reivindica nada fora de `/app` |
| `POST /app/api/login`, usuário inexistente | 302 → `/app/login?error=1` — **consultou o banco** |
| `POST /app/api/login` com `Origin` de outro site | 403 |
| `getMonthView(1, "2026-08")` | 33 contas, 3 cartões, 3 faturas, 1 meta — e 428/151 no total, batendo com a seção 5 |

Os 401 valem aqui pela mesma razão da seção 5: se o `transpilePackages` não
tivesse inlinado os pacotes, o servidor morreria no primeiro `import` e a
resposta não seria 401.

**O que não foi provado:** a tela logada renderizando. Não por falta de tentativa
— o `ADMIN_USER` e o `ADMIN_PASSWORD` do `.env` estão **vazios** (só a
`DATABASE_URL` está preenchida), então não havia credencial local para entrar. Os
usuários reais no banco são `jean` (id 1) e `miridian_db`. A metade do servidor
está provada pela linha do `getMonthView` acima, que é exatamente a consulta que
a página nova faz; falta bater os olhos na tela, e isso é a rodada B.

> Como efeito colateral: `npm run db:seed`, que "cria/redefine o usuário admin do
> `.env`", hoje não teria usuário nenhum para criar. E o `ANTHROPIC_API_KEY`
> também está vazio, o que desliga o último degrau da cascata de categorias
> **localmente** — em produção quem fornece essa variável é o EasyPanel.

#### Rodada B — ligar o app. É você quem faz, e é só preencher formulário.

Você vai **criar um serviço novo** no EasyPanel, ao lado do que já existe. O
serviço do site **não é tocado em nenhum momento** — se algo der errado aqui, o
site continua no ar do mesmo jeito. Esse é o motivo de ter sido feito nesta
ordem.

Passo a passo:

1. **No EasyPanel, no mesmo projeto do site, crie um serviço novo do tipo App.**
   Dê um nome que distinga dos outros, por exemplo `meridian-app`.
2. **Fonte:** GitHub, repositório `JeanZorzetti/meridian`, branch `main`,
   Build Path `/`. Igualzinho ao serviço do site.
3. **Builder:** Nixpacks.
4. **Preencha dois campos** (e só esses dois):

   | Campo | Serviço do site | Serviço do app |
   |---|---|---|
   | Install | *(deixe vazio)* | *(deixe vazio)* |
   | Build | *(deixe vazio)* | `npm run build:app` |
   | Start | *(deixe vazio)* | `npm run start:app` |

5. **Variáveis de ambiente:** copie a `DATABASE_URL` do serviço do site. Se
   quiser a categorização automática por IA, adicione também o
   `ANTHROPIC_API_KEY` — sem ele o app funciona igual, só categoriza pelas
   regras.
6. **Domínio:** adicione `meridian.roilabs.com.br` **com o caminho `/app`**. Esse
   campo de caminho é o que separa os dois serviços no mesmo endereço.
7. **Deploy.** Espere terminar e abra `meridian.roilabs.com.br/app`.

**O que você deve ver:** a tela de login. Entre com o usuário `jean` e a sua
senha. Depois do login, o painel de orçamento — **os mesmos números do `/admin`
de hoje**. Vale abrir os dois lado a lado e comparar; é essa a conferência que
falta, e ela fecha também a última linha da 8.6.

**Se `/app` der 404 depois do deploy:** o campo de caminho do domínio não pegou.
É o passo 6.
**Se der 502:** o container não subiu — olhe os logs, lembrando das três
pegadinhas da seção 6 (o painel mostra o container vivo, os horários são UTC, e
`SIGTERM` no fim é normal).
**Se der erro no login:** aí sim é assunto de código, e vale voltar aqui.

**Por que os campos do site continuam vazios:** é isso que faz o Nixpacks ler o
`package.json` da raiz (seção 8.2). Por isso o `build` e o `start` da raiz não
foram tocados — eles são do site. O app ganhou `build:app` e `start:app` ao lado,
justamente para não disputar os mesmos nomes.

**Sobre a versão do Node, que foi o que derrubou o site na 8.5:** aqui o risco é
baixo — o Next 16 pede `>=20.9.0` e o container roda alguma 22.x, então ele cabe
com folga, e nenhum comando de deploy do app usa flag `--env-file`. Mas apareceu
uma inconsistência de propósito duvidoso: o `package.json` da raiz declara
`engines: node >=22.12.0` e o `.nvmrc` diz só `22`. Se o Nixpacks escolher uma
22.0–22.11, o npm apenas **avisa** e segue (não é `engine-strict`), então isso
não quebra nada hoje — mas é a mesma pin frouxa que a 8.5 manda apertar.

Vale notar que **um único comando no terminal do container resolve as duas
coisas**: o `node --version` do Passo 0 da 8.5 é exatamente o número que falta
para fixar o `.nvmrc` e alinhar com o `engines`.

**Rodada C**, só depois de o `/app` estar conferido no ar: apagar `/admin`,
`/login`, `/api/*` e o `middleware.ts` do Astro, deixar `/admin` respondendo 301
para `/app`, e apontar o "Sign in" do `Nav.astro` e do `Pricing.astro` para lá.
Aí somem as duas duplicatas (`BudgetApp.tsx` e `classify-llm.ts`, marcadas como
temporárias no topo de cada arquivo) e o `security.allowedDomains` do
`astro.config.mjs` deixa de ser necessário.

A quebra do `BudgetApp.tsx` em três telas (`/app/orcamento`, `/app/cartoes`,
`/app/metas`) ficou **de propósito para depois da virada**: portar e reorganizar
ao mesmo tempo tira a prova de que a tela não mudou. Primeiro o mesmo painel no
lugar novo, depois a reorganização.

### 8.4. Trocar a senha do Postgres ⚠️

A senha do banco de produção passou por um chat em 2026-08-16. **É a única
pendência com risco de segurança de verdade**, e por isso vem antes das outras.

O que precisa acontecer: a senha muda no banco, e todo mundo que fala com o banco
precisa saber a senha nova. Hoje isso é **três lugares**, e é importante fazer os
três na mesma sessão — entre trocar a senha e atualizar os serviços, o site fica
fora do ar.

1. **EasyPanel → serviço de Postgres → credenciais.** Gere uma senha nova e
   copie a `DATABASE_URL` completa que ele mostrar.
2. **Serviço do site → variáveis de ambiente → `DATABASE_URL`.** Cole a nova e
   faça o redeploy.
3. **Serviço do app** (depois que a rodada B existir) → mesma coisa.
4. **Seu `.env` local**, na pasta do projeto. Só para você conseguir rodar
   `npm run db:migrate` da sua máquina. Esse arquivo o git ignora, e é o único
   lugar certo para essa senha morar.

**Nada no código guarda a senha** — nenhum arquivo do repositório precisa mudar,
e não há commit a fazer aqui.

Depois de trocar, confirme que o site voltou: `meridian.roilabs.com.br/admin`
deve redirecionar para o login (302), e o login deve funcionar. Se der 500 em vez
disso, alguma das cópias da `DATABASE_URL` ficou para trás.

> Enquanto estiver mexendo em variáveis: o `ADMIN_USER`, o `ADMIN_PASSWORD` e o
> `ANTHROPIC_API_KEY` do seu `.env` local estão **vazios** hoje. Não é urgente —
> só significa que dessa máquina não dá para entrar no painel nem testar a
> categorização por IA.

### 8.5. Migração automática no deploy ❌ tentada em 2026-08-16, derrubou o site

**Leia isto inteiro antes de tentar de novo.** O commit `9866ca8` fez o `start`
da raiz virar `npm run db:migrate && npm run start -w @meridian/site`. O
raciocínio continua certo — é o `npm start` que o Nixpacks executa no container,
então ele é o gancho de release que o EasyPanel não oferece. O que estava errado
era o **como**.

**O que aconteceu:** push às 14:06, o site caiu em 502 e ficou assim. Não era o
deploy demorando: era o container em crash-loop, porque o passo de migração
falhava e o `&&` impedia o servidor de subir. Revertido em `de35e6f`, site de
volta às 14:13:37, cerca de um minuto depois do push do revert. **Sete minutos
fora do ar**, site institucional junto.

**A causa provável** (confirmar pelo Passo 0, mais abaixo): junto com
o encadeamento, o commit trocou `--env-file=.env` por `--env-file-if-exists=.env`,
porque no container não existe arquivo `.env` e o Node aborta se o arquivo
nomeado por `--env-file` não estiver lá. Só que **`--env-file-if-exists` só
existe a partir do Node 22.9**, e o `.nvmrc` diz apenas `22` — o Nixpacks
escolhe a 22.x que quiser. Numa versão anterior, o Node não reconhece a opção e
morre antes de executar qualquer linha de código.

O que **não** era a causa, já descartado: credencial, rede e SSL. O `db.ts` que
o site usa conecta com a mesma configuração do `migrate.mjs` (`ssl: false`, mesma
`DATABASE_URL`), e o site consultava o banco normalmente — ver a prova do login
na seção 5.

**Por que os testes locais não pegaram.** Os quatro cenários foram verificados na
máquina de desenvolvimento e passaram, inclusive um chamado de "container
simulado". Mas o que foi simulado era a *ausência do arquivo `.env`* — não o
container. A máquina roda **Node 24**, o container roda outra versão. O teste
tinha a forma da coisa certa e não tocava na variável que importava.

**Passo 0 — confirmar a causa antes de qualquer coisa.** A hipótese acima é
forte, mas continua hipótese: os logs consultados depois da queda eram do
container já revertido, não do que falhou. A confirmação não depende de caçar
log antigo — o EasyPanel tem um **terminal dentro do container** (ícone `>_` na
barra do serviço), e lá dois comandos respondem tudo, sem risco, só leitura:

```
node --version
node --env-file-if-exists=.env packages/db/migrate.mjs --status
```

- `bad option: --env-file-if-exists` → hipótese confirmada, siga o plano abaixo.
- Listar as migrações (`aplicada 0001_baseline.sql`) → **a hipótese está errada**,
  a causa é outra, e o plano abaixo não conserta nada. Descubra antes de repetir.

**Como fazer direito, quando for a hora:**

1. **Não use nenhuma flag `--env-file` no comando de deploy.** No container as
   variáveis já vêm do ambiente do EasyPanel — não há arquivo para ler. Um
   script separado (`"db:migrate:deploy": "node packages/db/migrate.mjs"`, sem
   flag nenhuma) elimina de vez a dependência da versão do Node. O `db:migrate`
   de sempre continua com `--env-file=.env` para uso local.
2. **Fixe a versão do Node no `.nvmrc`** (ex.: `22.12.0` em vez de só `22`),
   usando o número que o `node --version` do Passo 0 revelar. Enquanto disser
   apenas `22`, o container pode mudar de versão sozinho num deploy futuro, sem
   nenhuma mudança no código.
3. **Publique num horário em que dê para acompanhar**, com o revert pronto: o
   conserto real aqui foi `git revert` + push, e levou um minuto.
4. Se quiser uma saída de emergência, ela **não pode viver dentro do processo
   que quebra** — ver a armadilha na seção 6.

### 8.6. ~~Confirmar que o app lê o banco em produção~~ ✅ feito em 2026-08-16

Provado sem precisar de senha, com um `POST` em `/api/login` usando um usuário
inexistente: produção respondeu `302 → /login?error=1`, ou seja, consultou o
banco. O método e as duas pegadinhas (o `Origin` obrigatório e o bloqueio por
IP) estão descritos na seção 5.

Vale ainda entrar em `/admin` e bater os olhos nos 428 lançamentos — as
consultas da tela são outras — mas isso é conferência, não mais risco aberto.

### 8.7. ~~`.claude/` e `.specify/`~~ ✅ feito em 2026-08-16

Versionados em `83caaf1`, 36 arquivos. É para isso que o `specify init` os gera
dentro do repositório: quem clonar tem os mesmos comandos sem instalar nada.

O que decidiu foi `.specify/memory/constitution.md`. Hoje ele é o arquivo de
exemplo intacto — nenhuma linha do Meridian, e nenhuma spec foi escrita ainda —
mas o dia em que a constituição do projeto for escrita, ela é conteúdo do
projeto, não ferramental. Com a pasta ignorada, esse texto nasceria fora do git
sem ninguém perceber: a mesma falha silenciosa que originou as migrações.

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
| 1 | Migrações versionadas | ✅ feito e aplicado em produção (rodar no deploy: 8.5, em aberto) |
| 2 | Monorepo + app Next | 🔨 monorepo feito; app Next construído, falta subir (8.3) |
| 3 | Contas, e-mail, 2FA, Google, LGPD | ⏳ |
| 4 | Capacidade e observabilidade | ⏳ |
| 5 | Perfil Klontz + motor de dívidas | ⏳ |
| 6 | Agente conversacional | ⏳ |
| 7 | ZBB adaptado, contratos prévios, colaborativo, monetização | ⏳ |

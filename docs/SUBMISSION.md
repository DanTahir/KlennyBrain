# Devpost submission: KlennyBrain

## Project name

KlennyBrain

## Tagline

A company brain that answers with receipts, respects who's asking, and fixes the contradictions it
finds, with a human approving every action.

## Inspiration

Every company has the same problem. The answer exists somewhere, but it is buried. It might be in a
Slack thread, a meeting transcript, a ticket, or a policy doc nobody has updated since April. Worse,
those sources often disagree. Support tells customers one thing while the official doc says
another. A launch date moves in Slack but not in the launch plan.

Search tools return links. We wanted a brain that understands how the knowledge connects, knows who
is allowed to see what, and notices when the company contradicts itself. We also wanted it to do
something about those contradictions instead of just reporting them.

## What it does

KlennyBrain ingests a company's knowledge into HydraDB and puts an agent on top of it. The demo
company is Northwind Robotics, a fictional warehouse robotics company. Its dataset has 348 items:
236 Slack messages, 36 emails, 46 tickets and issues, 9 meeting transcripts, 21 docs, and a
14-person directory.

- **Ask the Brain.** You ask a question in plain language. A tool-calling agent searches knowledge,
  explores entities in the graph, finds experts and checks insights. It streams a cited answer with
  source cards. You can open a visible tool-call trace and a "Why this answer" graph. Ask "What is
  blocking the Atlas launch?" and it walks the chain: Atlas GA is blocked by ATL-212 (SAML SSO),
  which waits on a KeyGate vendor cert fix. Downstream, a $480k ARR customer is stuck.
- **Permission-aware answers.** Identity is resolved on the server, and every HydraDB query carries
  an ACL. The CEO asking "What is the Q4 reorg plan?" gets the confidential plan. The intern asking
  the same question gets nothing confidential. Owners and admins can "View as" any persona, and
  that use is audited.
- **Insights.** An analysis job reads everything and extracts decisions and action items from
  meetings, flagging the overdue ones. It also extracts claims across docs, Slack, tickets and email
  and verifies conflicting ones. The result is contradiction and stale-doc insights with citations
  on both sides. For example, the refund policy doc says 14 days, while #support and the refund
  macro say 30 days. Insights inherit the ACLs of their evidence, so a contradiction built from
  confidential docs is invisible to members.
- **Agentic actions with human approval.** Click "Fix it" on an insight. The agent proposes three
  actions:
  - a corrected knowledge doc
  - a Slack message to the owning channel
  - a GitHub issue

  Nothing runs until an owner or admin approves. On approval it creates the GitHub issue, posts to
  Slack with a permalink, and writes the corrected doc back into HydraDB. It then re-verifies and
  auto-resolves the related insights, so the brain corrects itself. Ask "What is our refund window?"
  again and you get a consistent 30-day answer.
- **Slack bot.** Mention @brain or DM it and it answers in the thread. The `/brain` command answers
  in-channel. Replies are Block Kit answers with numbered sources, an "Open in KlennyBrain" button,
  and a footer stating whose permissions applied. Unmapped Slack users get answers from public
  knowledge only.
- **Live Slack ingestion.** The bot also listens. New human messages in its channels are upserted
  into HydraDB as they happen, with thread links, author attribution and private-channel ACLs. A
  fact said in Slack can be asked about in the brain about a minute later.
- **Brain Home.** A dashboard with suggested questions, knowledge stats, open insights, recent agent
  actions and integration status.

## How we built it

**Stack.** We started from the digohq/app-starter base:

- API: NestJS 11, Prisma 7 and PostgreSQL
- Web: Next.js 16, React 19, TanStack Query and Tailwind CSS
- Monorepo: Turborepo and pnpm

LLMs run through OpenRouter. `anthropic/claude-sonnet-5.5` handles the agent loop and answers.
`anthropic/claude-haiku-5.5` handles fast bulk extraction. Slack runs on Bolt in Socket Mode, so no
public URL is needed. Actions use the GitHub REST API.

**Use of the Brain: HydraDB.**

- **Layout.** Each org gets its own database (`brain_<orgSlug>`, collection `default`). Items are
  ingested as app_knowledge with a small declared metadata schema: `source_system`, `channel`,
  `department`, `project`, `author` and `doc_type`. Everything else goes in `additional_metadata`.
- **Relations.** We send explicit relations (`blocks`, `related_to`, `thread_id`, `reply_to`), so
  the graph knows that ATL-200 is blocked by ATL-212.
- **Ingestion.** Ingestion runs in batches of 20 with backoff and uses upsert, so re-running a sync
  is idempotent. A KnowledgeItem mirror in Postgres powers stats and the UI.
- **Retrieval.** The agent queries in thinking mode with graph context and a required ACL.
  `explore_entity` uses HydraDB subgraph and relations together with the people directory.
- **Graph view.** The "Why this answer" graph is built from HydraDB graph context and the subgraph
  around the cited sources.
- **Feedback.** Thumbs up and down are forwarded to the HydraDB feedback API.

**Agentic Capability: the agent loop.** The agent runs up to 5 tool steps within a 60-second
budget. Its tools are:

- `search_knowledge`
- `explore_entity`
- `find_experts`
- `list_insights`
- `propose_github_issue`
- `propose_slack_message`
- `propose_doc_update`

The API streams typed server-sent events (`status`, `tool_call`, `sources`, `graph`, `token`,
`action_proposed`, `done`) defined in a shared TypeScript contract. A JSON fallback covers clients
that can't stream. Conversations are stored in Postgres.

**ACL design.** ACL strings are one of three forms:

| ACL string | Used for |
|---|---|
| a user's email | items tied to one person |
| `group:slack:<channel>` | private Slack channels |
| `group:dept:<dept>` | restricted docs |

Public items carry no ACL. The HydraDB service refuses to search without an ACL and throws a
`MissingAclError`. This is not optional: in our spike, a query sent without an ACL returned
restricted items.

**Insights pipeline.** The pipeline runs in four steps:

1. A meeting parser plus the fast model extracts decisions and action items, with owners and due
   dates.
2. A claims pass pulls `{subject, attribute, value, source, date}` from docs, Slack, tickets and
   email.
3. The claims are grouped.
4. The answer model verifies conflicting groups and produces CONTRADICTION insights, plus STALE_DOC
   insights for the older doc.

A typical run produces about 15 decisions, 9 action items, 7 contradictions and 4 stale docs in
about 55 seconds.

**Approval-gated actions.** Actions follow a strict propose, approve, execute lifecycle. Proposals
have no side effects. Approval is restricted to OWNER and ADMIN, and a MEMBER gets a 403. Execution
then calls GitHub, Slack and HydraDB.

**Ingestion architecture.** Ingestion goes through a single SourceAdapter interface. The DemoAdapter
implements it today, and the interface is ready for Slack, Gmail, Drive and Notion. An in-process
JobRunner tracks SyncJob progress.

## Challenges we ran into

- **HydraDB metadata rules.** Databases created with a metadata schema reject undeclared metadata
  keys, so we keep the declared schema small and push everything else into `additional_metadata`.
  `source_type` turned out to be a reserved field name: create returns a generic 400. We use
  `source_system` instead.
- **Indexing latency.** Items reach `graph_creation` in under a minute, but the full graph takes
  about 4 minutes to complete. We treat `graph_creation` as searchable, so a freshly loaded company
  is usable almost immediately.
- **Enforcing ACLs everywhere.** ACLs are only enforced when a query sends one. We made the ACL a
  required parameter on every search, including the insight pipeline. Insights inherit the ACLs of
  their evidence, so derived knowledge can't leak what the source knowledge hides.
- **Streaming with auth.** Streaming SSE through Next.js to an authenticated NestJS API needed
  careful handling. We added a JSON fallback so the Ask page never breaks.
- **Keeping actions safe.** An agent that can post to Slack and open GitHub issues needs guardrails.
  Splitting propose, approve and execute keeps the agent useful without giving it unsupervised side
  effects.
- **Windows-friendly tooling.** All scripts work from Git Bash on Windows, using cross-env and
  rimraf.
- **One day.** We built the dataset, ingestion, agent, insights, actions, Slack bot and dashboard in
  a single day.

## Accomplishments that we're proud of

- **The brain corrects itself.** It finds a contradiction, proposes a fix, and a human approves it.
  The fix lands in GitHub, Slack and HydraDB, and the related insight auto-resolves. The next answer
  is consistent.
- **Permissions are enforced in retrieval.** The CEO and the intern can ask the same question and
  get provably different answers. Derived insights respect the same boundaries.
- **Answers you can verify.** Every claim is cited, the tool trace is visible, and a "Why this
  answer" graph shows the reasoning.
- **A synthetic company with ground truth.** The dataset has planted facts and golden questions in
  `data/demo/GROUND_TRUTH.md`, a validator, and `node scripts/smoke.mjs`. The smoke script runs 8
  end-to-end checks, including the ACL difference between CEO and intern.
- **The brain where people already work.** It answers in the web app and in Slack, with the same
  permissions in both.

## What we learned

- A graph-aware store changes the kind of question you can answer. Explicit relations like `blocks`
  turn "what is blocking X?" into a walk of the graph instead of a keyword match.
- Access control has to live at the query layer. If an unscoped query can return restricted data,
  the application must make unscoped queries impossible.
- Contradiction detection works best as two passes: cheap extraction with a fast model, then
  careful verification of only the conflicting groups with a stronger model.
- Human approval is a feature, not friction. People trust agentic actions far more when they can
  see the proposal first.

## What's next

- Slack history backfill plus Gmail, Drive and Notion adapters on the existing SourceAdapter interface
- Mirroring Slack edits and deletes into the live-ingested knowledge
- A full graph explorer beyond the per-answer mini graph
- BullMQ-backed jobs to replace the in-process JobRunner
- An MCP server, so other agents can query the brain with the same ACLs
- Email actions alongside Slack, GitHub and doc updates

## Built with

TypeScript, NestJS, Next.js, React, Prisma, PostgreSQL, Redis, HydraDB, OpenRouter, Claude, Slack Bolt, GitHub REST API, Tailwind CSS, Turborepo, pnpm, Docker

## Try it / links

- **Repository:** https://github.com/DanTahir/KlennyBrain
- **Quick start:** see the [README](../README.md). The short version:

  ```bash
  pnpm bootstrap
  pnpm dev
  ```

  1. Open http://localhost:3000 and log in as `elena@northwind.dev`.
  2. On the Sources page, click "Load demo company".
  3. On the Insights page, click "Run analysis".

- **Demo action target repo:** https://github.com/DanTahir/northwind-atlas-tracker (example issue
  created by an approved agent action: https://github.com/DanTahir/northwind-atlas-tracker/issues/1)
- **Demo script:** [docs/DEMO.md](DEMO.md)
- **HydraDB findings:** [docs/hydra-findings.md](hydra-findings.md)

KlennyBrain is built on digohq/app-starter (MIT, Copyright Adam Hong).
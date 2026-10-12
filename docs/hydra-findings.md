# HydraDB spike findings

Measured on 2026-10-12 against HydraDB Cloud (API version 2.0.1) with `@hydradb/sdk` 2.1.7, using
`scripts/spikes/hydra-spike.mjs` (throwaway database `brain_spike`, 5 app_knowledge items).

## Provisioning

| Step | Result |
|---|---|
| `databases.create({ database, databaseMetadataSchema })` | 202 accepted; creation runs in the background |
| Time to `status.infra.readyForIngestion = true` | ~17 s |
| Metadata schema | `VARCHAR` + `enableMatch` fields work. **`source_type` is a reserved field name** (create returns a generic 400 `INVALID_INPUT`), so KlennyBrain uses `source_system` instead |
| Database name | `brain_<slug>` (underscores) accepted |

Final schema: `source_system`, `channel`, `department`, `project`, `author`, `doc_type` (all VARCHAR, enableMatch, maxLength 128).

## Ingestion latency (5 items, one request)

| Status | First seen after |
|---|---|
| `queued` / `processing` | ~7 s |
| `graph_creation` (searchable) | 26–43 s |
| `completed` (graph built) | 4.0–4.6 min |

The ingest call itself took ~1 s. Items are searchable from `graph_creation`, so the demo ingest is
usable well before the knowledge graph finishes.

## Query

| Probe | Result |
|---|---|
| `mode: "fast"` latency | 230–450 ms |
| `mode: "thinking"` latency | ~900 ms; sharper scores (0.98 vs 0.84 for the top hit) and `graphContext.chunkRelations` populated |
| Response shape | `{ success, data, error, meta }`; `meta.requestId` is used for `feedback.submit` |
| `data` keys | `chunks`, `sources`, `graphContext`, `additionalContext`, `graph`, `forcefulRelations`, `appSearchFusion`, `llmPrompt` |
| Chunk text | HydraDB renders app_knowledge as Markdown (`## Title`, `## Message Details`, `From: …`), so author and title are visible to the LLM |
| `graphContext.queryPaths` | Empty on this tiny dataset. Do not rely on it alone |

## ACL (critical)

| Query ACL | Restricted `#leadership` item (`acl: ["group:slack:leadership"]`) |
|---|---|
| none | **returned** (ACL is only enforced when one is sent) |
| `["intern@northwind.dev"]` | hidden |
| `["ceo@northwind.dev", "group:slack:leadership"]` | returned |

So `HydraService.search` must always send an ACL; it is a required parameter in KlennyBrain.

## Graph APIs

- `context.subgraph({ id, database, collection, depth: 2, maxSources })` works well. It returns:
  - `sources` with `depth` and `discoveredRelation`. Explicit `relations: [{ predicate: "blocks", target: { external_id, provider } }]` resolved to the target source.
  - `relations` (`canonicalPredicate`, `confidence`, `relationshipId`).
  - `auxiliaryRelations` with auto-extracted entities (`ACTOR` for authors, `EVENT` for dates such as "2026-10-14").
- `context.relations({ database, id })` returned an empty list in this probe; subgraph is the primary graph API.
- The "why this answer" graph is therefore built from `subgraph` around the top cited sources, plus any
  `queryPaths` triplets, plus the KnowledgeItem/DirectoryPerson overlay.

## LLM spike (OpenRouter, `scripts/spikes/llm-spike.mjs`)

| Model | Stream TTFT | Tool call | `json_schema` |
|---|---|---|---|
| `anthropic/claude-sonnet-5.5` (reasoning effort low) | 1.26 s | correct `search_knowledge` call, 1.4 s | valid, 3.9 s |
| `anthropic/claude-haiku-5.5` | 0.79 s | correct call, 1.2 s | valid, 2.0 s |

Sonnet TTFT is well under the 8 s threshold, so the agent loop uses Sonnet for both tool routing and
synthesis. Haiku handles bulk extraction (insights and the claims pass).

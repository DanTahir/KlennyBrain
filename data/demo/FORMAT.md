# Northwind demo dataset: format contract

This folder holds the synthetic company used by KlennyBrain's demo source
adapter (`apps/api/src/ingestion/adapters/demo.adapter.ts`). Everything here is
fictional. `company.json` is the story bible and the single source of truth for
people, customers, projects, vendors, channels and ACL groups. Every other file
must use **only** the ids and emails defined there.

Timeline: every timestamp is between `2026-04-12T00:00:00Z` and
`2026-10-12T23:59:59Z`. All timestamps are ISO-8601 UTC strings (`Z` suffix).

ACL rules:
- Omit `acl` (or use `null`) for content visible to everyone in the company.
- Restricted content uses `acl: ["group:..."]`, with values only from
  `company.json#aclGroups`, or person emails.
- Every message in the private `#leadership` channel is implicitly
  `group:slack:leadership` (the adapter adds it). Do not set acl on Slack
  messages.

## Layout

| Path | Contents |
|---|---|
| `company.json` | Story bible (do not edit without updating every file) |
| `slack/users.json` | Slack-style user list derived from `company.json#people` |
| `slack/channels.json` | Slack-style channel list derived from `company.json#slackChannels` |
| `slack/<channel-name>/YYYY-MM-DD.json` | Messages for that channel on that UTC day |
| `email/threads.json` | Email threads |
| `docs/<slug>.md` | Docs, policies, FAQs, runbooks, specs (Markdown + YAML front-matter) |
| `meetings/<YYYY-MM-DD>-<slug>.json` | Meeting transcripts |
| `tickets/tickets.json` | Zendesk-style support tickets |
| `issues/issues.json` | Linear-style engineering issues |
| `GROUND_TRUTH.md` | Golden questions with expected answers and the evidence files |

## slack/users.json

```json
[{ "id": "U06MEI", "name": "mei", "real_name": "Mei Chen", "profile": { "email": "mei@northwind.dev", "title": "Staff Engineer" } }]
```

## slack/channels.json

```json
[{ "id": "C03ATLAS", "name": "atlas-launch", "is_private": false, "purpose": { "value": "..." }, "members": ["U09SAM", "U07DEVON"] }]
```

`members` is a list of Slack user ids. A `"members": "all"` entry in the bible means every person.

## slack/<channel>/YYYY-MM-DD.json

An array of messages, ordered by time:

```json
[
  {
    "id": "atlas-20260924-01",
    "type": "message",
    "user": "U09SAM",
    "iso": "2026-09-24T17:05:00Z",
    "text": "Heads up: we're moving the Atlas launch from Sep 30 to Oct 14. ATL-212 (SSO) is still blocked on KeyGate.",
    "thread_id": null,
    "reactions": [{ "name": "eyes", "count": 3 }]
  },
  {
    "id": "atlas-20260924-02",
    "type": "message",
    "user": "U07DEVON",
    "iso": "2026-09-24T17:12:00Z",
    "text": "Confirming. KeyGate says the SAML metadata fix lands Oct 9 at the earliest.",
    "thread_id": "atlas-20260924-01"
  }
]
```

- `id` is unique across the whole dataset. Format: `<channel>-<yyyymmdd>-<nn>`.
- `thread_id` is the `id` of the thread's parent message (same channel, same day or earlier), or `null` for top-level messages.
- `user` must be a `slackId` from `company.json`. The file date must equal the UTC date of `iso`.
- Slack mrkdwn is fine in `text` (`*bold*`, `<@U07DEVON>` mentions, `ATL-212` references).

## email/threads.json

```json
[
  {
    "thread_id": "email-globex-sso-escalation",
    "subject": "Atlas rollout blocked without SSO",
    "labels": ["customer", "escalation"],
    "messages": [
      {
        "id": "email-globex-sso-escalation-1",
        "from": "dana.whitfield@globexlogistics.com",
        "to": ["omar@northwind.dev"],
        "cc": ["lena@northwind.dev"],
        "date": "2026-09-26T15:20:00Z",
        "body": "Plain-text body...",
        "in_reply_to": null
      }
    ],
    "acl": null,
    "customer": "globex",
    "project": "atlas"
  }
]
```

- Addresses are emails from `company.json#people` or `#externalContacts`.
- `in_reply_to` is the `id` of an earlier message in the same thread, or `null`.
- `customer` (a customer id or `null`) and `project` (a project id or `null`) are optional context.

## docs/<slug>.md

```markdown
---
id: doc-refund-policy
title: Refund Policy
owner: priya@northwind.dev
department: support
doc_type: policy
project: null
created_at: 2026-04-14T18:00:00Z
updated_at: 2026-04-20T18:00:00Z
acl: null
url: https://wiki.northwind.dev/support/refund-policy
---

# Refund Policy

Body in Markdown...
```

- `doc_type` is one of `policy`, `faq`, `runbook`, `spec`, `prd`, `adr`, `handbook`, `plan`, `macro`, `pricing`, `hr`.
- `acl` is `null` or a YAML flow list like `[group:dept:exec, group:dept:people]`.
- `department` is a department from the bible (`exec`, `people`, `engineering`, `product`, `support`, `success`, `sales`).
- Docs must be under ~6 KB each.

## meetings/<YYYY-MM-DD>-<slug>.json

```json
{
  "id": "mtg-20260916-atlas-go-no-go",
  "title": "Atlas launch go/no-go",
  "date": "2026-09-16T17:00:00Z",
  "duration_minutes": 45,
  "attendees": ["sam@northwind.dev", "raj@northwind.dev"],
  "project": "atlas",
  "acl": null,
  "transcript": [
    { "speaker": "sam@northwind.dev", "t": "00:01", "text": "..." }
  ],
  "summary": "One-paragraph summary.",
  "decisions": ["Launch Atlas GA on 2026-09-30 provided ATL-212 is closed by 2026-09-26."],
  "action_items": [
    { "owner": "devon@northwind.dev", "text": "Get a firm date from KeyGate for the SAML metadata fix", "due": "2026-09-19", "status": "open" }
  ]
}
```

- `t` is `mm:ss` minutes from the start. `status` is `open` or `done`. `due` is `YYYY-MM-DD`.

## tickets/tickets.json (Zendesk-style)

```json
[
  {
    "id": "ZD-1042",
    "subject": "R2 drops Wi-Fi every few hours after firmware 2.8",
    "requester": { "name": "Pat Lin", "email": "pat.lin@hooliretail.com" },
    "customer": "hooli",
    "status": "open",
    "priority": "high",
    "tags": ["wifi", "firmware-2.8", "r2"],
    "assignee": "marco@northwind.dev",
    "created_at": "2026-08-12T14:00:00Z",
    "updated_at": "2026-08-14T09:30:00Z",
    "linked_issue_ids": ["FW-77"],
    "comments": [
      { "author": "pat.lin@hooliretail.com", "created_at": "2026-08-12T14:00:00Z", "body": "...", "public": true }
    ]
  }
]
```

- `status` is one of `new`, `open`, `pending`, `solved`, `closed`; `priority` is one of `low`, `normal`, `high`, `urgent`.
- Customer requesters may use any plausible email at the customer's domain (not listed in the bible).
- `linked_issue_ids` reference ids in `issues/issues.json`.

## issues/issues.json (Linear-style)

```json
[
  {
    "id": "ATL-212",
    "title": "Enterprise SAML SSO via KeyGate",
    "project": "sso",
    "state": "blocked",
    "assignee": "devon@northwind.dev",
    "reporter": "sam@northwind.dev",
    "labels": ["atlas", "enterprise", "auth"],
    "priority": "urgent",
    "created_at": "2026-08-20T16:00:00Z",
    "updated_at": "2026-10-08T18:00:00Z",
    "blocked_by": [],
    "blocks": ["ATL-200"],
    "related": ["ATL-215"],
    "description": "Markdown description...",
    "comments": [
      { "author": "devon@northwind.dev", "created_at": "2026-09-22T19:00:00Z", "body": "..." }
    ]
  }
]
```

- `state` is one of `backlog`, `todo`, `in_progress`, `blocked`, `in_review`, `done`, `canceled`.
- `project` is a project id from the bible. Prefixes: `ATL-` (Atlas and SSO), `BIL-` (billing-v2), `FW-` (firmware), `SUP-` (support tooling).
- `blocked_by`, `blocks` and `related` reference other issue ids in this file. Keep `blocks` and `blocked_by` mutually consistent.

## Planted facts (must stay consistent across files)

1. **Refund window contradiction.** `docs/refund-policy.md` (updated 2026-04-20, owner Priya) says **14 days**. The 2026-08-18 "Support & Finance policy review" meeting decided **30 days**, with an action item for Priya to update the doc by 2026-08-25. It is still `open`; the doc is stale. `#support` (2026-09-02, Priya) and `docs/macro-refund-request.md` (updated 2026-08-21) say 30 days. At least 2 tickets quote 30 days, and one older ticket (May) quotes 14 days.
2. **Launch date reversal.** The 2026-09-16 Atlas go/no-go meeting decided GA on **2026-09-30**. On 2026-09-24, Sam posts in `#atlas-launch` (thread) that launch moves to **2026-10-14** because ATL-212 is blocked. ATL-212 has a comment referencing the move. `#general` gets an announcement on 2026-09-25.
3. **Blocker chain.** ATL-200 (Atlas GA epic) is blocked by ATL-212 (SAML SSO, assignee Devon). Devon is waiting on KeyGate (email thread with victor@keygate.io: the signing-cert rotation bug in the SAML metadata endpoint; fix ETA Oct 9, then slipped to "Oct 13 at the earliest" on Oct 8). Globex (Dana Whitfield) escalation email on 2026-09-26 to Omar: Globex cannot roll out Atlas to 120 robots without SSO, and the $480k renewal on 2026-11-30 is at risk. Omar raises it in `#atlas-launch`.
4. **Billing expert.** Mei Chen is the go-to for the billing service. She answers billing questions in `#eng` and `#support`, owns `docs/runbook-billing-service.md` and `docs/adr-007-paystream-migration.md`, is assignee on BIL- issues, and fixed the July Stark proration bug (ZD ticket linked to BIL-31).
5. **ACL / leadership.** The Q4 reorg (Support and Customer Success merge under Ana Gomez, effective 2026-11-01) and the comp-band adjustment (+6% for engineering bands, effective 2027-01-01) appear **only** in `#leadership` messages and in `docs/hr-q4-comp-bands.md` and `docs/leadership-q4-reorg-plan.md` (acl `[group:dept:exec, group:dept:people]`). Nothing public mentions them.
6. **Repeated support issue.** At least 6 tickets from different customers (Hooli, Acme Foods, Umbrella, Wayne, Initech, Soylent) report R2 Wi-Fi drops after firmware 2.8, all linked to FW-77. There is no FAQ entry for it (knowledge gap).
7. **Overdue action items.** On 2026-10-12, these are overdue and `open`: Priya "update refund policy doc to 30 days" (due 2026-08-25); Devon "escalate to KeyGate exec sponsor" (due 2026-10-02); Lena "send Globex a written SSO timeline" (due 2026-10-05). Not overdue: Sam "publish Atlas launch comms" (due 2026-10-14). There are a few `done` items as well.

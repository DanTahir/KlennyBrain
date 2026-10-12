# Northwind demo: ground truth

These are the facts planted in the synthetic dataset, the golden questions that exercise them, and
the evidence a correct answer should cite. `scripts/smoke.mjs` asks each question and checks the
expected keywords and that at least one citation is returned. Validate the dataset with
`node scripts/demo-data/validate.mjs`.

"Today" in the dataset is **2026-10-12**.

## Personas

| Login | Person | Role in app | Can see |
|---|---|---|---|
| `elena@northwind.dev` | Elena Park, CEO | OWNER (can use "view as") | Everything, including `#leadership` and exec/people docs |
| `jordan@northwind.dev` | Jordan Blake, Eng Manager | ADMIN | Everything public; not `#leadership` or exec/people docs |
| `marco@northwind.dev` | Marco Rossi, Support Engineer | MEMBER | Everything public |
| `ollie@northwind.dev` | Ollie Grant, Intern | MEMBER | Everything public |

All demo passwords: `Password123!`.

## Golden questions

### 1. "What is our refund window?"
- **Expected:** 30 days. The Aug 18, 2026 Support & Finance policy review extended it from 14 to 30 days. The refund macro and #support say 30 days, but the Refund Policy doc (last updated 2026-04-20) still says 14 days and is stale. Flag this as a contradiction.
- **Keywords:** `30 days`, `14 days`
- **Evidence:** `meetings/2026-08-18-support-finance-policy-review.json`, `docs/refund-policy.md`, `docs/macro-refund-request.md`, `slack/support/2026-09-02.json`, `slack/support/2026-10-02.json`, refund tickets in `tickets/tickets.json`.

### 2. "When does Atlas launch and why did it move?"
- **Expected:** The go/no-go on 2026-09-16 set GA for 2026-09-30. On 2026-09-24 Sam Rivera moved it to **2026-10-14** because ATL-212 (Enterprise SAML SSO via KeyGate) is blocked. The launch plan doc still says Sep 30 (stale).
- **Keywords:** `October 14` or `Oct 14` or `2026-10-14`, `ATL-212`
- **Evidence:** `meetings/2026-09-16-atlas-go-no-go.json`, `slack/atlas-launch/2026-09-24.json`, `slack/general/2026-09-25.json`, `issues/issues.json` (ATL-200, ATL-212), `docs/atlas-launch-plan.md`.

### 3. "What is blocking the Atlas launch?"
- **Expected:** The chain runs as follows:
  - ATL-200 (Atlas GA) is blocked by ATL-212 (SAML SSO, owner Devon Lee).
  - ATL-212 is waiting on KeyGate Identity to fix a signing-cert rotation bug in their SAML metadata endpoint.
  - KeyGate's ETA was Oct 9, then slipped on Oct 8 to "Oct 13 at the earliest", which puts Oct 14 at risk.
  - Downstream, Globex Logistics ($480k ARR, 120 robots, renewal 2026-11-30) can't roll out without SSO.
- **Keywords:** `ATL-212`, `KeyGate`, `Globex`
- **Evidence:** `issues/issues.json` (ATL-200, ATL-212), `email/threads.json` (`email-keygate-saml-metadata`, `email-globex-sso-escalation`), `slack/atlas-launch/2026-09-22.json`, `slack/atlas-launch/2026-09-26.json`, `slack/atlas-launch/2026-10-08.json`, `docs/runbook-sso-keygate.md`.

### 4. "Who knows the billing service?"
- **Expected:** Mei Chen (Staff Engineer). She owns the billing service runbook and ADR-007 (PayStream migration), is the assignee on BIL- issues, answers billing questions in #eng and #support, and fixed the July Stark Distribution proration bug (BIL-31). Jordan Blake is the secondary.
- **Keywords:** `Mei Chen`
- **Evidence:** `docs/runbook-billing-service.md`, `docs/adr-007-paystream-migration.md`, `issues/issues.json` (BIL-31, BIL-40), `slack/eng/*.json`, `meetings/2026-07-22-billing-proration-postmortem.json`.

### 5. "What is the Q4 reorg plan?" (permission-aware)
- **As Elena (CEO):** Support and Customer Success merge into Customer Experience under Ana Gomez, effective 2026-11-01. Priya and Omar report to Ana. It will be announced at the Oct 20 all-hands. Engineering comp bands rise 6% effective 2027-01-01.
- **As Ollie (intern):** Not found in the brain (no access). The answer must not leak any of the above.
- **Keywords (CEO):** `Ana`, `Customer Experience` or `merge`. **Forbidden (intern):** `Ana Gomez`, `merge`, `6%`.
- **Evidence:** `slack/leadership/*.json`, `docs/leadership-q4-reorg-plan.md`, `docs/hr-q4-comp-bands.md`, `meetings/2026-10-07-leadership-offsite-prep.json` (all ACL-restricted).

### 6. "What are customers' most common support problems right now?"
- **Expected:** R2 Picker Wi-Fi roaming drops after firmware 2.8. There are 7 tickets from Hooli, Acme Foods, Umbrella, Wayne, Initech, Soylent and Stark, all linked to FW-77, with the 2.8.1 hotfix (FW-80) in review. There is no FAQ/KB article yet (SUP-14 is in backlog), which is a knowledge gap.
- **Keywords:** `Wi-Fi`, `2.8`, `FW-77`
- **Evidence:** `tickets/tickets.json`, `issues/issues.json` (FW-77, FW-80, SUP-14), `slack/support/2026-08-13.json`, `slack/support/2026-08-27.json`, `docs/support-faq.md` (missing entry).

### 7. "What action items are overdue?"
- **Expected (open, due before 2026-10-12):**
  - Priya Shah: update the Refund Policy doc to 30 days (due 2026-08-25).
  - Devon Lee: escalate to the KeyGate exec sponsor (due 2026-10-02).
  - Lena Fischer: send Globex a written SSO timeline (due 2026-10-05, repeated at the Oct 6 QBR with a due date of 2026-10-09).
  - Raj's leadership follow-up (due 2026-10-09) is only visible to execs.
  - Not overdue: Sam Rivera, publish Atlas launch comms (due 2026-10-14).
- **Keywords:** `Priya`, `Devon`, `Lena`
- **Evidence:** `meetings/2026-08-18-support-finance-policy-review.json`, `meetings/2026-09-29-atlas-launch-replan.json`, `meetings/2026-10-06-globex-qbr.json`.

## Insights the analyzer should find

| Type | Finding |
|---|---|
| CONTRADICTION | Refund window: `docs/refund-policy.md` (14 days) vs the 2026-08-18 decision, the macro and #support (30 days) |
| STALE_DOC | `docs/refund-policy.md` (superseded 2026-08-18) |
| STALE_DOC | `docs/atlas-launch-plan.md` says GA 2026-09-30; moved to 2026-10-14 on 2026-09-24 |
| DECISION | Refund window extended to 30 days (2026-08-18); Atlas GA set for 2026-09-30 (2026-09-16); Atlas GA moved to 2026-10-14 (2026-09-24); accelerate the PayStream migration (2026-07-22) |
| ACTION_ITEM | The overdue items listed under question 7 |

---
id: doc-onboarding-engineering
title: Engineering Onboarding Guide
owner: jordan@northwind.dev
department: engineering
doc_type: handbook
project: null
created_at: 2026-04-15T17:00:00Z
updated_at: 2026-06-10T18:30:00Z
acl: null
url: https://wiki.northwind.dev/engineering/onboarding-engineering
---

# Engineering Onboarding Guide

Welcome to Northwind Engineering! This guide covers your first two weeks. Your manager is Jordan Blake (Engineering Manager, Platform) unless your offer letter says otherwise.

## Week 1

- Get laptop access, GitHub, Linear (https://linear.northwind.dev) and the wiki (https://wiki.northwind.dev).
- Join Slack channels: `#eng`, `#general`, `#atlas-launch` (if you work on Atlas) and `#support` (read-only is fine).
- Run the local dev stack for Atlas Fleet Manager and the billing service. Use the README in each repo.
- Pick a "good first issue" in Linear tagged `starter`. Pair with your onboarding buddy.

## Week 2

- Shadow one on-call shift (see the On-call Policy). You are not paged during your first 30 days.
- Ship your first PR to production. Every PR needs one approving review and green CI.
- Read the ADRs, especially ADR-007 (PayStream migration).

## Who to ask

| Topic | Person | Slack |
|---|---|---|
| Billing service, invoicing, PayStream, Postgres | **Mei Chen** (Staff Engineer) | `<@U06MEI>` |
| Auth, SSO, SAML, KeyGate integration | **Devon Lee** (Senior Engineer, Identity) | `<@U07DEVON>` |
| R2 firmware, robotics, architecture | Raj Mehta (CTO) | `<@U02RAJ>` |
| Atlas product scope and roadmap | Sam Rivera (Senior PM, Atlas) | `<@U09SAM>` |
| Design system, UX | Kai Nakamura | `<@U10KAI>` |
| On-call, delivery, hiring, anything else | Jordan Blake | `<@U05JORDAN>` |

Mei Chen is the go-to for anything touching the billing service. If an invoice looks wrong, ask Mei before you touch proration code. Devon Lee owns the KeyGate SAML integration, so loop him in on any login or session change.

## Conventions

- Issue prefixes: `ATL-` (Atlas and SSO), `BIL-` (billing), `FW-` (firmware), `SUP-` (support tooling).
- Put the issue ID in your branch name and PR title, e.g. `BIL-42-fix-tax-rounding`.
- Write an ADR for any decision that is hard to reverse.
- Do not paste customer data into Slack. Link the Zendesk ticket instead.
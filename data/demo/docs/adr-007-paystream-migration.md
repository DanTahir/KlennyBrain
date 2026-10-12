---
id: doc-adr-007-paystream-migration
title: "ADR-007: Migrate invoicing to PayStream usage-based billing"
owner: mei@northwind.dev
department: engineering
doc_type: adr
project: billing-v2
created_at: 2026-05-20T18:00:00Z
updated_at: 2026-08-05T17:00:00Z
acl: null
url: https://wiki.northwind.dev/engineering/adr-007-paystream-migration
---

# ADR-007: Migrate invoicing to PayStream usage-based billing

**Status:** Accepted (2026-06-02) · **Author:** Mei Chen · **Reviewers:** Jordan Blake, Raj Mehta

## Context

The legacy billing service builds invoices with in-house code: flat lease pricing, hand-rolled proration and PDF generation. Atlas adds per-robot monthly pricing ($40 Standard, $55 Enterprise) with frequent mid-cycle fleet changes. The in-house proration code is fragile. The July Stark Distribution overcharge (BIL-31) was caused by a fixed 30-day period assumption.

## Decision

Move invoicing, payment collection and dunning to **PayStream** usage-based billing. `billing-svc` stays the source of truth for subscriptions and robot counts and reports usage to PayStream daily. PayStream handles proration, invoices, tax and payments.

## Migration plan

1. **Shadow mode** (Jul–Aug): mirror usage to PayStream and compare its invoices with ours. Any diff over $1 opens a BIL- issue.
2. **Cutover by cohort:** SMB first, then mid-market, then enterprise. Each enterprise customer is cut over only after CSM sign-off.
3. **Decommission** legacy invoice generation after two clean billing cycles.

## Consequences

- Fewer billing bugs. We stop maintaining proration math.
- New vendor dependency. Webhooks become critical (see the Billing Service Runbook).
- PayStream charges 0.6% of invoiced volume.
- Historic invoices stay in the legacy DB; Support needs both views until decommission.

## Alternatives considered

- **Fix the in-house engine:** cheaper short term, but it keeps proration risk and doesn't give us usage billing.
- **Other billing vendors:** weaker usage metering APIs and no dedicated account manager.

## Contacts

Questions go to Mei Chen. PayStream account manager: Rina Kapoor (rina@paystream.com).
---
id: doc-runbook-billing-service
title: Billing Service Runbook
owner: mei@northwind.dev
department: engineering
doc_type: runbook
project: billing-v2
created_at: 2026-05-06T17:00:00Z
updated_at: 2026-08-03T16:30:00Z
acl: null
url: https://wiki.northwind.dev/engineering/runbook-billing-service
---

# Billing Service Runbook

**Owner:** Mei Chen (Staff Engineer)

## Architecture

- `billing-svc` (Node/TypeScript) owns subscriptions, R2 leases ($1,450/month) and Atlas seats ($40 or $55 per robot/month).
- Postgres `billing` DB: `subscriptions`, `line_items`, `invoices`, `paystream_events`.
- A nightly job at 02:00 UTC builds draft invoices. During the Billing v2 migration (ADR-007), usage is mirrored to PayStream, which sends invoices and collects payment.
- PayStream calls us back through webhooks at `/webhooks/paystream`.

## Proration logic

Mid-cycle changes (robots added or removed, tier upgrades) are prorated by day:

`amount = monthly_price * units * (days_remaining / days_in_period)`

- `days_in_period` is the length of the **customer's** billing period, not the calendar month.
- Credits for removed units are separate negative line items. Never net them into the original line.

### July incident: Stark Distribution (BIL-31)

In July, Stark Distribution got an overcharged invoice after adding robots mid-cycle. The cause: proration used a fixed 30-day period and double-counted the add date. Mei Chen fixed it in BIL-31 (period-aware day count, inclusive/exclusive boundaries) and issued a credit memo. A regression test now covers 28/29/30/31-day periods.

## PayStream webhooks

| Event | Handler action |
|---|---|
| `invoice.finalized` | store PayStream invoice id |
| `payment.succeeded` | mark invoice paid |
| `payment.failed` | flag account, notify CSM |
| `usage.rejected` | alert on-call, see below |

Webhooks are signed. We verify the HMAC with the secret in the vault and dedupe by `event_id`.

## Common failures

- **Signature verification failures:** usually a rotated secret. Re-sync from the vault and replay from the PayStream dashboard.
- **`usage.rejected`:** unknown customer mapping. Check `paystream_customer_id` on the subscription.
- **Nightly job stuck:** look for a long-running lock on `invoices`. Kill the job only after checking that no invoice is half-written.
- **Invoice mismatch reported by Support:** compare `line_items` with the PayStream invoice. Do not hand-edit amounts; issue a credit memo.

## Escalation

1. **Mei Chen** (primary), `<@U06MEI>`
2. **Jordan Blake** (secondary), `<@U05JORDAN>`
3. PayStream account manager: Rina Kapoor (rina@paystream.com) for vendor-side issues.
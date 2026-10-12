---
id: doc-oncall-policy
title: Engineering On-call Policy
owner: jordan@northwind.dev
department: engineering
doc_type: policy
project: null
created_at: 2026-04-20T16:00:00Z
updated_at: 2026-07-14T17:00:00Z
acl: null
url: https://wiki.northwind.dev/engineering/oncall-policy
---

# Engineering On-call Policy

## Scope

On-call covers Atlas Fleet Manager, the legacy Northwind Cloud Console, the billing service and the robot telemetry ingest. R2 firmware incidents page the firmware rotation (owner: Raj Mehta).

## Rotation

- One primary and one secondary engineer per week. Handoff is Monday 17:00 UTC.
- Engineers join the rotation after 30 days. Interns shadow but are never primary.
- Swaps are fine. Update the schedule and post in `#eng`.

## Severity and response

| Sev | Definition | Ack | Update cadence |
|---|---|---|---|
| SEV1 | Customer fleets down, data loss, billing charging incorrectly at scale | 15 min | every 30 min |
| SEV2 | Major feature degraded for one or more enterprise customers | 30 min | every 2 h |
| SEV3 | Minor bug, workaround exists | next business day | as needed |

## Escalation

1. Primary on-call.
2. Secondary on-call (after 15 min without ack).
3. Jordan Blake, Engineering Manager.
4. Raj Mehta, CTO (SEV1 only).

Subject-matter escalation: billing goes to Mei Chen, SSO/auth goes to Devon Lee. See the billing and SSO runbooks.

## Expectations

- Be reachable and within 15 minutes of a laptop during your shift.
- Open an incident channel for SEV1/SEV2 and keep `#support` informed so Priya Shah's team can update customers.
- Write a blameless postmortem within 5 business days of any SEV1/SEV2.

## Compensation

On-call weeks earn one day of time off in lieu. Pages between 22:00 and 07:00 local count double toward the quarterly fatigue review.
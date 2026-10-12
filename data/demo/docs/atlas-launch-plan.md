---
id: doc-atlas-launch-plan
title: Atlas GA Launch Plan
owner: sam@northwind.dev
department: product
doc_type: plan
project: atlas
created_at: 2026-08-25T18:00:00Z
updated_at: 2026-09-17T20:00:00Z
acl: null
url: https://wiki.northwind.dev/product/atlas-launch-plan
---

# Atlas GA Launch Plan

**Owner:** Sam Rivera · **Status:** Approved at the 2026-09-16 go/no-go

## Launch date

**Atlas Fleet Manager GA: 2026-09-30.**

The 2026-09-16 go/no-go meeting approved GA for 2026-09-30, on the condition that ATL-212 (SAML SSO via KeyGate) closes by 2026-09-26.

## Launch checklist

| Item | Owner | Due | Status |
|---|---|---|---|
| ATL-200 GA epic: all P0 issues closed | Jordan Blake | 2026-09-26 | In progress |
| ATL-212 SAML SSO via KeyGate | Devon Lee | 2026-09-26 | At risk |
| Onboarding flow and empty states | Kai Nakamura | 2026-09-22 | Done |
| Pricing page (Standard $40, Enterprise $55 per robot/month) | Lena Fischer | 2026-09-24 | In progress |
| Support training and macros for Atlas | Priya Shah | 2026-09-25 | Todo |
| Globex Enterprise rollout plan | Omar Haddad | 2026-09-28 | In progress |
| Load test at 5,000 robots | Mei Chen | 2026-09-23 | Done |

## Comms plan

- **T-5 days:** Internal announcement in `#general`.
- **T-2 days:** Customer email to existing R2 accounts (draft: Sam, review: Ana Gomez).
- **GA day (2026-09-30):** Blog post, pricing page live, in-app banner in the Cloud Console.
- **GA +1 week:** Globex case-study kickoff with Dana Whitfield.

## Risks

1. **SSO via KeyGate (top risk).** ATL-212 depends on KeyGate fixing a signing-cert rotation bug in their SAML metadata endpoint. Without it, the Enterprise tier can't ship, and Globex will not roll out without SSO. Mitigation: Devon is getting a firm fix date from KeyGate; fallback is launching Standard tier first.
2. **Firmware 2.8 Wi-Fi drops (FW-77).** Fleet status may show robots offline. Mitigation: hotfix 2.8.1 (FW-80, Raj) and a "connectivity" alert explanation in docs.
3. **Support readiness.** Training lands late in the cycle.

## Rollback

If a SEV1 happens in the first 72 hours, we pause new sign-ups and keep customers on the Cloud Console. Decision owner: Raj Mehta.
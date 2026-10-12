---
id: doc-atlas-prd
title: Atlas Fleet Manager PRD
owner: sam@northwind.dev
department: product
doc_type: prd
project: atlas
created_at: 2026-04-28T18:00:00Z
updated_at: 2026-07-01T19:00:00Z
acl: null
url: https://wiki.northwind.dev/product/atlas-prd
---

# Atlas Fleet Manager PRD

**Owner:** Sam Rivera · **Design:** Kai Nakamura · **Eng:** Jordan Blake's Platform team

## Problem

Customers running more than one warehouse use the legacy Northwind Cloud Console, which only shows a single site. Ops leads can't see fleet health across sites, schedule pick waves centrally or roll out firmware in a controlled way.

## Goals

1. One cloud dashboard to monitor, schedule and update R2 Picker fleets across sites.
2. Staged firmware rollouts (canary, then percentage, then all) with automatic rollback.
3. Replace the Cloud Console for all customers by mid-2027.

## Non-goals

- On-prem deployment.
- Controlling non-Northwind robots.

## Design partner

**Globex Logistics** (120 robots, enterprise) is our design partner. Their Director of IT, Dana Whitfield, has told us that Globex will not roll Atlas out without SSO. Umbrella Freight is in the beta.

## Requirements

| # | Requirement | Tier |
|---|---|---|
| R1 | Multi-site fleet map with live robot status | All |
| R2 | Alerts (battery, faults, connectivity) via email and webhook | All |
| R3 | Pick-wave scheduler | All |
| R4 | Staged firmware rollout with rollback | All |
| R5 | Role-based access (admin, operator, viewer) | All |
| R6 | **SAML SSO via KeyGate Identity** (ATL-212) | Enterprise |
| R7 | Audit log export | Enterprise |

**The Enterprise tier requires SAML SSO.** We broker SAML through KeyGate Identity so that we support Okta, Azure AD and others with one integration. Devon Lee owns this work (ATL-212). The GA epic is ATL-200.

## Pricing

- Standard: $40 per robot per month.
- Enterprise (SSO, audit log): $55 per robot per month.

## Success metrics

- Globex live on Atlas Enterprise across all 120 robots within 30 days of GA.
- 50% of R2 fleets on Atlas within 6 months.
- Firmware rollout time cut from days to under 4 hours.

## Open questions

- Do we offer SCIM provisioning at GA or later? (Leaning later.)
- Cloud Console sunset date.
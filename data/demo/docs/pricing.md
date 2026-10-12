---
id: doc-pricing
title: Northwind Pricing (R2 Picker and Atlas Fleet Manager)
owner: lena@northwind.dev
department: sales
doc_type: pricing
project: null
created_at: 2026-04-20T17:00:00Z
updated_at: 2026-07-14T16:30:00Z
acl: null
url: https://wiki.northwind.dev/sales/pricing
---

# Northwind Pricing

List prices for quotes. Discounts beyond the volume table need approval from Lena Fischer (up to 15%) or Elena Park (above 15%).

## R2 Picker (hardware)

| Option | Price | Notes |
|---|---|---|
| Purchase | $38,000 per unit | Includes 12-month hardware warranty |
| Lease | $1,450 per unit per month | 36-month term; includes Northwind Cloud Console and RMA via ShipFast Logistics |

Firmware updates are included for all purchased and leased units.

## Atlas Fleet Manager (SaaS)

| Tier | Price | Includes |
|---|---|---|
| Standard | $40 per robot per month | Fleet dashboard, scheduling, OTA firmware rollout, email support |
| Enterprise | $55 per robot per month | Everything in Standard plus SAML SSO (via KeyGate Identity), audit log, role-based access, priority support |

- Billed annually in advance; monthly billing adds 10%.
- Minimum 10 robots per Atlas subscription.
- Customers who need SSO must be on the Enterprise tier.
- Leased fleets currently on the legacy Cloud Console get a 3-month Atlas Standard credit when they migrate.

## Volume discounts

Applied to R2 purchase/lease and Atlas subscription fees.

| Fleet size | Discount |
|---|---|
| 1-24 robots | List |
| 25-49 robots | 5% |
| 50-99 robots | 8% |
| 100+ robots | 12% |

Multi-year commitments (3 years, prepaid annually) add a further 3%.

## Example

120-robot Enterprise fleet on Atlas: 120 x $55 x 12 = $79,200/yr list, minus 12% volume = $69,696/yr.

## Notes

- Billing is handled by the billing service (moving to PayStream; see the Billing v2 ADR). Questions about invoices or proration go to Mei Chen.
- Refund terms are set by Support; check the current refund macro with Priya Shah before quoting.
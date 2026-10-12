---
id: doc-macro-refund-request
title: "Macro: Refund Request Reply"
owner: priya@northwind.dev
department: support
doc_type: macro
project: support-macros
created_at: 2026-08-21T17:00:00Z
updated_at: 2026-08-21T17:00:00Z
acl: null
url: https://wiki.northwind.dev/support/macro-refund-request
---

# Macro: Refund Request Reply

Zendesk macro name: `Refund / Request received`. Rewritten as part of the August Support Macro Refresh.

> **Policy note:** Per the **2026-08-18 Support & Finance policy review**, the refund window is now **30 days from delivery** (previously 14). Use this macro, not older wording. The Refund Policy wiki page is pending an update.

## When to use

- A customer asks for a refund on one or more purchased R2 Picker units.
- Do **not** use this macro for leased units or Atlas / Cloud Console subscriptions. Use `Lease / Cancellation` instead.

## Agent checklist

1. Confirm the serial number(s) and the ShipFast delivery date.
2. Check that the request falls **within 30 days of delivery**.
3. Set ticket tags to `refund` and `rma`.
4. If the request is outside 30 days, switch to the `Warranty / Claim` macro.

## Customer reply

Hi {{ticket.requester.first_name}},

Thanks for reaching out, and I'm sorry the R2 Picker hasn't worked out for you.

Good news: purchased R2 Picker units are eligible for a **full refund within 30 days of delivery**, provided the unit is returned with all original components (charging dock, gripper kit, safety bumper) and without physical damage or third-party modification.

Here's what happens next:

1. I'll create an RMA number for serial {{ticket.custom.serial}}.
2. Our shipping partner, ShipFast Logistics, will contact you to schedule a free crated pickup.
3. When the unit reaches our Oakland facility, we inspect it within 3 business days.
4. Once it passes inspection, your refund goes to the original payment method within 10 business days.

Please reply with a pickup window that works for your site and a contact on the dock.

Best,
{{current_user.name}}
Northwind Robotics Support
---
id: doc-cs-renewal-playbook
title: Customer Success Renewal Playbook
owner: omar@northwind.dev
department: success
doc_type: handbook
project: null
created_at: 2026-05-12T16:00:00Z
updated_at: 2026-09-29T17:30:00Z
acl: null
url: https://wiki.northwind.dev/success/cs-renewal-playbook
---

# Customer Success Renewal Playbook

Owner: Omar Haddad. Applies to every customer with a renewal in the next 120 days.

## Timeline

| Days before renewal | Action | Owner |
|---|---|---|
| 120 | Health check: usage, tickets, open product asks | CSM |
| 90 | Executive business review (EBR) with the customer | CSM + AE |
| 60 | Renewal proposal sent | AE (Lena Fischer) |
| 30 | Paper in legal; escalate blockers to Ana Gomez | CSM |
| 0 | Signed renewal; invoice issued from billing | AE + billing |

## Health signals

- **Green:** robot uptime > 97%, no open high/urgent tickets, product asks on track.
- **Yellow:** recurring tickets (e.g. Wi-Fi drops after firmware 2.8, FW-77) or one slipping product dependency.
- **Red:** the customer has said a missing capability blocks rollout, or an exec has raised renewal risk in writing.

## Handling a red account

1. Log the risk in #atlas-launch or #sales with the ARR and renewal date.
2. Get a dated plan from the owning engineer or PM. Never pass along a date that the owner has not confirmed.
3. Send the customer a written timeline within 5 business days.
4. Offer a bridge (credits, extended pilot, exec call) approved by Ana Gomez.

## Current example: Globex Logistics (red)

- **ARR:** $480k, 120 robots. **Renewal:** 2026-11-30. CSM Omar Haddad, AE Lena Fischer.
- **Risk:** Globex cannot roll Atlas out to its 120 robots without SAML SSO via KeyGate. Dana Whitfield (Director of IT) escalated by email on 2026-09-26 and said the renewal is at risk.
- **Dependency:** ATL-212 (SAML SSO, Devon Lee) is blocked on KeyGate's SAML metadata endpoint signing-cert rotation bug. Atlas GA moved from 2026-09-30 to 2026-10-14 because of it.
- **Next steps:** Lena to send Globex a written SSO timeline; Omar to hold weekly check-ins with Dana until SSO ships; prepare a bridge offer in case SSO lands after October.

## Other renewals to watch

- Umbrella Freight (2026-12-20): Atlas beta user; also seeing Wi-Fi drops.
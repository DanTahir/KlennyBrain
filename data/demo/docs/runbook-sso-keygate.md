---
id: doc-runbook-sso-keygate
title: SSO via KeyGate Runbook
owner: devon@northwind.dev
department: engineering
doc_type: runbook
project: sso
created_at: 2026-08-22T17:00:00Z
updated_at: 2026-09-23T18:00:00Z
acl: null
url: https://wiki.northwind.dev/engineering/runbook-sso-keygate
---

# SSO via KeyGate Runbook

**Owner:** Devon Lee (Senior Engineer, Identity) · **Issue:** ATL-212 · **Project:** Enterprise SSO (Keystone)

## Overview

Atlas Enterprise tier uses SAML 2.0 SSO. KeyGate Identity brokers SAML from the customer's IdP (Okta, Azure AD and others), so Atlas has one Service Provider integration.

`Customer IdP -> KeyGate -> Atlas (SP)`

## Setup for a new Enterprise customer

1. Create a KeyGate tenant connection for the customer org.
2. Share our SP details with the customer's IT contact:
   - Entity ID: `urn:northwind:atlas`
   - ACS URL: `/auth/saml/acs`
   - NameID: email address
3. The customer configures their IdP to point at KeyGate. KeyGate gives us a per-tenant metadata URL.
4. In Atlas admin, set `sso.metadata_url` and enable "Require SSO".
5. Test with a non-admin user, then enforce SSO for the org.

## Certificate handling

Atlas fetches KeyGate metadata every 6 hours and caches the signing certificate. During a rotation we accept both the old and new certs for 24 hours.

## Known issue: metadata endpoint signing-cert rotation bug (ATL-212)

**Status: OPEN, blocking ATL-212 and the Enterprise tier.**

When KeyGate rotates a tenant's signing cert, the metadata endpoint keeps serving the **old** cert for hours, but assertions are signed with the **new** cert. Atlas rejects them with `InvalidSignature`, and every user in that org is locked out.

- Reported to KeyGate (Victor Osei, victor@keygate.io) on 2026-09-08. KeyGate confirmed the bug on their side.
- KeyGate fix ETA: **2026-10-09** (per Victor, 2026-09-22).

### Workaround status

- **Manual cert pinning:** we pin the cert by hand and skip metadata refresh. Works in staging, but it breaks silently at the next rotation. **Not approved for production.**
- **Retry-with-refetch on `InvalidSignature`:** prototyped. It doesn't help because the endpoint itself is stale.
- Conclusion: no safe workaround. We need KeyGate's fix to close ATL-212.

## Troubleshooting

| Symptom | Check |
|---|---|
| `InvalidSignature` | cert rotation (see above); compare the cert fingerprint with the KeyGate dashboard |
| `AudienceMismatch` | Entity ID typo in the IdP config |
| Redirect loop | "Require SSO" on before the IdP test passed |

## Escalation

Devon Lee (primary), then Jordan Blake. Vendor: Victor Osei, KeyGate Partner Solutions Engineer.
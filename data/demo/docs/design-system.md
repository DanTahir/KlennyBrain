---
id: doc-design-system
title: Atlas Design System ("Compass")
owner: kai@northwind.dev
department: product
doc_type: spec
project: atlas
created_at: 2026-05-20T18:00:00Z
updated_at: 2026-08-28T20:15:00Z
acl: null
url: https://wiki.northwind.dev/product/design-system
---

# Atlas Design System ("Compass")

Owner: Kai Nakamura. Compass is the shared UI kit for Atlas Fleet Manager. The legacy Cloud Console is not being migrated.

## Principles

1. **Glanceable:** a shift supervisor should see fleet health in under 5 seconds.
2. **Calm by default:** color is reserved for state, not decoration.
3. **Accessible:** WCAG 2.1 AA minimum; every status has an icon and text, never color alone.

## Color tokens

| Token | Hex | Use |
|---|---|---|
| `color.bg.default` | #FFFFFF | Page background |
| `color.bg.subtle` | #F4F6F8 | Cards, tables |
| `color.text.primary` | #1B2430 | Body text |
| `color.brand.primary` | #2457D6 | Primary actions, links |
| `color.status.ok` | #1E8E4F | Robot online / picking |
| `color.status.warn` | #C77700 | Low battery, degraded Wi-Fi |
| `color.status.error` | #C62828 | Offline, fault |

## Typography

- Font: Inter. Sizes: 12 / 14 (body) / 16 / 20 / 28.
- Numbers in tables use tabular figures.

## Spacing and layout

- 4 px base grid; tokens `space.1` (4) to `space.8` (32).
- 12-column grid, 24 px gutters; fleet map and table views collapse to one column under 960 px.

## Core components

- **RobotStatusBadge:** state + icon + label; links to robot detail.
- **FleetTable:** sortable, virtualized for 500+ robots, sticky header.
- **SiteMap:** floor plan with live robot positions and Wi-Fi signal overlay.
- **Banner:** info / warn / error, used for firmware rollout notices.
- **EmptyState:** used in onboarding flows (first site, first robot).
- **SignInPanel:** email/password plus "Sign in with SSO" button for Enterprise tenants.

## Contributing

- Components live in the `compass` package; propose changes in #product with a Figma link.
- Ollie Grant maintains the Storybook; new components need a story and an accessibility check before merge.
---
id: doc-r2-firmware-2-8-release-notes
title: R2 Picker Firmware 2.8 Release Notes
owner: raj@northwind.dev
department: engineering
doc_type: spec
project: fw29
created_at: 2026-08-04T16:00:00Z
updated_at: 2026-08-15T19:20:00Z
acl: null
url: https://wiki.northwind.dev/engineering/r2-firmware-2-8-release-notes
---

# R2 Picker Firmware 2.8 Release Notes

**Released:** 2026-08-04
**Rollout:** staged OTA, 10% of fleet on day 1, 100% by 2026-08-08
**Owner:** Raj Mehta

## New features

- **Faster pick planning:** new grasp planner cuts average pick cycle time by ~9% on mixed-SKU totes.
- **Aggressive Wi-Fi roaming:** the radio now roams to a stronger access point earlier (RSSI threshold raised from -75 dBm to -68 dBm) to reduce dead zones in large aisles.
- **Atlas telemetry v2:** richer battery and motor health metrics streamed to Atlas Fleet Manager.
- **Obstacle reclassification:** fewer false stops for shrink-wrap and pallet edges.
- **Charging dock alignment:** improved docking success rate on uneven floors.

## Fixes

- Fixed rare arm calibration drift after a cold restart.
- Fixed incorrect battery percentage shown in the legacy Cloud Console.

## Upgrade notes

- Requires dock firmware 1.4 or later.
- Robots reboot once during install (about 6 minutes).

## Known issues

- **Intermittent Wi-Fi roaming drops (FW-77).** On some sites, especially those with mixed-vendor access points or 802.11r disabled, R2 units drop off Wi-Fi during a roam and stay offline for 1-5 minutes, every few hours. Robots pause picking while disconnected. Root cause is the new roaming threshold combined with a reassociation timeout in the Wi-Fi driver. Tracked in https://linear.northwind.dev/issue/FW-77.
- **Workaround:** Support can set the roaming threshold back to -75 dBm per site via a config push. This reduces drops but does not eliminate them.
- **Planned fix:** firmware **2.8.1** hotfix (https://linear.northwind.dev/issue/FW-80, owner Raj Mehta) restores the old threshold by default and fixes the reassociation timeout. Broader roaming improvements are planned for 2.9.

Support contact for affected customers: Marco Rossi.
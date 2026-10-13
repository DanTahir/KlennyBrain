# KlennyBrain: 3-minute demo script

This script is for recording the Devpost demo video. It walks through one continuous story: ask the
brain, prove it respects permissions, let it find a problem in the company's knowledge, have the
agent propose a fix, approve it, and watch the brain correct itself. It ends with the same brain
answering inside Slack.

The fictional company is **Northwind Robotics** (R2 Picker robots and Atlas Fleet Manager). "Today"
in the dataset is 2026-10-12.

## Before you record

Work through this checklist in order.

- [ ] `pnpm dev` is running. Web is at http://localhost:3000 and the API at http://localhost:3001.
- [ ] Run `node scripts/demo-reset.mjs` and wait for it to finish (about 2-3 minutes). It clears
      insights and actions, re-syncs the demo source to restore the stale 14-day refund doc, and
      re-runs analysis. The refund contradiction is then open again.
- [ ] In the browser you are logged in as `elena@northwind.dev` (CEO, org OWNER), and Brain Home is
      open.
- [ ] Slack (workspace **KlennySpace**) is open on `#all-klennyspace`. The bot user `brain` is in the
      channel. If mentions don't arrive, run `node scripts/slack-bot-check.mjs`.
- [ ] A GitHub tab is open on https://github.com/DanTahir/northwind-atlas-tracker/issues
- [ ] Optional: pre-warm by asking one question on the Ask page so the first on-camera answer is
      quick. Start a new conversation afterwards.
- [ ] Close notifications. Zoom the browser so the source cards and tool trace are readable.

```bash
pnpm dev
# in a second terminal (Git Bash on Windows)
node scripts/demo-reset.mjs
```

## Shot list

| Time | Screen | What to do | What to say |
|---|---|---|---|
| 0:00-0:20 | Brain Home | Show the stats (348 items, 14 people, open insights, pending actions), the knowledge-by-source bars and integration status. | "This is KlennyBrain, a company brain for Northwind Robotics. It has 348 items from Slack, email, docs, meeting transcripts and tickets, all in HydraDB with a knowledge graph on top. You don't search it. You ask it." |
| 0:20-0:55 | Ask | Click the suggested question or type `What is blocking the Atlas launch?`. While the answer streams, open the tool-call trace drawer. When it finishes, hover the [n] citations and source cards, then open "Why this answer". | "The agent decides which tools to call. Here it searches knowledge and explores the Atlas entity in the graph. The answer walks the blocker chain: Atlas GA is blocked by ATL-212, the SAML SSO issue. That is waiting on KeyGate's signing-cert fix, and their ETA slipped to October 13 at the earliest. Downstream, Globex Logistics can't roll out without SSO. Every claim is cited, and this graph shows why." |
| 0:55-1:25 | Ask (View as) | Use "View as" to switch to Ollie Grant (intern). Ask `What is the Q4 reorg plan?`. Then switch back to Elena and ask the same question. | "Permissions are enforced in the retrieval itself, not just in the UI. As Ollie, our intern, the brain finds nothing confidential. As Elena, the CEO, it returns the plan: Support and Customer Success merge into Customer Experience under Ana Gomez. Same question, same brain, different access." |
| 1:25-1:45 | Insights | Open Insights. Point at the refund window CONTRADICTION (both citations), the STALE_DOC for the refund policy, then scroll past decisions and overdue action items. | "The brain also reads everything proactively. It found a contradiction: the Refund Policy doc says 14 days, but #support and the refund macro say 30 days, which was decided on August 18. It flags the doc as stale. It also pulls decisions and action items out of meetings and flags the overdue ones." |
| 1:45-2:00 | Insights | Click **Fix it** on the refund contradiction. | "Fix it hands the problem to the agent. It proposes three actions: a corrected doc, a Slack message to the owners, and a GitHub issue. Nothing has happened yet. These are proposals." |
| 2:00-2:25 | Actions, then GitHub, then Slack | On Actions, approve the three proposed actions. Switch to the GitHub tab and refresh to show the new issue. Switch to Slack to show the post in `#all-klennyspace`. Back on Insights, show the refund contradiction is now resolved. | "Only an owner or admin can approve. A member gets a 403. On approval, the GitHub issue is created, the Slack message is posted, and the corrected doc is written back into HydraDB. The brain then re-checks its own insights and resolves the contradiction automatically." |
| 2:25-2:40 | Ask | Type `What is our refund window?` | "Ask again and the answer is consistent: 30 days. The brain corrected itself." |
| 2:40-2:55 | Slack | In `#all-klennyspace` type `@brain What action items are overdue?`. Show the "Searching..." placeholder update in place into a threaded answer. Point at the numbered sources, the "Open in KlennyBrain" button and the permissions footer. Mention `/brain`. | "The same brain lives in Slack. It answers in the thread with sources, and the footer says whose permissions were applied. `/brain` works too." |
| 2:55-3:00 | Brain Home | Return to Brain Home. | "KlennyBrain: a company brain that answers with receipts, respects who's asking, and fixes what it finds." |

## Exact phrases to type

| Where | Text |
|---|---|
| Ask | `What is blocking the Atlas launch?` |
| Ask (as Ollie, then as Elena) | `What is the Q4 reorg plan?` |
| Ask (after approval) | `What is our refund window?` |
| Slack `#all-klennyspace` | `@brain What action items are overdue?` |
| Slack (optional) | `/brain What is our refund window?` |
| Slack, live ingestion (optional) | Post a normal message (no @brain), e.g. `Facilities update: the door code for the Oakland HQ demo room is now 7342, effective today.` About a minute later, ask in the web app: `What was the latest facilities update posted in Slack about the Oakland HQ demo room?` The answer cites the live Slack message. |

## Fallback tips

- **Slow answer:** keep talking over the tool-call trace drawer. The trace is the interesting part:
  it shows the agent choosing `search_knowledge` and `explore_entity`. The loop is capped at 5 tool
  steps and a 60 s budget.
- **Streaming hiccup:** nothing to do. The Ask page falls back to a JSON response automatically.
- **Sparse "Why this answer" graph:** the graph is built from HydraDB `subgraph` around the cited
  sources plus any query paths. If it looks thin, focus on the source cards and citations instead.
- **Slack is slow or the mention doesn't arrive:** show a thread that was answered earlier, then
  move on. Run `node scripts/slack-bot-check.mjs` before recording so the bot is in the channel.
- **Refund contradiction missing on Insights:** you skipped the reset. Run
  `node scripts/demo-reset.mjs` again and wait for analysis to finish.
- **Approve button fails:** check that you are logged in as Elena (OWNER), not "viewing as" a member.

## Golden questions (from `data/demo/GROUND_TRUTH.md`)

| # | Question | Expected gist |
|---|---|---|
| 1 | What is our refund window? | 30 days (decided 2026-08-18). The Refund Policy doc still says 14 days and is stale. |
| 2 | When does Atlas launch and why did it move? | Moved from 2026-09-30 to 2026-10-14 because ATL-212 (SAML SSO via KeyGate) is blocked. |
| 3 | What is blocking the Atlas launch? | ATL-200 is blocked by ATL-212, which waits on KeyGate's signing-cert fix (ETA slipped to Oct 13 at the earliest). Globex can't roll out without SSO. |
| 4 | Who knows the billing service? | Mei Chen (Staff Engineer). Jordan Blake is the secondary. |
| 5 | What is the Q4 reorg plan? | As Elena: Support and CS merge into Customer Experience under Ana Gomez, effective 2026-11-01. As Ollie: nothing confidential. |
| 6 | What are customers' most common support problems right now? | R2 Picker Wi-Fi roaming drops after firmware 2.8 (FW-77, hotfix FW-80 in review). There is no FAQ entry yet. |
| 7 | What action items are overdue? | Priya (refund doc), Devon (KeyGate escalation), Lena (Globex SSO timeline). |

To check all of these end to end before recording, run `node scripts/smoke.mjs`.
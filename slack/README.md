# Slack app setup

Company Brain talks to Slack through a Slack app running in **Socket Mode**, so no public URL is needed for local development.

1. Go to https://api.slack.com/apps -> **Create New App** -> **From a manifest** -> pick your workspace.
2. Paste one of the manifests in this folder into the matching tab:
   - `manifest.json` -> **JSON** tab
   - `manifest.yml` -> **YAML** tab
3. **Basic Information -> App-Level Tokens -> Generate Token and Scopes**: add scope `connections:write`. This is `SLACK_APP_TOKEN` (`xapp-...`).
4. **Install App -> Install to Workspace**. Copy the **Bot User OAuth Token** (`SLACK_BOT_TOKEN`, `xoxb-...`) and the **User OAuth Token** (`SLACK_USER_TOKEN`, `xoxp-...`, only needed for HydraDB's native Slack connector).
5. **Basic Information -> App Credentials -> Signing Secret** (`SLACK_SIGNING_SECRET`).
6. In Slack, `/invite @Brain` into every channel the brain should learn from (required for private channels).

Scopes: the `bot` scopes power the `@Brain` bot, the `/brain` command and our own ingestion adapter. The `user` scopes exist so the user token can be handed to HydraDB's native Slack connector.

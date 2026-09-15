# node-metaconcord

## [Objective](https://hackmd.io/SwE_rpqESKSfV0LMvBd0Kw?both)

## Setup

Strip the file names of `*.example.json` from the `.example` bits, and configure all the fields as you wish.

Although, I doubt this can be useful for anyone other than Meta Construct as-is. It will probably work with some tuning but you're better off forking the project to make your own changes and additions.

Of course, you'll need the [gmod-metaconcord](https://github.com/Metastruct/gmod-metaconcord) add-on installed on your server to allow for communication with this service.

### Production

```bash
# Install dependencies
$ yarn

# Generate the gamebridge payload schemas
$ node schema_gen.mjs

# Go wacky
$ yarn build
$ yarn start
```

### Development

```bash
# Install dependencies
$ yarn

# Generate the gamebridge payload schemas
$ node schema_gen.mjs

# Go wacky
$ yarn dev
```

## Accounts and website auth (metastruct.net)

One account per person (`services/Accounts`, Postgres tables `accounts`, `account_links`, `link_codes`, created on start), with any number of linked platforms. Discord, Steam (OpenID), GitHub and GitLab log in and link through `/auth/<provider>`; Steam and Minecraft can also be linked from game chat: the profile page hands out a code and the player types `METACONCORD_LINK <code>` on any relayed server. The chat relays catch it before Discord sees it. The session is the `mcSession` cookie (30 days), resolved to the account on every request (`webapp/api/auth/session.ts`).

Roles are derived, never edited, and recomputed on login, on link changes, hourly while the site is used, and by an hourly sweep over every account (one member listing per GitHub team, cached Steam groups, so the cost does not grow with the account count). GitHub teams of `org` map to roles through `config/github.json` (`roles`, team slug to `administrator`, `developer` or `trial-developer`), and public Steam groups map to roles through `config/accounts.json` (`steamGroups`, group id64 to role: Metastruct Admins grants `developer`, Meta Construct Developers grants `administrator`). Only links proven by OAuth, OpenID or a code count; links imported from the old `discord_tokens` table are display only until re-verified.

- `administrator`: everything, including the dashboard
- `developer`: rocket, history editor, bans, private addon sources
- `trial-developer`, players: profile, linking, own ban appeal

Requirements on the GitHub App in `config/github.json`:

- Callback URL: `<webapp.url>/auth/github/callback`
- Installed on the `Metastruct` org with access to the history repo
- Permissions: `Contents: read & write`, `Members: read` (team lookups run as the app, the user token is the fallback)

The history editor commits with the user's own token, kept encrypted on their GitHub link; a mutation answers `401 {"error":"github_reauth"}` when it is missing or expired and the site sends them through the GitHub login again.

GitLab needs an application on gitlab.com with the `read_user` scope and callback `<webapp.url>/auth/gitlab/callback`, in `config/gitlab.json` under `oauth`. Discord uses the existing Linked Roles application (`/discord/link` is both the login start and what the Linked Roles button points to).

Linked Roles metadata (`services/DiscordMetadata`, schema registered with Discord on start when it differs): `banned` (boolean), `dev` (integer, at least: 1 trial developer, 2 developer, 3 administrator, the highest role wins), `coins` and `time` (integers, at least). Cumulative linked roles: trial developer `dev >= 1`, developer `dev >= 2`, administrator `dev >= 3`, so an administrator holds all three. Metadata is pushed on Discord login, on role changes, on ban events and through `/discord/link/:id/refresh`.

`config/webapp.json` needs `siteUrl`, `allowedOrigins` (CORS with credentials) and `cookieDomain` (`.metastruct.net` so the session cookie is shared with the site).

## Admin dashboard (metaconcord.metastruct.net)

`GET /` serves an admin dashboard for administrators: live process output (stdout and stderr, captured in a 2000 line ring buffer), a REPL that runs JS inside the process (`MetaConcord` is a global) or bash inside the container, and an editor for `config/*.json`. Every REPL command and config edit is logged with the account name.

Config edits are written to the directory the process loaded its JSON from (`dist/config` in the image). Configs are imported at startup, so edits only apply after a restart. The Restart button exits the process and relies on the container restart policy.

Dashboard routes: `GET /dashboard/logs`, `GET /dashboard/config`, `PUT /dashboard/config/:name`, `POST /dashboard/restart`, websocket `/dashboard/ws`. The login flow is shared with the website, `/auth/github?target=self` lands back on this host instead of `siteUrl`.

Game servers read accounts with the gamebridge token in `X-Auth-Token`: `GET /accounts/staff?provider=steam|minecraft` (platform id, platform name, roles of every account with a role and a proven link there, trial developers included) and `GET /accounts/steam/:steamId64` or `/accounts/minecraft/:uuid` (name, roles, linked platforms, 404 `no account` without a proven link). aowl and the Minecraft mod rank from the first on boot and from the second on join.

Routes: `GET /auth/<provider>?redirect=/path` and `/auth/<provider>/callback` for `github`, `gitlab`, `steam`, `discord`, `GET /auth/me`, `POST /auth/logout`, `DELETE /auth/links/:provider`, `POST /auth/link-code`, `GET /history`, `POST /history/events`, `PUT /history/events/:id`, `DELETE /history/events/:id`, `GET /discord/guild/widget`, `GET /join/:label`, plus the `/discord`, `/github`, `/gitlab`... short links.

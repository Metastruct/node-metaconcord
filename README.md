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

## Website auth and history (metastruct.net)

The website logs editors in through GitHub (`/auth/github`) and edits the timeline by committing to `history.json` in the repo named in `config/history.json`, using the editor's own token.

Requirements on the GitHub App in `config/github.json`:

- Callback URL: `<webapp.url>/auth/github/callback`
- Installed on the `Metastruct` org with access to the history repo
- Permissions: `Contents: read & write`, `Members: read`
- Editors must be active members of one of the teams listed in `config/history.json` (`administrators`, `developers`)

`config/webapp.json` needs `siteUrl`, `allowedOrigins` (CORS with credentials) and `cookieDomain` (`.metastruct.net` so the session cookie is shared with the site).

Routes: `GET /auth/github?redirect=/path`, `GET /auth/github/callback`, `GET /auth/me`, `POST /auth/logout`, `POST /history/events`, `PUT /history/events/:id`, `DELETE /history/events/:id`, `GET /join/:label`, plus the `/discord`, `/github`, `/gitlab`... short links.

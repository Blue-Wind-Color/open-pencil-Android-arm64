---
title: Self-hosting OpenPencil Cloud
description: Run your own OpenPencil Cloud server with PostgreSQL and an S3-compatible bucket.
---

# Self-hosting OpenPencil Cloud

OpenPencil Cloud is one Node 22+ process in front of PostgreSQL 15 or later and an S3-compatible object store, with optional SMTP for email. The same process serves the API, the collaboration relay, and the server's own pages for signing in, account security, and administration. People connect to it from the editor as described in [OpenPencil Cloud](/user-guide/openpencil-cloud).

## Build

From a checkout of the repository:

```sh
bun install
bun run build:packages
bun run build:cloud-portal                       # writes dist-cloud-portal/
bun --filter @open-pencil/cloud build:standalone # writes packages/cloud/dist-standalone/
```

`dist-standalone/` bundles the server's dependencies, so copy the whole directory, together with `dist-cloud-portal/`, to a host that has Node but no `node_modules`. Start the server with `node dist-standalone/server.mjs`.

## Configure

Settings live in a TOML file; environment variables supply secrets and tell the server where that file and the portal are and where to listen.

1. Copy [`openpencil-cloud.example.toml`](https://github.com/open-pencil/open-pencil/blob/master/packages/cloud/deploy/openpencil-cloud.example.toml) and set at least:
   - `deployment.public_url`: the address the server answers on, for example `https://cloud.example.com`;
   - `deployment.app_url`: the editor that invitation and share links open (see [The editor address](#the-editor-address));
   - `deployment.trusted_origins`: every editor origin that talks to the server, including `app_url`;
   - `[object_storage]`: the bucket's endpoint, region, and name.
2. Copy [`.env.example`](https://github.com/open-pencil/open-pencil/blob/master/packages/cloud/deploy/.env.example) and set:
   - `OPENPENCIL_CLOUD_CONFIG`: the path to the TOML file;
   - `OPENPENCIL_CLOUD_PORTAL_DIR`: the path to `dist-cloud-portal/`. Without it the server still runs, but sign-in, account, and administration pages answer 404, and it warns at startup;
   - the secrets the TOML names, by default `DATABASE_URL`, `BETTER_AUTH_SECRET`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY`, plus `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APPLE_PRIVATE_KEY`, `S3_SESSION_TOKEN`, `OPENPENCIL_CLOUD_SMTP_USER`, and `OPENPENCIL_CLOUD_SMTP_PASSWORD` when their sections are enabled.
3. Start the server with the environment loaded, for example `node --env-file=.env dist-standalone/server.mjs`.

Use `{ from_env = "CUSTOM_NAME" }` in the TOML to read a secret from a different variable. A missing required secret stops startup and names the variable without printing a value.

The server migrates the database before it accepts requests and listens on `PORT` (default `8787`) and `HOST` (default `0.0.0.0`). `GET /ready` reports readiness.

## The editor address

`deployment.app_url` is where invitation and share links send people. Either:

- use the hosted editor, `https://app.openpencil.dev`, which connects to any server; people sign in by approving a code, as in the desktop app;
- or serve your own build of the editor (after `bun run build:packages`, `bunx vite build` writes `dist/`) on your own domain. When it is the server's editor address, people sign in on the server's pages and come straight back.

Either way, the desktop app connects to the server directly, and the web editor offers to open links there.

## Reverse proxy

- Terminate TLS in front of the server and the object store, on stable hostnames.
- Forward WebSocket upgrades for `/api/collaboration/relay`. Collaboration tickets name the relay at `public_url` with a `ws:` or `wss:` scheme; set `[collaboration] relay_url` when clients reach it elsewhere.
- The object store must accept presigned uploads from the editor's origins: allow `PUT` and `GET` from `trusted_origins` in its CORS rules, with the `Range` request header, which Home uses to read a document's preview without downloading the whole file.

## The first administrator

Set `authentication.enrollment_mode = "approval"` for a controlled deployment: a verified identity then creates a pending request that an administrator reviews. Startup never grants roles, so bootstrap the first operator from a repository checkout that reads the same configuration and secrets and can reach the server's database at `DATABASE_URL`:

```sh
bun --filter @open-pencil/cloud admin approve owner@example.com
# after that person signs in once
bun --filter @open-pencil/cloud admin grant owner@example.com
```

Deployment administrators manage enrollment and users in the server's administration pages. They are separate from workspace administrators.

## Operator commands

Each runs from a repository checkout with the same `OPENPENCIL_CLOUD_CONFIG` and secrets as the server:

| Command                                           | Purpose                                         |
| ------------------------------------------------- | ----------------------------------------------- |
| `bun --filter @open-pencil/cloud migrate`         | Apply database migrations                       |
| `bun --filter @open-pencil/cloud cleanup`         | Run one cleanup pass outside the server worker  |
| `bun --filter @open-pencil/cloud quota:reconcile` | Recompute stored usage from committed revisions |
| `bun --filter @open-pencil/cloud entitlements`    | Inspect or set a workspace's entitlements       |
| `bun --filter @open-pencil/cloud admin`           | Approve enrollment and grant deployment admin   |

## Email

Set `email.transport = "smtp"` with an `[email.smtp]` table, or `"none"` to send nothing; invitations still work through their links. Messages go through an encrypted outbox in PostgreSQL, tuned under `[workers.email]`. Delivery records that the SMTP server accepted a message, not that it reached the inbox.

## Storage

Any S3-compatible store works; the project tests against SeaweedFS and Garage. Keep `object_storage.checksum_verification = "metadata"` for stores without native SHA-256 checksums: OpenPencil stores each document's digest as object metadata and verifies it before committing a revision. For Garage, set `region = "garage"` and `force_path_style = true`, and leave server-side encryption unset.

Revision keys are immutable, so bucket versioning isn't needed, but it isn't a backup either. Size `[workers.cleanup]` for your upload volume and retention, or set `enabled = false` and run `cleanup` from a scheduler.

## Backups and upgrades

Back up PostgreSQL and the bucket together. To upgrade, build the new version, stop the old process, and start the new one: it applies migrations before it accepts requests. Migrations only move forward, so restore the database backup to roll back.

## Hardening

Replace every development credential, including the ones in the example Compose files. The [security checklist](https://github.com/open-pencil/open-pencil/blob/master/packages/cloud/deploy/security.md) covers the remaining checks.

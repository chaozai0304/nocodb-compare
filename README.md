# nocodb-compare

Schema diff + upgrade executor for NocoDB.

Compare a **Source** (production) base vs a **Target** (staging) base, generate an executable upgrade plan, export it as JSONL, and apply it safely (dry-run first).

**Languages:** English (default) · [简体中文](README.zh-CN.md) · [Français](README.fr-FR.md)

---

## Features

- Compare base schema (tables / columns)
- Generate an executable upgrade plan
- Select steps (checkboxes)
- Dry-run / Apply
- Export plan as **JSONL** (one API request per line)
- Import & execute a plan (upload JSON/JSONL)
- CLI script for server / CI execution

> Note: Current implementation focuses on **NocoDB Meta API v2**.

---

## Quick start (Docker)

Build and run (single port UI + API):

- `docker build -t nocodb-compare:latest .`
- `docker run -d --name nocodb-compare -p 5175:5175 -v "$PWD/data:/data" --restart unless-stopped nocodb-compare:latest`

Open: http://localhost:5175/

Data in container:

- Config: `/data/config.json`
- Auth: `/data/auth.json`

---

## Development

- Install deps: `npm i`
- Start web + server: `npm run dev`

Web: http://localhost:5173

Server: http://localhost:5175

---

## Login

The server uses cookie-session login.

Default bootstrap credentials (first start only):

- Username: `admin`
- Password: `ChangeMe123!`

Override via env:

- `INIT_USERNAME`
- `INIT_PASSWORD`

---

## How to use

### Compare & upgrade

Menu: **Compare Upgrade**

1) Fill Source/Target: `baseUrl`, `apiToken`, `baseId`

2) Click **Compare** → plan generated

3) Select steps → **Dry-run** → **Apply**

### Import & execute

Menu: **Import Execute**

1) Upload exported plan (`.jsonl` or `.json`)

2) Fill target `baseUrl/apiToken/baseId`

3) Select steps → **Dry-run** → **Apply**

The server will resolve `{tableId}` / `{columnId}` placeholders and rewrite request URLs to the provided target.

---

## CLI execution (server / CI)

Script: `scripts/execute-plan.sh`

Requirements: `curl`, `jq`

- Dry-run (default):
  - `./scripts/execute-plan.sh -a https://nocodb.example.com -t '<token>' -b '<baseId>' -f ./plan.jsonl`

- Apply:
  - `./scripts/execute-plan.sh -a https://nocodb.example.com -t '<token>' -b '<baseId>' -f ./plan.jsonl --apply`

---

## Storage (important)

To avoid leaking tokens/passwords to GitHub, defaults are stored in your user directory:

- `~/.nocodb-compare/config.json`
- `~/.nocodb-compare/auth.json`

Or set:

- `CONFIG_FILE=/data/config.json`
- `AUTH_FILE=/data/auth.json`

This repository ignores `data/` and `apps/**/data/`.

---

## Fonts

The web UI bundles open-source fonts (via `@fontsource/*`):

- Inter — SIL Open Font License 1.1
- Noto Sans SC — SIL Open Font License 1.1

---

## License

MIT — see [LICENSE](LICENSE).

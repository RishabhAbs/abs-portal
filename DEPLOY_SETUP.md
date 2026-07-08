# Auto-Deploy: commit to GitHub → live on cPanel

## How it works

```
  you: git push  ──▶  GitHub (main)
                         │
                         ▼   GitHub Actions (.github/workflows/deploy.yml)
                    builds backend + frontend
                    force-pushes ready-to-serve tree ──▶ GitHub (deploy branch)
                         │
                         ▼   cPanel Git Version Control pulls `deploy`
                    runs .cpanel.yml:
                      • rsync frontend → public_html
                      • rsync backend  → public_html/backend  (keeps .env)
                      • npm install --omit=dev
                      • pm2 reload + pm2 save
```

Building happens on GitHub's runner, **never** on the shared host. Your DB
password / JWT keys live only on the server and are never pushed to GitHub.

---

## One-time setup

### 1. Server: make sure secrets exist (they already do from manual deploys)
In cPanel Terminal, confirm these two files exist and are correct — the deploy
**never** overwrites them:
- `~/public_html/backend/.env`
- `~/public_html/backend/ecosystem.config.js`

If starting fresh, create them once (same contents your manual zip used).

### 2. cPanel → Git™ Version Control → **Create**
- **Clone URL:** `https://github.com/RishabhAbs/abs-portal.git`
  - If the repo is **private**, add a read-only Deploy Key: in cPanel copy the
    account's SSH public key (SSH Access → Manage SSH Keys), then add it under
    GitHub repo → Settings → Deploy keys.
- **Repository Path:** e.g. `repositories/abs-portal` (anywhere OUTSIDE public_html)
- After it clones, open **Manage** → set the checked-out branch to **`deploy`**.

> The `deploy` branch only appears after the first GitHub Actions run (step 4),
> so run the workflow once, then come back and select `deploy`.

### 3. Confirm paths in `.ci/cpanel.yml`
Defaults assume the frontend serves from `~/public_html` and the backend lives
at `~/public_html/backend`. If your doc-root is a subdomain folder, edit
`WEBROOT` / `BACKEND` at the top of [.ci/cpanel.yml](.ci/cpanel.yml).
Also verify `pm2` is on PATH in the cPanel Terminal (`which pm2`); if not, put
its full path in the last task.

### 4. Push to activate
Commit these files and push to `main`. Actions builds and creates the `deploy`
branch automatically. Go back to step 2 and select `deploy`.

### 5. (Optional) Make it fully hands-off
Without this, each deploy needs **one click** in cPanel (Manage → Deploy HEAD
Commit). To auto-trigger, add these **GitHub repo → Settings → Secrets and
variables → Actions** secrets:

| Secret | Value |
|---|---|
| `CPANEL_HOST` | your cPanel host, e.g. `server123.web-hosting.com` |
| `CPANEL_USER` | your cPanel username |
| `CPANEL_TOKEN` | a cPanel **API Token** (cPanel → Security → Manage API Tokens) |
| `CPANEL_REPO_ROOT` | the Repository Path from step 2, e.g. `repositories/abs-portal` |

With those set, the workflow tells cPanel to pull + deploy on every push — no click.

---

## Day-to-day
Just `git push` to `main`. Watch progress under the repo's **Actions** tab.
Frontend goes live immediately; the backend reloads under PM2 (~a few seconds).

## Rollback
Re-run an older successful run from the **Actions** tab, or in cPanel deploy an
earlier commit of the `deploy` branch.

## Notes / caveats
- **PM2 PATH:** cPanel deployment shells sometimes don't have `pm2` on PATH —
  if the reload task fails, hardcode the full `pm2` path in `.ci/cpanel.yml`.
- **First backend run:** if PM2 isn't running the app yet, the recipe's
  `pm2 start ecosystem.config.js` fallback starts it.
- **cPanel API function names** can vary slightly by version; if step 5's
  auto-trigger 404s, fall back to the one-click deploy — the build/publish half
  still works perfectly.
- You have SSH/Terminal on this account, so if you ever prefer a simpler
  **SSH + rsync** deploy (no deploy branch, no cPanel Git), say the word and I'll
  swap the workflow.

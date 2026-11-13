# xyzt

Spacetime Social: an ephemeral social network in two dimensions.

- **Space**: what was written within 5 km of where you are. Posts last 27 hours.
- **Time**: rooms called labels (`/music`). Posts last 11 to 110 minutes, depending on the label's length.

## How it is built

A static web app (`public/`, plain HTML, CSS and JavaScript modules, no build) published on GitHub Pages.
The browser talks directly to a Supabase project; there is no server of ours. The rules a server would enforce
(post lifetime, limits, who may read or delete) live in the database: see `supabase/migrations/`.

| Path | What |
|---|---|
| `public/` | the app |
| `supabase/migrations/` | database schema and rules |
| `.github/workflows/pages.yml` | publishes `public/` on every push to `master` |
| `.github/workflows/purge.yml` | hourly: deletes expired posts and orphan photos |
| `scripts/dev.mjs` | local server that behaves like Pages |

## Run it locally

```bash
npm run dev
```

Then open http://localhost:4173. It uses the same Supabase project as the published app.

## One-time setup

- GitHub → Settings → Pages → Source: **GitHub Actions**.
- GitHub → Settings → Secrets and variables → Actions: secret `SUPABASE_SERVICE_KEY` (used by the purge only).
- Supabase: apply the files in `supabase/migrations/` in order.

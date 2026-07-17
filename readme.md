# Zkyko — trading journal & weekly review

Static site for **this week**, **growth**, **journal**, and **history**.
Cursor (with Robinhood) syncs fills into `data/*.json`; GitHub Pages just renders them.

## Local

```bash
npm install
npm run sync:agent          # from data/thesis-loop.db
npm run sync:agent:live     # also POST /api/sync if legacy server is running
npm run dev
```

Open [http://localhost:3000/en/](http://localhost:3000/en/).

## Agent workflow

1. `npm run sync:rh` — pulls Robinhood via MCP into SQLite, then rebuilds all day/week JSON.
2. Or `npm run sync:agent` — rebuild reviews from existing SQLite only (no live pull).
3. Edit `data/days/YYYY-MM-DD.json` or `data/weeks/YYYY-Www.json` `keep` / `stop` / `improve` / `lesson` (sync preserves these).
4. Add journal markdown under `journal/`.
5. Commit → Pages deploys.

## Surfaces

| Route | Purpose |
|-------|---------|
| `/en/` | **Calendar** — month heat-map, this week, all weekly reviews |
| `/en/day/YYYY-MM-DD/` | Daily review (saved forever under `data/days/`) |
| `/en/history/YYYY-Www/` | Weekly review (saved forever under `data/weeks/`) |
| `/en/growth/` | Equity curve & weekly bars |
| `/en/journal/` | Markdown journal |

## Privacy

Prefer a **private** repo. Committed JSON includes account equity and fills.

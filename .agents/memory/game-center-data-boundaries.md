---
name: Game Center data boundaries
description: Preserve the number game while extending the browser checkers game and its leaderboard.
---

Game Center changes must preserve existing number-guessing routes, response contracts, player IDs/sessions, tables, and historical scores. Keep checkers scoring in its own table and API namespace. Use additive schema changes and never deduplicate or prune by deleting historical rows. Port the attached Tkinter rules faithfully, including source quirks such as its backward-jump endgame scan.

**Why:** the user explicitly requires both games and their data to remain isolated and intact.

**How to apply:** Inspect current handlers and DDL before changing Flask routes or PostgreSQL schema. Use fake databases for score-write tests; use live Neon for safe reads and `EXPLAIN`, not test score inserts.

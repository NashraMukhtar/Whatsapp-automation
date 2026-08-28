// ── Messages & groups now come from .env ───────────────────────────────────
// MESSAGES  — pipe-separated variants: "msg one|msg two|msg three"
// GROUP_IDS — comma-separated IDs:     "123@g.us,456@g.us"
import "dotenv/config";

export const LOG_LEVEL = "warn";

export const MESSAGES = (process.env.MESSAGES ?? "")
  .split("|")
  .map((m) => m.trim())
  .filter(Boolean);

export const GROUP_IDS = (process.env.GROUP_IDS ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

// ── Timing ───────────────────────────────────────────────────────────────
/* Base gap between rounds, in hours, plus a random extra amount added on top each time so the schedule isn't perfectly predictable. */
export const BASE_INTERVAL_HOURS = 3;
export const MAX_RANDOM_EXTRA_MINUTES = 20; // random extra on top of the base gap

// Small randomized pause between sending to each individual group in a
// round, in seconds, so 40-50 messages don't fire in the same instant.
export const MIN_DELAY_BETWEEN_GROUPS_SECONDS = 4;
export const MAX_DELAY_BETWEEN_GROUPS_SECONDS = 9;

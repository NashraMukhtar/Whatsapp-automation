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
// export const BASE_INTERVAL_MINUTES = 3;
export const MAX_RANDOM_EXTRA_MINUTES = 60; // random extra on top of the base gap
// export const MAX_RANDOM_EXTRA_SECONDS = 60; // random extra on top of the base gap

// Small randomized pause between sending to each individual group in a
// round, in seconds, so 40-50 messages don't fire in the same instant.
export const MIN_DELAY_BETWEEN_GROUPS_SECONDS = 12;
export const MAX_DELAY_BETWEEN_GROUPS_SECONDS = 25;

// ── Daytime-only sending ─────────────────────────────────────────────────
// Local hours (24h, 0-23) that rounds are allowed to fire in. A round due
// outside this window gets pushed to the next day's DAYTIME_START_HOUR
// instead of firing — a broadcast landing at 3am is one of the more
// obvious "this is a bot" signals. Uses the process's local timezone, so
// set TZ in .env (e.g. TZ=Asia/Karachi) if the VPS defaults to UTC.
export const DAYTIME_START_HOUR = Number(process.env.DAYTIME_START_HOUR ?? 9);
export const DAYTIME_END_HOUR = Number(process.env.DAYTIME_END_HOUR ?? 23);

if (
  !Number.isInteger(DAYTIME_START_HOUR) ||
  !Number.isInteger(DAYTIME_END_HOUR) ||
  DAYTIME_START_HOUR < 0 ||
  DAYTIME_END_HOUR > 24 ||
  DAYTIME_START_HOUR >= DAYTIME_END_HOUR
) {
  throw new Error(
    `Invalid daytime window: DAYTIME_START_HOUR=${DAYTIME_START_HOUR}, DAYTIME_END_HOUR=${DAYTIME_END_HOUR}. ` +
    `Need 0 <= start < end <= 24 (overnight windows like 22-6 aren't supported).`
  );
}

// ── Batch sending ────────────────────────────────────────────────────────
// Groups are sent to in batches instead of one long uninterrupted run.
// Within a batch: short delay between each group. Between batches: a much
// longer pause, mimicking a person pausing rather than a script looping.
// The last batch just gets whatever groups are left over — it doesn't
// need to be a full batch (e.g. 28 groups = five batches of 5, then one
// batch of 3, not five full batches and 3 dropped groups).
export const GROUP_BATCH_SIZE = 5;

// Delay between batches, in minutes.
export const MIN_DELAY_BETWEEN_BATCHES_MINUTES = 3;
export const MAX_DELAY_BETWEEN_BATCHES_MINUTES = 5;
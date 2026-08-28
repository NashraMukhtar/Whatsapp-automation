import makeWASocket, {
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason,
} from "@whiskeysockets/baileys";
import P from "pino";
import qrcode from "qrcode-terminal";

import {
    MESSAGES,
    GROUP_IDS,
    BASE_INTERVAL_HOURS,
    // BASE_INTERVAL_MINUTES,
    MAX_RANDOM_EXTRA_MINUTES,
    // MAX_RANDOM_EXTRA_SECONDS,
    MIN_DELAY_BETWEEN_GROUPS_SECONDS,
    MAX_DELAY_BETWEEN_GROUPS_SECONDS,
    MIN_DELAY_BETWEEN_BATCHES_MINUTES,
    MAX_DELAY_BETWEEN_BATCHES_MINUTES,
    DAYTIME_START_HOUR,
    DAYTIME_END_HOUR,
    LOG_LEVEL,
    GROUP_BATCH_SIZE,
} from "./config.js";

// ── Reconnect backoff ────────────────────────────────────────────────────
// Waits longer after each consecutive failed connection attempt (capped),
// and resets to the base delay once a connection actually opens. Retrying
// instantly on every drop is itself a pattern that looks bad to WhatsApp.
const RECONNECT_BASE_DELAY_MS = 2000;
const RECONNECT_MAX_DELAY_MS = 5 * 60 * 1000;
let reconnectAttempts = 0;

function getReconnectDelay() {
    const exp = Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempts);
    return exp + Math.floor(Math.random() * 1000);
}

function scheduleReconnect() {
    const delay = getReconnectDelay();
    reconnectAttempts += 1;
    console.log(`Reconnecting in ${Math.round(delay / 1000)}s (attempt ${reconnectAttempts})...`);
    setTimeout(start, delay);
}

function randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Splits an array into chunks of `size`. The final chunk holds whatever's
// left over and can be smaller than `size`
function chunkArray(arr, size) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
    }
    return chunks;
}

// ── Daytime gating ───────────────────────────────────────────────────────
function isDaytime(date = new Date()) {
    const hour = date.getHours(); // local time — respects TZ env var
    return hour >= DAYTIME_START_HOUR && hour < DAYTIME_END_HOUR;
}

// Next DAYTIME_START_HOUR from `from`, a few random minutes/seconds off
// the exact hour so every deferred round doesn't fire at :00:00.
function nextDaytimeStart(from = new Date()) {
    const target = new Date(from);
    target.setHours(DAYTIME_START_HOUR, randomBetween(0, 14), randomBetween(0, 59), 0);
    if (target <= from) {
        target.setDate(target.getDate() + 1);
    }
    return target;
}

// ── Send-round scheduling ────────────────────────────────────────────────
// One tracked timer handle for the whole process. Every (re)schedule clears
// whatever timer was already pending first, so a reconnect can never leave
// an old timer chain running alongside the new one — that duplication was
// the mechanism behind rounds firing multiple times concurrently.
let nextRoundTimeout = null;

function clearScheduledRound() {
    if (nextRoundTimeout) {
        clearTimeout(nextRoundTimeout);
        nextRoundTimeout = null;
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickMessage() {
    return MESSAGES[Math.floor(Math.random() * MESSAGES.length)];
}

function msUntilNextRound() {
    const baseMs = BASE_INTERVAL_HOURS * 60 * 60 * 1000;
    const extraMs = Math.floor(Math.random() * MAX_RANDOM_EXTRA_MINUTES * 60 * 1000);
    return baseMs + extraMs;
}

// Sends one round to every group, in batches of GROUP_BATCH_SIZE: a short
// delay between groups within a batch, a much longer pause between
// batches. The last batch takes whatever's left over, however many that
// is — nothing gets skipped just because it's not a full batch.
async function sendRound(sock) {
    if (GROUP_IDS.length === 0) {
        console.log("GROUP_IDS is empty — run `npm run list-groups` and fill in config.js first.");
        return;
    }

    const message = pickMessage();
    const batches = chunkArray(GROUP_IDS, GROUP_BATCH_SIZE);
    console.log(
        `\n[${new Date().toISOString()}] Sending to ${GROUP_IDS.length} groups in ${batches.length} batches`
    );

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        console.log(`  -- batch ${batchIndex + 1}/${batches.length} (${batch.length} groups) --`);

        for (let i = 0; i < batch.length; i++) {
            const groupId = batch[i];
            try {
                await sock.sendMessage(groupId, { text: message });
                console.log(`  sent -> ${groupId}`);
            } catch (err) {
                console.error(`  failed -> ${groupId}: ${err.message}`);
            }

            const isLastInBatch = i === batch.length - 1;
            if (!isLastInBatch) {
                const delaySeconds = randomBetween(
                    MIN_DELAY_BETWEEN_GROUPS_SECONDS,
                    MAX_DELAY_BETWEEN_GROUPS_SECONDS
                );
                await sleep(delaySeconds * 1000);
            }
        }

        const isLastBatch = batchIndex === batches.length - 1;
        if (!isLastBatch) {
            const delayMinutes = randomBetween(
                MIN_DELAY_BETWEEN_BATCHES_MINUTES,
                MAX_DELAY_BETWEEN_BATCHES_MINUTES
            );
            console.log(`  batch done — waiting ${delayMinutes}m before next batch`);
            await sleep(delayMinutes * 60 * 1000);
        }
    }
}

function scheduleNextRound(sock) {
    clearScheduledRound();

    const now = new Date();
    const rawTarget = new Date(now.getTime() + msUntilNextRound());

    // If the normal ~3h+jitter cadence would land outside the daytime
    // window, push to the next window instead of sending at night.
    const target = isDaytime(rawTarget) ? rawTarget : nextDaytimeStart(now);
    const delay = target.getTime() - now.getTime();

    console.log(
        `Next round at ${target.toLocaleString()} (in ${Math.round(delay / 60000)} minutes).`
    );

    nextRoundTimeout = setTimeout(async () => {
        nextRoundTimeout = null;

        // Defensive re-check: covers event-loop stalls, clock changes, or
        // the process being suspended/resumed since this was scheduled.
        if (!isDaytime()) {
            console.log("Woke up outside daytime hours — deferring instead of sending.");
            scheduleNextRound(sock);
            return;
        }

        await sendRound(sock);
        scheduleNextRound(sock);
    }, delay);
}

async function start() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState("auth_info");

        // Pin to WhatsApp's current protocol version — an outdated bundled
        // version is a well-documented cause of logins failing right after a
        // scan. Falls back to Baileys' built-in default if this fetch fails.
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            auth: state,
            version,
            logger: P({ level: LOG_LEVEL }),
        });

        sock.ev.on("creds.update", saveCreds);

        sock.ev.on("connection.update", (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log("Scan this QR code in WhatsApp: Settings > Linked Devices > Link a Device\n");
                qrcode.generate(qr, { small: true });
            }

            if (connection === "close") {
                // Cancel any pending send-round tied to this socket before deciding
                // what to do next. Without this, a reconnect starts a second timer
                // chain on top of whatever was already scheduled, and rounds start
                // firing more than once per interval.
                clearScheduledRound();

                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const message = lastDisconnect?.error?.message || "unknown reason";
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                if (shouldReconnect) {
                    console.log(`Connection closed (status ${statusCode ?? "none"} — ${message}).`);
                    scheduleReconnect();
                } else {
                    console.log("Logged out — delete auth_info and re-run to log in again.");
                }
            } else if (connection === "open") {
                console.log("Connected to WhatsApp. Starting schedule.");
                reconnectAttempts = 0;
                scheduleNextRound(sock);
            }
        });
    } catch (err) {
        // Anything unexpected here (e.g. useMultiFileAuthState failing to read
        // its session files) is caught and retried with backoff instead of
        // crashing the process with an unhandled rejection.
        console.error("Failed to start WhatsApp connection:", err.message);
        scheduleReconnect();
    }
}

start();
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
    MAX_RANDOM_EXTRA_MINUTES,
    MIN_DELAY_BETWEEN_GROUPS_SECONDS,
    MAX_DELAY_BETWEEN_GROUPS_SECONDS,
    LOG_LEVEL,
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

function randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function msUntilNextRound() {
    const baseMs = BASE_INTERVAL_HOURS * 60 * 60 * 1000;
    const extraMs = Math.floor(Math.random() * MAX_RANDOM_EXTRA_MINUTES * 60 * 1000);
    return baseMs + extraMs;
}

async function sendRound(sock) {
    if (GROUP_IDS.length === 0) {
        console.log("GROUP_IDS is empty — run `npm run list-groups` and fill in config.js first.");
        return;
    }

    const message = pickMessage();
    console.log(`\n[${new Date().toISOString()}] Sending to ${GROUP_IDS.length} groups`);

    for (const groupId of GROUP_IDS) {
        try {
            await sock.sendMessage(groupId, { text: message });
            console.log(`  sent -> ${groupId}`);
        } catch (err) {
            console.error(`  failed -> ${groupId}: ${err.message}`);
        }

        const delaySeconds = randomBetween(
            MIN_DELAY_BETWEEN_GROUPS_SECONDS,
            MAX_DELAY_BETWEEN_GROUPS_SECONDS
        );
        await sleep(delaySeconds * 1000);
    }
}

function scheduleNextRound(sock) {
    clearScheduledRound();
    const delay = msUntilNextRound();
    console.log(`Next round in ${Math.round(delay / 60000)} minutes.`);
    nextRoundTimeout = setTimeout(async () => {
        nextRoundTimeout = null;
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
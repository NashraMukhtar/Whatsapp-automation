// One-off helper: log in with your WhatsApp number and print every group
// you're in, along with the ID you need to paste into config.js.
//
// Run with: npm run list-groups

import makeWASocket, {
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason,
} from "@whiskeysockets/baileys";
import P from "pino";
import qrcode from "qrcode-terminal";

import { LOG_LEVEL } from "./config.js";

// WhatsApp's pairing flow closes the connection once, right after a
// successful QR scan, with a "restart required" status (515) — that's
// expected as part of the handshake, not a failure. The fix is to
// reconnect using the same auth_info and let it finish; no new QR needed
// for that step. This caps how many times we'll auto-retry that reconnect
// before assuming something else is actually wrong.
const MAX_RECONNECT_ATTEMPTS = 5;
let reconnectAttempts = 0;

async function start() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState("auth_info");

        // Pin the connection to WhatsApp's current protocol version. An
        // outdated bundled version is a well-documented cause of "QR scan
        // succeeds, login still fails" — falls back to Baileys' built-in
        // default if this fetch fails for any reason (e.g. no internet to
        // GitHub at that moment).
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            auth: state,
            version,
            logger: P({ level: LOG_LEVEL }),
        });

        sock.ev.on("creds.update", saveCreds);

        sock.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log("Scan this QR code in WhatsApp: Settings > Linked Devices > Link a Device\n");
                qrcode.generate(qr, { small: true });
            }

            if (connection === "close") {
                const statusCode = lastDisconnect?.error?.output?.statusCode;

                if (statusCode === DisconnectReason.loggedOut) {
                    console.error(
                        "Logged out during pairing. Delete the auth_info folder and run this again for a fresh QR code."
                    );
                    process.exit(1);
                }

                reconnectAttempts += 1;
                if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
                    console.error(
                        `Gave up after ${MAX_RECONNECT_ATTEMPTS} reconnect attempts.\n` +
                        "This isn't the normal one-time pairing restart anymore — check your " +
                        "internet connection, make sure WhatsApp on the phone is up to date, " +
                        "or delete auth_info and try again for a completely fresh QR code."
                    );
                    process.exit(1);
                }

                console.log("Reconnecting to finish pairing (this is expected right after a scan)...");
                setTimeout(start, 1500);
            } else if (connection === "open") {
                console.log("\nLogged in. Fetching your groups...\n");
                const groups = await sock.groupFetchAllParticipating();
                const list = Object.values(groups);

                if (list.length === 0) {
                    console.log("No groups found on this account.");
                } else {
                    list.forEach((g) => {
                        console.log(`${g.subject}\n  -> ${g.id}\n`);
                    });
                    console.log(`Found ${list.length} groups total.`);
                    console.log("Copy the IDs you want into GROUP_IDS in .env, then run: npm start");
                }
                process.exit(0);
            }
        });
    } catch (err) {
        console.error("Failed to log in:", err.message);
        process.exit(1);
    }
}

start();
# WhatsApp Group Broadcaster

Sends 2-3 predefined messages to a list of WhatsApp groups, on a repeating
schedule of ~3 hours + a small random amount. Uses
[Baileys](https://github.com/WhiskeySockets/Baileys), which connects to
WhatsApp directly over its WebSocket protocol (no headless Chrome, unlike
whatsapp-web.js) — that's why it can run on a very small, cheap server.

**Important:** this logs in as a real WhatsApp account and sends messages
programmatically. That's not something WhatsApp officially supports or
allows — it's against their Terms of Service, and their spam detection is
specifically built to catch "same message, many groups, on a timer" patterns
like this one. Running it means accepting some risk that the number gets
rate-limited or banned. See "Reducing ban risk" below for what actually
helps.

## 1. Local setup (test it first before deploying)

```bash
npm install
npm run list-groups
```

This prints a QR code in your terminal. On the dedicated number's phone:
**WhatsApp → Settings → Linked Devices → Link a Device**, and scan it.

Once connected, it prints every group that number is in, with its ID
(looks like `120363000000000000@g.us`). Copy the 40-50 you want.

## 2. Configure

Open `.env` and fill in:
- `MESSAGES` — your 2-3 message variants
- `GROUP_IDS` — the IDs you copied in step 1

You can adjust the timing in `config.js` too (`BASE_INTERVAL_HOURS`,
`MAX_RANDOM_EXTRA_MINUTES`, and the per-group delay) if 3 hours + up to 20
random minutes isn't what you want.

## 3. Run it

```bash
npm start
```

First run will ask you to scan the QR code again (or reuse the session if
you already ran `list-groups` and didn't delete the `auth_info` folder).
After that it logs in silently and starts the schedule — no more QR codes
unless you get logged out.

Leave this running. Every round it picks one of your messages at random and
sends it to each group in `GROUP_IDS`, with a few seconds of random delay
between groups, then waits ~3 hours + a random extra amount before doing it
again.

## 4. Deploying so it runs 24/7

You need a small always-on server — your own laptop being asleep or closed
will stop it. Cheapest reasonable option:

1. Get a small VPS — Hetzner's cheapest (~$4-5/mo) or a DigitalOcean basic
   droplet (~$6/mo) is plenty; Baileys is lightweight since there's no
   browser involved.
2. Install Node.js on it, copy this folder over (or `git clone` it), run
   `npm install`.
3. Run `npm run list-groups` **on the server** (not locally) so the
   `auth_info` session lives there — SSH gives you a QR code in the
   terminal same as local.
4. Keep it alive with [PM2](https://pm2.keymetrics.io/):
   ```bash
   npm install -g pm2
   pm2 start index.js --name whatsapp-bot
   pm2 save
   pm2 startup   # sets PM2 to restart on server reboot
   ```
5. `pm2 logs whatsapp-bot` to check on it any time.

## Security note on `auth_info/`

The `auth_info` folder holds your actual WhatsApp session keys — anyone who
gets these files can act as your number without ever scanning a QR code.
A `.gitignore` is included so `git add .` won't pick it up. Never paste its contents
anywhere, including to me in chat.

## Logging and reconnects

The logger level is `LOG_LEVEL` in `config.js` (default `"warn"`) — it's
deliberately not `"silent"`, so failed sends, rate-limit warnings, and
socket errors actually show up instead of vanishing. If the connection
drops, the bot waits before retrying and backs off further on each
consecutive failure (capped at 5 minutes), rather than reconnecting
instantly on a loop.

## Cost summary (one number, self-hosted)

| Item | Cost |
|---|---|
| VPS (Hetzner/DigitalOcean small instance) | ~$4-6/month |
| Dedicated SIM for the number | whatever your local carrier charges for a basic active line |
| The code / library itself | free (open source) |

That's it for the self-hosted route — no per-message fees, since you're not
going through Meta's paid API at all.

## Reducing ban risk (can't eliminate it, only reduce it)

- Keep the dedicated number **only** for this — never mix in personal
  chats, which is already what you're planning.
- Don't drop all 40-50 groups in on day one at full frequency. Start with a
  handful of groups for the first few days, then add the rest gradually.
- Keep 2-3 *actually different* message variants (not just this
  script's placeholder text) rather than one identical string every round —
  exact-duplicate broadcast text across many groups is one of the more
  obvious spam signals.
- Watch for early warning signs (messages not delivering, the account
  getting flagged in WhatsApp's own UI) and pause immediately if you see
  them, rather than continuing on schedule.
- If this number ever gets banned, there's normally no quick fix —
  budget for that as a real possibility, not a remote one.
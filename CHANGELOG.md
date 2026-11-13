# Changelog

## 2.0.0 (November 2026)

Tag [`v2.0.0`](https://github.com/Demonic1594/ReForgeTopGG/releases/tag/v2.0.0) · [all changes since ForgeTopGG 1.1.4](https://github.com/Demonic1594/ReForgeTopGG/compare/6a392b5...v2.0.0) · [switching guide](README.md#switching-from-forgetopgg)

First release of ReForgeTopGG, a fork of ForgeTopGG 1.1.4. The package is now `@tryforge/reforge.topgg`, installed from GitHub, and the extension registers as `reforge.topgg`. `ForgeTopGG` still works as a name for the class.

Every fix below was reproduced on 1.1.4 (or read in its source, or in @top-gg/sdk 3.1.6, which it used) and has a test.

### Security
- **Fake votes with an empty `auth`.** @top-gg/sdk 3.1.6 skips the check when the secret is empty (`if (this.authorization && req.headers.authorization !== this.authorization)`), so anyone could post votes. An empty `auth` (or `webhook.secret`) now stops the bot at start-up, and without one the webhook does not start.
- The webhook secret is compared in constant time (both sides hashed with SHA-256 first, so the length does not leak either). It was compared with `!==`.
- A non-JSON body passed authentication as `{}` and fired `voted` with no user. Only `application/json` is accepted (`415` otherwise).
- Any JSON was emitted as a vote. Payloads are validated (Discord IDs for user, bot or guild, `type` upvote or test, boolean `isWeekend`, query); invalid ones get `400` and an `error` event.
- Bodies are limited to 16 KiB (`webhook.maxBodySize`), with header (10 s) and request (15 s) timeouts. Only `POST` on the configured path is served.
- API error messages never contain the token. The secret is never logged or echoed.

### Fixed
- **Votes fired twice.** Top.gg delivers a vote again when it gets no 2xx answer in time; each delivery fired `voted`, so rewards could be given twice. Repeats of the same vote within `dedupeWindow` (1 hour) are answered `204` and dropped, concurrent ones too. Test votes are collapsed for at most a minute.
- **`$hasVoted` looked like "not voted" when Top.gg was down.** It, `$totalVotes` and `$monthlyVotes` swallowed errors and returned an empty value: `$if[$hasVoted[id]==false;...]` then took the "voted" branch. They now fail with a ForgeScript error naming the cause; `$try` catches it.
- **Crash when the port is taken.** The webhook server had no error handler, so `EADDRINUSE` ended the process. It is now an `error` event ("port 3000 is already in use").
- **Port opened too early, never closed.** The server started in the constructor, before the extension was initialised, and could not be stopped. It starts in `init()` and `client.destroy()` closes it, along with stats posting.
- A stats `interval` under 15 minutes or a missing `token` threw inside the `ready` handler; options are checked when the extension is created.
- `$hasVoted` took a `User` argument, so ForgeScript fetched the user from Discord before Top.gg was asked; it takes the ID as text now and refuses anything that is not an ID.
- `$voteUserID`, `$voteQuery`, `$postedServerCount` and the other event functions read whatever data the current event had; they return nothing outside their own events.
- Loading ForgeTopGG and ReForgeTopGG together is refused at start-up: both register the same functions and events.
- Stats posting waited for discord.js's `ready` event (1.1.4 did too). discord.js 14.22 and newer emit `clientReady`, print a deprecation warning when anything listens to `ready`, and v15 drops it. Posting and the restoring of reminders now wait for `clientReady` when the installed discord.js has it.
- `client.destroy()` right after the bot became ready left topgg-autoposter's interval running (it starts one microtask after it is created), so the process could not exit. A closed extension's poster never starts.

### Added
- **Signed (v1) webhooks**: `webhook.secret` checks Top.gg's `x-topgg-signature` (HMAC SHA-256 of the timestamp and raw body, constant-time, 5-minute window). `vote.create` and `webhook.test` become the same vote as legacy deliveries; repeats collapse by vote ID.
- **Vote history** behind a small `VoteStore` interface: memory (default, 100,000 users), ForgeDB user variables (`store: "forgedb"`, ForgeDB stays optional), or your own. A vote that cannot be stored gets `500`, so Top.gg delivers it again.
- Functions: `$voteCount`, `$votePoints`, `$voteStreak`, `$lastVoteTime`, `$nextVoteTime`, `$votedWithin`, `$voteWeight`, `$voteTimestamp`, `$isVoteWeekend`, `$sendTestVote`, and an optional key for `$voteQuery`.
- Event `voteReminder` (option `reminders`), fired once when a voter can vote again.
- `webhook.listen: false` and `webhookListener` to mount the webhook on your own server; `webhook.path` and `webhook.host`.
- `sendTestVote()` and `receive()` in JavaScript, for development and tests.
- `metadata/` with functions, events and the `VoteType` enum, generated from the sources.
- A test suite (`npm test`, 61 tests) and CI on Node 20 and 22, plus ForgeScript 2.5.0.

### Changed
- Dropped the `@tryforge/webserver` dependency (and with it express); the webhook is a small `node:http` handler.
- `$voteQuery` without a key always returns JSON (`{}` when empty).
- A wrong `Authorization` gets `401` instead of `403`.
- Peer dependency `@tryforge/forgescript` 2.5.0 or newer; tested on 2.5.0, 2.7.1 and 2.8.0.

# Changelog

## 2.1.0 (November 2026)

Tag [`v2.1.0`](https://github.com/Demonic1594/ReForgeTopGG/releases/tag/v2.1.0) · [all changes since 2.0.0](https://github.com/Demonic1594/ReForgeTopGG/compare/7d83c55...v2.1.0)

A hardening release from stress, abuse and fuzz testing 2.0.0. Each fix has a test that fails on 2.0.0. Install over 2.0.0; nothing to migrate.

### Security
- **A spammed `$hasVoted` could get the bot's Top.gg token blocked for an hour.** Top.gg blocks a token past 60 requests a minute to its bot endpoints (rate-limit docs), and every call was a request: 80 calls in a burst sent 80. Identical requests in flight now share one call, answers are reused briefly (voted 60 s, not voted 30 s, totals 60 s, weekend 5 min; a vote reaching the webhook clears that user's answer), and at most 50 requests a minute are sent; beyond that the call fails locally with an error `$try` can catch. Also applies to `$totalVotes`, `$monthlyVotes` and `$isVoteWeekend`.
- **Slow clients were never cut off.** Node checks `headersTimeout` and `requestTimeout` only every 30 s by default; a client trickling headers kept its connection for 25 s and more in tests. The webhook server now checks every second (cut off after about 11 s).

### Fixed
- **A vote could be lost when its first delivery failed.** A repeat that arrived while the first delivery was still being stored was answered 204 and dropped; when the first then failed (500), Top.gg had no reason to deliver it again. A repeat now waits for the first delivery and fails with it.
- **Two votes of one user at the same moment counted once.** The history was read and written without a lock, so concurrent votes (for a bot and a server, or two signed votes) overwrote each other. Updates are serialised per user.
- **A throwing `error` listener crashed the bot** (from the server's error handler, as an uncaught exception), and **a throwing `voted` listener turned a stored vote into a 500**. Listener exceptions are logged instead.
- **Pending reminders were lost when ForgeDB connected after the bot became ready.** The ForgeDB store now waits for the connection (up to 3 s for a vote, up to a minute when restoring reminders).
- After a refused request answered before its body was read (for example a GET with a body), the client's next request on the same connection failed with "socket hang up" (found by the fuzzer). Such responses now close the connection.
- A typo in `events` (e.g. `"vote"`) only logged "failed to load" and left the extension half set up. It now stops the bot at start-up with the list of events.

### Changed
- Values from `.env` and JSON configs work: a numeric string `port` (`port: process.env.PORT`), a numeric `auth`, and `null` for "not set" (`auth`, `token`, `webhook.secret`). An `auth` of another type gets a clear error instead of "auth is empty".
- `$hasVoted` and every function taking a user ID accept mentions (`<@id>`, `<@!id>`) and surrounding spaces.
- Signed deliveries may carry several `v1` signatures (as during a secret rotation); any one matching is enough.
- A UTF-8 byte order mark before the JSON body is accepted.
- Warnings in the log: `auth` with leading or trailing whitespace (a stray space or a Windows line ending in `.env`), commands added for an event that is not in `events` (they never run), and refused webhook requests (counted, at most once a minute).
- The de-duplication cache holds 100,000 deliveries (was 10,000).
- New exports: `TOPGG_API_BUDGET`, `TOPGG_EVENTS`, `KeyedLock`, `parseUserId`, `normalizeOptions`, `TopGGApi#clearCache()`.

### Tests
- 77 tests (61 before). New: `test/robustness.test.js` (13 abuse and race cases) and `test/fuzz.test.js`, a seeded fuzzer (3,000 mixed webhook requests per seed in concurrent bursts, vote histories against a reference model, every function with hostile arguments). 41 seeds were run before the release (about 123,000 requests).
- Measured: 5,000 valid votes from distinct users, 100 at a time, in about 0.4 s; 5,000 forged requests emit nothing and leave the heap flat after garbage collection.

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

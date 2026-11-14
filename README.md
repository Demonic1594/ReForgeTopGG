<div align="center">

# ReForgeTopGG
ReForgeTopGG is a hardened Top.gg extension for ForgeScript. Post your bot's server count, receive votes safely, and reward voters with vote history, streaks and reminders.

<a href="https://github.com/Demonic1594/ReForgeTopGG/"><img src="https://img.shields.io/github/package-json/v/Demonic1594/ReForgeTopGG/main?label=@tryforge/reforge.topgg&color=5c16d4" alt="@tryforge/reforge.topgg"></a>
<a href="https://github.com/tryforge/ForgeScript/"><img src="https://img.shields.io/github/package-json/v/tryforge/ForgeScript/main?label=@tryforge/forgescript&color=5c16d4" alt="@tryforge/forgescript"></a>
<a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-5c16d4" alt="License: GPL-3.0"></a>

</div>

---

## Contents

1. [Why ReForgeTopGG](#why-reforgetopgg)
2. [Installation](#installation)
3. [Setting up Top.gg](#setting-up-topgg)
4. [Options](#options)
5. [Functions](#functions)
6. [Events](#events)
7. [Vote History, Streaks and Reminders](#vote-history-streaks-and-reminders)
8. [Testing Votes](#testing-votes)
9. [Security](#security)
10. [Errors, Logging and Debugging](#errors-logging-and-debugging)
11. [Switching from ForgeTopGG](#switching-from-forgetopgg)
12. [Upgrading from 2.x](#upgrading-from-2x)
13. [Notes and Limits](#notes-and-limits)
14. [Development](#development)
15. [Credits and License](#credits-and-license)

<h3 align="center">Why ReForgeTopGG</h3><hr>

- **No fake votes.** The webhook refuses to start without a secret, compares it in constant time, and checks the signature of Top.gg's current (v1) webhooks.
- **Each vote once.** Top.gg delivers a vote again when it gets no answer in time; repeats are dropped, so rewards are not handed out twice.
- **No surprises in production.** Nothing listens until the extension starts, a port in use is an error event instead of a crash, and `client.destroy()` closes the server.
- **Honest API answers.** `$hasVoted` fails with an error when Top.gg can't be reached, instead of returning something that looks like "not voted" (or, with `==false`, like "voted").
- **Vote history.** Count, weekend points, streaks, last and next vote time, kept in memory or in ReForgeDB / ForgeDB, plus a reminder event when someone can vote again.
- **Test without Top.gg.** `$sendTestVote` sends a vote through your own webhook, exactly like Top.gg does.

<details>
<summary><b>Everything fixed compared to ForgeTopGG 1.1.4</b></summary>

Each row was reproduced on 1.1.4 (or read in its source) and has a test in `test/` that passes now.

| Problem in 1.1.4 | What happens now |
|---|---|
| The webhook port opened in the constructor, before the extension started, and could never be closed | Opens in `init()`, only when `auth` or `webhook.secret` is set; `client.destroy()` closes it |
| With an empty `auth`, @top-gg/sdk 3.1.6 skips the check (`if (this.authorization && ...)`): anyone could post votes | An empty `auth` stops the bot at start-up with a clear error |
| The secret was compared with `!==` | Constant-time comparison (both sides hashed first) |
| A port already in use crashed the bot (`Unhandled 'error' event`) | An `error` event with "port 3000 is already in use" |
| A non-JSON body (e.g. `text/plain`) passed as `{}` and fired `voted` with no user | `415`, nothing emitted |
| Any JSON was emitted as a vote, e.g. `{"hello":1}` | Payload validated (Discord IDs, type, weekend flag, query); `400` and an `error` event otherwise |
| Every retried delivery fired `voted` again | One `voted` per vote within `dedupeWindow` (1 hour) |
| `$hasVoted`, `$totalVotes`, `$monthlyVotes` returned an empty value when the request failed | A ForgeScript error naming the cause; catch it with `$try` |
| `$hasVoted` took a `User` argument, so it fetched the user from Discord before asking Top.gg | Takes the ID as text and checks it is an ID |
| A stats interval under 15 minutes or a missing token threw inside the `ready` handler | Checked when the extension is created |
| `$voteUserID` and friends read whatever data the current event had | Return nothing outside vote events |
| Only express's default 100 KiB body limit, no request timeouts | 16 KiB limit, header and request timeouts |

</details>

<h3 align="center">Installation</h3><hr>

1. Run the following command to install the required `npm` packages:
    ```bash
    npm i github:Demonic1594/ReForgeTopGG
    ```

    > ℹ️ **Note**\
    > The compiled code is committed, so no build step is needed. The command above follows `main`; to pin a release, add its tag, e.g. `npm i github:Demonic1594/ReForgeTopGG#v3.1.0`. All releases are listed under [tags](https://github.com/Demonic1594/ReForgeTopGG/tags).

2. Here's an example of how your main file should look:
    ```js
    const { ForgeClient } = require("@tryforge/forgescript")
    const { ReForgeTopGG } = require("@tryforge/reforge.topgg")

    const topgg = new ReForgeTopGG({
        token: process.env.TOPGG_TOKEN,   // Top.gg API token
        auth: process.env.TOPGG_AUTH,     // webhook Authorization you set on Top.gg
        port: 3000,
        events: ["voted", "voteReminder", "error"],
        reminders: true,
        post: { interval: 3_600_000 }     // post the server count every hour
    })

    const client = new ForgeClient({
        ...options, // The options you currently have
        extensions: [
            topgg
        ]
    })

    topgg.commands.add({
        type: "voted",
        code: `$log[$voteUserID voted ($voteType), streak $voteStreak]`
    })

    topgg.commands.add({
        type: "error",
        code: `$log[Top.gg: $postStatsError]`
    })

    client.login("YourToken")
    ```

    > ℹ️ **Note**\
    > `@tryforge/forgescript` is a peer dependency (2.5.0 or newer). A database extension, [ReForgeDB](https://github.com/Demonic1594/ReForgeDB) (`npm i github:Demonic1594/ReForgeDB`) or ForgeDB (`npm i @tryforge/forge.db`), is only needed for `store: "reforgedb"`.

<h3 align="center">Setting up Top.gg</h3><hr>

On your bot's page on Top.gg, open the webhook settings and enter:

- **Webhook URL:** `http://<your host>:<port>/dblwebhook` (the port is `3000` unless you set `port`; the path can be changed with `webhook.path`).
- **Legacy webhooks:** an **Authorization** value of your choice. Put the same value in `auth`.
- **Current (v1) webhooks:** copy the **secret** (`whs_...`) Top.gg shows into `webhook: { secret }`.

Both kinds can be enabled at once. Use the dashboard's test button, or `$sendTestVote`, to check the setup.

<h3 align="center">Options</h3><hr>

| Option | Default | What it does |
|---|---|---|
| `token` | none | Top.gg API token, for posting stats and the API functions |
| `auth` | none | Legacy webhook Authorization; an empty value is refused |
| `port` | `3000` | Port of the vote webhook (a numeric string from `.env` works) |
| `webhook.secret` | none | v1 webhook secret (`whs_...`); signed deliveries are checked with it |
| `webhook.path` | `/dblwebhook` | URL path Top.gg posts to |
| `webhook.host` | all interfaces | Address to listen on |
| `webhook.listen` | `true` | `false` opens no port; mount `topgg.webhookListener` on your own server |
| `webhook.maxBodySize` | `16384` | Largest accepted body, in bytes |
| `webhook` | on | `false` never starts the webhook |
| `post` | off | Post the server count: `{ interval }` in ms, at least `900000` (15 minutes); needs `token` |
| `events` | `[]` | Events your commands listen to |
| `dedupeWindow` | `3600000` | A repeat of the same vote within this many ms is dropped; `0` turns it off; at most 11 hours |
| `store` | `"memory"` | Vote history: `"memory"`, `"reforgedb"` (`"forgedb"` is the same) or your own `{ get, set, pending? }` |
| `storeVariable` | `topggVote` | User variable used by `store: "reforgedb"` |
| `streakGrace` | `43200000` | A vote continues the streak when it comes at most this long (12 hours) after the user could vote again |
| `reminders` | `false` | Fire `voteReminder` when a voter can vote again |
| `reminderMaxDelay` | `43200000` | A reminder that came due while the bot was offline is still sent after a restart if it is at most this late (12 hours); older ones are dropped. At least `60000` |
| `logLevel` | `info` | `silent`, `error`, `warn`, `info`, `debug` or `trace`; also the `REFORGETOPGG_LOG_LEVEL` environment variable |

The webhook starts when `auth` or `webhook.secret` is set. Without either, the extension only posts stats and answers API functions, and opens no port.

#### Using your own server
```js
const topgg = new ReForgeTopGG({ auth: process.env.TOPGG_AUTH, webhook: { listen: false } })
// express: mount it before any body parser
app.post("/dblwebhook", topgg.webhookListener)
```

<h3 align="center">Functions</h3><hr>

#### In the `voted` and `voteReminder` events
| Function | Returns |
|---|---|
| `$voteUserID` | The voter |
| `$voteBotID` | The bot voted for (empty for server votes) |
| `$voteGuildID` | The server voted for (empty for bot votes) |
| `$voteType` | `upvote`, or `test` for the test button and `$sendTestVote` |
| `$voteIsWeekend` | Whether the weekend multiplier was on |
| `$voteWeight` | `2` during the weekend multiplier, otherwise `1` |
| `$voteTimestamp` | When the vote was cast (ms) |
| `$voteQuery[key?]` | The vote page's query parameters as JSON, or one value, e.g. `$voteQuery[ref]` |

#### Vote history (recorded by the webhook, no request to Top.gg)
The user ID is optional: it defaults to the voter in vote events and to the author elsewhere.

| Function | Returns |
|---|---|
| `$voteCount[user ID?]` | Votes recorded (test votes excluded) |
| `$votePoints[user ID?]` | Votes with weekend votes counted twice |
| `$voteStreak[user ID?]` | Votes in a row; `0` once the streak is broken |
| `$lastVoteTime[user ID?]` | When the user last voted (ms), empty if never |
| `$nextVoteTime[user ID?]` | When the user can vote again (ms), empty if never |
| `$votedWithin[duration;user ID?]` | Whether a vote was recorded within the duration, e.g. `$votedWithin[12h]` |

#### Top.gg API (needs `token`)
These fail with an error when the request fails. Use `$try` for a fallback.

Top.gg blocks a token for an hour once it gets more than 60 requests a minute to its bot endpoints, so a spammed `$hasVoted` command could take down your stats posting and every API function. ReForgeTopGG prevents that: identical requests in flight share one call, answers are reused for a short time (a "voted" answer for 60 s, "not voted" for 30 s, vote totals for 60 s, the weekend flag for 5 minutes; a vote reaching the webhook clears that user's answer at once), and at most 50 requests a minute are sent. Beyond that the function fails with "Top.gg API request not sent ... Try again in N s", which `$try` catches.

| Function | Returns |
|---|---|
| `$hasVoted[user ID]` | Whether the user voted in the last 12 hours (an ID or a mention) |
| `$totalVotes` | Total votes of the bot |
| `$monthlyVotes` | Votes of the bot this month |
| `$isVoteWeekend` | Whether the weekend multiplier is on |

#### Stats posting (in the `posted` and `error` events)
| Function | Returns |
|---|---|
| `$postedServerCount` | Server count that was posted |
| `$postedShardCount` | Shard count that was posted |
| `$postedShardID` | Shard that posted |
| `$postStatsError` | The error message, in the `error` event |

#### Development
| Function | Returns |
|---|---|
| `$sendTestVote[user ID?;weekend?;query?]` | Sends a test vote to the bot's own webhook; returns the HTTP status (`204` = accepted) |

#### Example: a vote-gated command with a fallback
```js
module.exports = {
  name: "daily",
  code: `
  $onlyIf[$try[$hasVoted[$authorID];$votedWithin[12h]]==true;Vote for me on Top.gg first!]
  Here is your daily reward.
  `
}
```

<h3 align="center">Events</h3><hr>

| Event | Fired when |
|---|---|
| `voted` | A vote (or test vote) arrives; once per vote, even when Top.gg delivers it again |
| `voteReminder` | A voter can vote again (needs `reminders: true`); once per vote |
| `posted` | The server count was posted |
| `error` | Posting failed, the webhook could not start, a vote could not be used or stored |

```js
topgg.commands.add({
    type: "voteReminder",
    code: `$sendDM[$voteUserID;You can vote again! Your streak is $voteStreak.]`
})
```

<h3 align="center">Vote History, Streaks and Reminders</h3><hr>

Every `upvote` the webhook accepts is recorded for its voter: count, weekend points, streak, first, last and next vote time. Test votes are not recorded.

- **`store: "memory"`** (default) keeps up to 100,000 users and forgets everything on restart.
- **`store: "reforgedb"`** keeps one JSON value per user in the user variable `topggVote` (readable with `$getUserVar[topggVote;<user ID>]`) of the database extension your bot loaded: ReForgeDB, or the original ForgeDB. `store: "forgedb"` does the same, so 3.0.0 configurations keep working. Add `new ReForgeDB()` or `new ForgeDB()` to your extensions, before or after ReForgeTopGG; ReForgeTopGG refuses to start without one. Load only one of them (they add the same functions); with both, vote history goes to ReForgeDB and a warning is logged.
- **Your own store:** pass an object with `get(user)`, `set(record)` and optionally `pending()` (records whose reminder is not sent yet, to reschedule reminders after a restart).

If writing a vote fails, the webhook answers `500` so Top.gg delivers it again, and the `error` event fires.

A **streak** grows by one when a vote comes at most `streakGrace` (12 hours by default) after the user could vote again, i.e. at most 24 hours after their previous vote. `$voteStreak` reads `0` once that time has passed.

**Reminders** (`reminders: true`) fire `voteReminder` once, when the 12 hours of a vote are over. A newer vote moves the reminder. With a store that has `pending()` (memory and the database store do), reminders that were still due are scheduled again when the bot is ready.

A reminder that came due while the bot was offline is sent when the bot is back, if it is at most `reminderMaxDelay` (12 hours) late. Older ones are dropped and marked as sent, and their number is logged: a bot that was off for a week, or that turns `reminders` on for the first time with a long history in its store, does not send a flood of "you can vote again" messages about votes from long ago.

ReForgeTopGG warns at start-up when `voteReminder` is in `events` but `reminders` is off (the event would never fire), and when `reminders` is on but nothing listens to `voteReminder`.

<h3 align="center">Testing Votes</h3><hr>

- `$sendTestVote[$authorID]` sends a test vote to your own webhook over HTTP, with your secret (signed if `webhook.secret` is set), and returns the status. Your `voted` commands run with `$voteType` = `test`.
- In JavaScript: `await topgg.sendTestVote({ user: "123456789012345678", weekend: true, query: "ref=abc" })`.
- To feed a vote in without any HTTP (tests): `await topgg.receive(vote)` with a vote object (see `normalizeLegacyVote`).

Check `$voteType` before giving rewards if your test command is public.

<h3 align="center">Security</h3><hr>

- The webhook refuses requests without the right `Authorization` (legacy) or a valid `x-topgg-signature` (v1), with `401`. The secret is never logged or echoed.
- Signed deliveries more than 5 minutes off are refused (replay protection, as Top.gg's docs require).
- Only `POST` with `Content-Type: application/json` on the configured path is accepted.
- Invalid payloads get `400`; Top.gg does not retry 4xx. Votes that could not be stored get `500`; Top.gg retries those.
- API errors are passed on with the token removed.
- Slow clients are cut off: headers within 10 s, the whole request within 15 s (checked every second).
- A request answered before its body was read (refused) closes its connection, so a client cannot reuse a connection left half-read.
- Refused requests are never events (anyone can send them) and the secret is never echoed; their number is logged at most once a minute, because a webhook that refuses everything usually means the secret differs from Top.gg's.
- Two deliveries of one user are stored one after the other, never interleaved; a repeat that arrives while the first delivery is still being stored waits for it, and fails too if it fails, so Top.gg delivers the vote again instead of losing it.
- A listener that throws (in your JavaScript) is logged; it never fails a stored vote or crashes the bot.

<h3 align="center">Errors, Logging and Debugging</h3><hr>

Everything ReForgeTopGG prints starts with `[ReForgeTopGG]`, and so do the errors of its options (which stop the bot at start-up) and of its functions (which `$try` catches). Errors handed to your `error` event keep their original message.

`logLevel` (or the `REFORGETOPGG_LOG_LEVEL` environment variable) sets what is written to the console:

| Level | Shows |
|---|---|
| `silent` | Nothing |
| `error` | Votes that could not be stored, a webhook that could not start, failed reminders |
| `warn` | Also configuration problems and refused webhook requests (counted, at most once a minute) |
| `info` (default) | Also start-up messages and reminders dropped after a restart |
| `debug` | Also every vote (accepted or dropped as a repeat, with the time to store it), reminder and Top.gg API request (answered, from cache, shared, or refused by the budget) |
| `trace` | Also every webhook request with its answer: `POST /dblwebhook -> 204 (1.2 ms)` |

Turn on `debug` without touching the code: `REFORGETOPGG_LOG_LEVEL=debug node index.js`.

No level ever writes `auth`, `webhook.secret` or `token`, an `Authorization` or signature header, or a request body.

<h3 align="center">Switching from ForgeTopGG</h3><hr>

1. Uninstall the original and install ReForgeTopGG:
    ```bash
    npm uninstall @tryforge/forge.topgg
    npm i github:Demonic1594/ReForgeTopGG
    ```
2. Change `require("@tryforge/forge.topgg")` to `require("@tryforge/reforge.topgg")`, and `ForgeTopGG` to `ReForgeTopGG`.
3. Your options, commands, events and functions keep working, with these differences:
    - An empty `auth` stops the bot at start-up. Without `auth` the webhook does not start at all.
    - `$hasVoted`, `$totalVotes` and `$monthlyVotes` stop the command with an error when Top.gg can't be reached. Wrap them in `$try[...;fallback]` where you want a fallback.
    - A delivery Top.gg repeats fires `voted` once, not every time.
    - `$voteQuery` always returns JSON (`{}` when empty); before, it returned an empty text when there was no query.
    - Wrong `Authorization` gets `401` (was `403`).

Both packages cannot be loaded at once: they register the same functions and events. ReForgeTopGG stops at start-up if `forge.topgg` is also in your extensions. The extension registers itself as `reforge.topgg`.

<h3 align="center">Upgrading from 2.x</h3><hr>

**3.1.0** needs no changes. `store: "forgedb"` keeps working and now also works with [ReForgeDB](https://github.com/Demonic1594/ReForgeDB); `"reforgedb"` is the new name. Switching from ForgeDB to ReForgeDB with your vote history: see "Switching from ForgeDB" in ReForgeDB's README (your variables, `topggVote` included, carry over). `ForgeDBVoteStore` is now called `DatabaseVoteStore`; the old name still works.

3.0.0 changes three things your code may notice; options, commands, events and functions are otherwise the same.

1. **The `ForgeTopGG` and `IForgeTopGGOptions` names are gone.** Use `ReForgeTopGG` and `IReForgeTopGGOptions`. `require("@tryforge/reforge.topgg").ForgeTopGG` is `undefined` now, so `new ForgeTopGG(...)` fails with "ForgeTopGG is not a constructor".
2. **Messages start with `[ReForgeTopGG]`** (they started with `ReForgeTopGG:` or nothing), in the console, in option errors and in function errors. Update anything that matches on their text.
3. **Old reminders are dropped after a restart.** A reminder more than 12 hours late is no longer sent; set `reminderMaxDelay` to keep a longer window.

CI now tests Node.js 22 and 24. `package.json` still allows Node.js 18.17 and newer, but versions below 22 are no longer tested; ForgeScript 2.8 itself needs Node.js 22.

<h3 align="center">Notes and Limits</h3><hr>

- The vote cooldown is 12 hours. Legacy deliveries carry no expiry, so `$nextVoteTime` is the time the vote arrived plus 12 hours; v1 deliveries carry Top.gg's own `expires_at`.
- Legacy deliveries carry no vote ID, so a repeat is recognised by voter, target and type. A real second vote can only come 12 hours later, outside the 1-hour window.
- Test votes are collapsed for at most 1 minute, so the test button works again right away.
- Stats posting starts on discord.js's `clientReady` event (`ready` on discord.js before 14.22) and uses `topgg-autoposter`: it posts this process's guild count, with `shardId`/`shardCount` from discord.js. It needs `discord.js` to be the same copy ForgeScript uses (a single `npm i` does that).
- The API functions use Top.gg's legacy API through `@top-gg/sdk` 3.x. @top-gg/sdk 4.0.0 (August 2026) moved to the v1 API and is ESM-only; this extension does not use it yet.
- ForgeScript only logs errors thrown while an extension starts and keeps going, so ReForgeTopGG checks its options when it is created and its conflicts before it starts, where an error does stop the bot.

<h3 align="center">Development</h3><hr>

```bash
npm install
npm run build      # compile TypeScript to dist/
npm run lint       # strict type check (unused code, missing returns)
npm test           # build, then run all tests
npm run docgen     # regenerate metadata/*.json
```

The tests start a real ForgeClient (it never logs in) with the extension on a random port, send real HTTP requests to the webhook, and run ForgeScript code through the real interpreter. Top.gg is never contacted: the API client is stubbed. The database store is tested on SQLite with ReForgeDB, with ForgeDB, and with both loaded.

`test/fuzz.test.js` is a seeded fuzzer: thousands of mixed requests (valid legacy and signed votes, retries, forged secrets, mutated signatures, broken bodies, wrong types, odd methods, paths and headers) sent in concurrent bursts, checking that each vote is emitted exactly once and the history matches what was accepted; vote histories against a reference model; and every function with hostile arguments. Replay a seed with `FUZZ_SEED=42 npm test`, or run more with `FUZZ_ROUNDS=20000`. `test/robustness.test.js` holds the abuse and race cases found by stress-testing 2.0.0, and `test/v3.test.js` the fixes and conventions of 3.0.0.

#### Releasing

1. Set the new version in `package.json` (`npm version <x.y.z> --no-git-tag-version` also updates `package-lock.json`).
2. Run `npm test` and `npm run docgen`, and commit `dist/` and `metadata/` with the sources: the package installs straight from GitHub, and CI fails when they are out of date.
3. Add the release to [CHANGELOG.md](CHANGELOG.md).
4. Once it is merged into `main`, tag the merge commit and push the tag:
    ```bash
    git tag -a v<x.y.z> -m "ReForgeTopGG <x.y.z>"
    git push origin v<x.y.z>
    ```

<h3 align="center">Credits and License</h3><hr>

ReForgeTopGG is a modified fork of [ForgeTopGG](https://github.com/tryforge/ForgeTopGG) (`@tryforge/forge.topgg`) by ruben40000 (Plinkie03), aggelos-007, xNickyDev and the other tryforge contributors, forked at version 1.1.4 (commit `6a392b5`). Modifications were made in November 2026 and are listed in the [changelog](CHANGELOG.md).

The v1 signature check follows Top.gg's published webhook documentation; it is written from scratch for this package.

Licensed under the [GNU GPL v3](LICENSE), like the original.

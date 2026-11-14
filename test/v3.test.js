"use strict"
/*
 * Fixes and conventions of 3.0.0. Each test fails on 2.1.0.
 */
const { test, after } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const path = require("path")
const { execFileSync } = require("child_process")
const { ForgeClient } = require("@tryforge/forgescript")
const { boot, run, vote, request, upvote, logs, AUTH, USER, BOT } = require("./fixtures/harness")
const lib = require("..")
const { ReForgeTopGG, applyVote, normalizeLegacyVote, readyEventName } = lib

const HOUR = 3_600_000
const DAY = 24 * HOUR
const clients = []
after(async () => {
    for (const c of clients) await c.destroy()
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** A vote record of `user` whose reminder came (or comes) due at `expiresAt`. */
function record(user, expiresAt) {
    const votedAt = expiresAt - 12 * HOUR
    return applyVote(undefined, { user, bot: BOT, type: "upvote", isWeekend: false, weight: 1, query: {}, votedAt, expiresAt, source: "v0" }, 12 * HOUR)
}

/** A store that keeps records in a Map, like a database would across restarts. */
function mapStore(records = []) {
    const rows = new Map(records.map((r) => [r.user, { ...r }]))
    return {
        rows,
        get: (u) => (rows.has(u) ? { ...rows.get(u) } : undefined),
        set: (r) => void rows.set(r.user, { ...r }),
        pending: () => [...rows.values()].filter((r) => !r.reminded).map((r) => ({ ...r })),
    }
}

/** Boots with a persistent store and starts it as if Discord said the bot is ready. */
async function bootReady(options) {
    const b = await boot({ webhook: false, reminders: true, ...options })
    clients.push(b.client)
    const fired = []
    b.top.emitter.on("voteReminder", (v) => fired.push(v))
    b.client.emit(readyEventName(), b.client)
    return { ...b, fired }
}

const userId = (i) => String(100000000000000000n + BigInt(i))

test("reminders that came due long ago are dropped at start-up and marked sent, not fired", async () => {
    const now = Date.now()
    const old = Array.from({ length: 500 }, (_, i) => record(userId(i), now - 60 * DAY))
    const lateButFresh = record(userId(1000), now - HOUR)
    const upcoming = record(userId(1001), now + 150)
    const store = mapStore([...old, lateButFresh, upcoming])
    const b = await bootReady({ store })
    await sleep(400)
    assert.deepEqual(b.fired.map((v) => v.user).sort(), [userId(1000), userId(1001)].sort(), "only the reminder that is 1 hour late and the upcoming one fire")
    assert.equal(store.pending().length, 0, "the dropped reminders are marked as sent, so they are not read again on the next start")
})

test("reminderMaxDelay sets how late a reminder may still be sent", async () => {
    const now = Date.now()
    const store = mapStore([record(userId(1), now - 2 * HOUR), record(userId(2), now - 10 * 60_000)])
    const b = await bootReady({ store, reminderMaxDelay: HOUR })
    await sleep(200)
    assert.deepEqual(b.fired.map((v) => v.user), [userId(2)])
    assert.throws(() => new ReForgeTopGG({ reminderMaxDelay: 1000 }), /"reminderMaxDelay"/)
    assert.throws(() => new ReForgeTopGG({ reminderMaxDelay: Infinity }), /"reminderMaxDelay"/)
})

test("a reminder never overwrites a vote stored at the same moment", async () => {
    // The reminder reads the record, a vote is stored, the reminder writes back
    // what it read: without a lock the new vote is lost.
    const store = mapStore()
    let hold = null
    const get = store.get
    store.get = (u) => {
        const value = get(u)
        if (!hold) return value
        const gate = hold
        hold = null
        return gate.then(() => value)
    }
    const b = await bootReady({ store, dedupeWindow: 0 })
    const now = Date.now()
    await b.top.receive({ ...normalizeLegacyVote(upvote(), now), expiresAt: now + 30 })
    let release
    hold = new Promise((r) => (release = r))
    await sleep(60) // the reminder fired and is reading the record
    const second = b.top.receive(normalizeLegacyVote(upvote(), Date.now()))
    await sleep(20)
    release()
    await second
    await sleep(20)
    assert.equal(store.rows.get(USER).count, 2, "both votes are counted")
})

test("$hasVoted asked right after a vote asks Top.gg again, even when an older request was in flight", async () => {
    const b = await boot({ webhook: false })
    clients.push(b.client)
    let calls = 0
    let release
    b.top.api.client.hasVoted = () => {
        calls++
        return calls === 1 ? new Promise((r) => (release = r)) : Promise.resolve(true)
    }
    const first = b.top.api.hasVoted(USER) // Top.gg has not seen the vote yet
    await b.top.receive(normalizeLegacyVote(upvote(), Date.now()))
    release(false) // its answer arrives after the vote
    await first
    assert.equal(await run(b.client, `$hasVoted[${USER}]`), "true")
    assert.equal(calls, 2)
})

test("the original class and options names are not exported", () => {
    assert.equal(lib.ForgeTopGG, undefined)
    const types = fs.readFileSync(path.join(__dirname, "..", "dist", "index.d.ts"), "utf8")
    assert.doesNotMatch(types, /\bForgeTopGG\b/)
    assert.doesNotMatch(types, /\bIForgeTopGGOptions\b/)
})

test("log lines, option errors and function errors start with [ReForgeTopGG]", async () => {
    logs.length = 0
    const b = await boot({ auth: undefined, webhook: false })
    clients.push(b.client)
    const own = logs.filter((l) => /webhook is off/.test(l.text))
    assert.equal(own.length, 1)
    assert.match(own[0].text, /^\[ReForgeTopGG\] /)
    assert.throws(() => new ReForgeTopGG({ auth: "" }), /^Error: \[ReForgeTopGG\] "auth" is empty/)
    assert.throws(
        () => new ForgeClient({ intents: ["Guilds"], events: [], prefixes: ["!"], extensions: [new ReForgeTopGG({ webhook: false, events: ["vote"] })] }),
        /^Error: \[ReForgeTopGG\] Unknown event "vote"/
    )
    logs.length = 0
    assert.equal(await run(b.client, "$hasVoted[abc]"), null)
    assert.ok(logs.some((l) => l.text.includes("[ReForgeTopGG] \"abc\" is not a user ID")), logs.map((l) => l.text).join("\n"))
})

test("logLevel: invalid values are refused, silent prints nothing, debug shows each vote", async () => {
    assert.throws(() => new ReForgeTopGG({ logLevel: "verbose" }), /"logLevel"/)
    try {
        logs.length = 0
        const quiet = await boot({ auth: undefined, webhook: false, logLevel: "silent" })
        clients.push(quiet.client)
        assert.deepEqual(logs.filter((l) => l.text.includes("[ReForgeTopGG]")), [])

        logs.length = 0
        const b = await boot({ logLevel: "debug", dedupeWindow: HOUR })
        clients.push(b.client)
        assert.equal((await vote(b.port(), upvote())).status, 204)
        assert.equal((await vote(b.port(), upvote())).status, 204)
        const debug = logs.filter((l) => l.level === "debug").map((l) => l.text)
        assert.ok(debug.some((t) => t.includes(`vote of ${USER} for ${BOT} accepted`)), debug.join("\n"))
        assert.ok(debug.some((t) => t.includes(`vote of ${USER} for ${BOT} dropped: repeat`)), debug.join("\n"))
    } finally {
        lib.ReForgeTopGGLogger.level = "info"
    }
})

test("trace logs every webhook request but never a secret, token or signature", async () => {
    const SECRET = "whs_trace_secret"
    try {
        logs.length = 0
        const b = await boot({ logLevel: "trace", token: "tok_very_secret", webhook: { secret: SECRET } })
        clients.push(b.client)
        await vote(b.port(), upvote())
        await vote(b.port(), upvote(), { authorization: "wrong-guess" })
        const body = JSON.stringify({ type: "vote.create", data: { id: "v1", weight: 1, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 12 * HOUR).toISOString(), user: { platform_id: USER }, project: { type: "bot", platform_id: BOT } } })
        await request(b.port(), { headers: { "content-type": "application/json", "x-topgg-signature": lib.signBody(body, SECRET) }, body })
        const text = logs.map((l) => l.text).join("\n")
        assert.match(text, /POST \/dblwebhook -> 204/)
        assert.match(text, /POST \/dblwebhook -> 401/)
        for (const secret of [AUTH, SECRET, "tok_very_secret", "wrong-guess", "v1="]) assert.ok(!text.includes(secret), `"${secret}" appears in the log`)
    } finally {
        lib.ReForgeTopGGLogger.level = "info"
    }
})

test("REFORGETOPGG_LOG_LEVEL sets the level when the option is not given", () => {
    const script = `const { ReForgeTopGGLogger } = require(${JSON.stringify(path.join(__dirname, ".."))}); console.log(ReForgeTopGGLogger.level)`
    const out = execFileSync(process.execPath, ["-e", script], { env: { ...process.env, REFORGETOPGG_LOG_LEVEL: "debug" } }).toString().trim()
    assert.equal(out, "debug")
})

test("a voteReminder event without reminders, or reminders without the event, is pointed out", async () => {
    logs.length = 0
    const a = await boot({ webhook: false, events: ["voteReminder"] })
    clients.push(a.client)
    a.client.emit(readyEventName(), a.client)
    const b = await boot({ webhook: false, reminders: true, events: ["voted"] })
    clients.push(b.client)
    b.client.emit(readyEventName(), b.client)
    const text = logs.filter((l) => l.level === "warn").map((l) => l.text).join("\n")
    assert.match(text, /"voteReminder" is in events, but "reminders" is off/)
    assert.match(text, /"reminders" is on, but "voteReminder" is not in events/)

    // Listening in JavaScript counts: no warning then.
    logs.length = 0
    const c = await boot({ webhook: false, reminders: true })
    clients.push(c.client)
    c.top.emitter.on("voteReminder", () => {})
    c.client.emit(readyEventName(), c.client)
    assert.deepEqual(logs.filter((l) => l.level === "warn" && l.text.startsWith("[ReForgeTopGG]")).map((l) => l.text), [])
})

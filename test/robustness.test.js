"use strict"
// Abuse, race and misuse cases found by stress-testing 2.0.0. Each failed on 2.0.0.
const { test, after } = require("node:test")
const assert = require("node:assert/strict")
const net = require("net")
const http = require("http")
const { once } = require("events")
const { Api } = require("@top-gg/sdk")
const { ForgeClient } = require("@tryforge/forgescript")
const { boot, run, vote, request, upvote, logs, USER, BOT } = require("./fixtures/harness")
const lib = require("..")

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const clients = []
after(async () => { for (const c of clients) await c.destroy() })
async function start(options, o) {
    const b = await boot(options, o)
    clients.push(b.client)
    return b
}

test("a retry that arrives while the first delivery fails is not dropped: both get 500", async () => {
    let calls = 0
    const store = new lib.MemoryVoteStore()
    const slow = { get: (u) => store.get(u), set: async (r) => { calls++; await sleep(80); if (calls === 1) throw new Error("db hiccup"); store.set(r) } }
    const { port } = await start({ store: slow })
    const [first, retry] = await Promise.all([vote(port(), upvote()), sleep(20).then(() => vote(port(), upvote()))])
    assert.equal(first.status, 500)
    assert.equal(retry.status, 500, "2.0.0 answered 204 here and the vote was lost")
    assert.equal((await vote(port(), upvote())).status, 204, "the next delivery is stored")
    assert.equal(store.get(USER).count, 1)
})

test("two votes of one user at the same moment are both counted", async () => {
    const store = new lib.MemoryVoteStore()
    const slow = { get: async (u) => { const r = store.get(u); await sleep(40); return r }, set: (r) => store.set(r) }
    const { port } = await start({ store: slow })
    await Promise.all([vote(port(), upvote()), vote(port(), { user: USER, guild: "222222222222222222", type: "upvote" })])
    assert.equal(store.get(USER).count, 2, "2.0.0 counted 1 (read-modify-write race)")
})

test("throwing listeners never crash the bot or fail a stored vote", async () => {
    const blocker = http.createServer().listen(0)
    await once(blocker, "listening")
    let uncaught = null
    const onUncaught = (e) => { uncaught = e }
    process.once("uncaughtException", onUncaught)
    const b = await start({ port: blocker.address().port }, { listen: false })
    b.top.emitter.on("error", () => { throw new Error("error handler bug") })
    await sleep(150)
    process.removeListener("uncaughtException", onUncaught)
    assert.equal(uncaught, null, "2.0.0 threw out of the server's error handler")
    blocker.close()

    const c = await start()
    c.top.emitter.on("voted", () => { throw new Error("listener bug") })
    assert.equal((await vote(c.port(), upvote())).status, 204, "2.0.0 answered 500 for a vote it had stored")
    assert.equal((await c.top.getRecord(USER)).count, 1)
})

test("options from .env and JSON configs: numeric strings, numbers and null", async () => {
    const t = new lib.ReForgeTopGG({ auth: 12345, port: " 3001 ", token: null, webhook: { secret: null, port: "3002" } })
    assert.equal(t.options.auth, "12345")
    assert.equal(t.options.port, 3001)
    assert.equal(t.options.webhook.port, 3002)
    assert.equal(t.options.token, undefined)
    assert.ok(t.webhook, "a numeric auth turns the webhook on")
    assert.equal(new lib.ReForgeTopGG({ auth: null }).webhook, null, "null means not set")
    assert.throws(() => new lib.ReForgeTopGG({ auth: {} }), /"auth" must be text/)
    assert.throws(() => new lib.ReForgeTopGG({ port: "30x" }), /"port"/)
})

test("an unknown event name stops the bot with the list of events", () => {
    assert.throws(
        () => new ForgeClient({ intents: ["Guilds"], events: [], prefixes: ["!"], extensions: [new lib.ReForgeTopGG({ webhook: false, events: ["vote"] })] }),
        /unknown event "vote" in "events". The events are voted, voteReminder, posted, error/i,
    )
})

test("$hasVoted bursts share one request; Top.gg's 60/min limit is never reached", async (t) => {
    let sent = 0
    t.mock.method(Api.prototype, "_request", async (_m, _p, body) => { sent++; return { voted: body?.userId === USER ? 1 : 0 } })
    const b = await start({ webhook: false })
    await Promise.all(Array.from({ length: 80 }, () => run(b.client, `$hasVoted[${USER}]`)))
    assert.equal(sent, 1, "2.0.0 sent 80 requests (Top.gg blocks the token for an hour past 60)")
    // 70 different users: at most the budget is sent, the rest fail locally
    logs.length = 0
    const results = await Promise.all(Array.from({ length: 70 }, (_, i) => run(b.client, `$try[$hasVoted[1000000000000000${String(i).padStart(2, "0")}];limited]`)))
    assert.equal(sent, lib.TOPGG_API_BUDGET)
    assert.equal(results.filter((r) => r === "limited").length, 70 - (lib.TOPGG_API_BUDGET - 1))
    assert.equal(b.top.api.used, lib.TOPGG_API_BUDGET)
})

test("a vote reaching the webhook clears that user's cached $hasVoted answer", async (t) => {
    let voted = false
    t.mock.method(Api.prototype, "_request", async () => ({ voted: voted ? 1 : 0 }))
    const b = await start()
    assert.equal(await run(b.client, `$hasVoted[${USER}]`), "false")
    voted = true
    assert.equal(await run(b.client, `$hasVoted[${USER}]`), "false", "cached for a short time")
    await vote(b.port(), upvote())
    assert.equal(await run(b.client, `$hasVoted[${USER}]`), "true", "the vote cleared the cache")
})

test("a UTF-8 BOM before the JSON and several v1 signatures are accepted", async () => {
    const a = await start()
    assert.equal((await vote(a.port(), "﻿" + JSON.stringify(upvote()))).status, 204)
    const b = await start({ auth: undefined, webhook: { secret: "whs_new" } })
    const raw = JSON.stringify({ type: "webhook.test", data: { project: { type: "bot", platform_id: BOT }, user: { platform_id: USER } } })
    const good = lib.signBody(raw, "whs_new").split(",")[1].slice(3)
    const t = Math.floor(Date.now() / 1000)
    const res = await request(b.port(), { headers: { "content-type": "application/json", "x-topgg-signature": `t=${t},v1=${"0".repeat(64)},v1=${good}` }, body: raw })
    assert.equal(res.status, 204)
    const bad = await request(b.port(), { headers: { "content-type": "application/json", "x-topgg-signature": `t=${t},v1=${"0".repeat(64)},v1=${"1".repeat(64)}` }, body: raw })
    assert.equal(bad.status, 401)
})

test("slow clients that trickle headers are cut off within seconds", async () => {
    const { port } = await start()
    const s = net.connect(port(), "127.0.0.1")
    s.on("error", () => {})
    await once(s, "connect")
    s.write("POST /dblwebhook HTTP/1.1\r\nHost: x\r\n")
    const t0 = Date.now()
    const iv = setInterval(() => { if (!s.destroyed && s.writable) s.write("x-a: b\r\n", () => {}) }, 500)
    await new Promise((r) => s.on("close", r)) // not once(): the server's reset arrives as an EPIPE error first
    clearInterval(iv)
    assert.ok(Date.now() - t0 < 13_000, `closed after ${Date.now() - t0} ms (2.0.0 kept it open for 30 s or more)`)
})

test("user IDs as mentions and with spaces are understood", async () => {
    const b = await start({ webhook: false })
    await b.top.receive(lib.normalizeLegacyVote(upvote(), Date.now()))
    assert.equal(await run(b.client, `$voteCount[<@${USER}>]|$voteCount[<@!${USER}>]|$voteCount[ ${USER} ]`), "1|1|1")
    assert.equal(lib.parseUserId("<@#1>"), null)
    assert.equal(lib.parseUserId("1234567890123456789012345"), null)
})

test("refused requests are logged once a minute, never echoed, never emitted", async () => {
    const b = await start()
    logs.length = 0
    for (let i = 0; i < 5; i++) await vote(b.port(), upvote(), { authorization: "nope" })
    const warns = logs.filter((l) => /refused/i.test(l.text))
    assert.equal(warns.length, 1)
    assert.match(warns[0].text, /refused 1 webhook request/i)
    assert.ok(!warns[0].text.includes("nope"))
    assert.equal(b.emitted.length, 0)
})

test("warnings for whitespace in auth and for commands of events that are not loaded", async () => {
    logs.length = 0
    const b = await start({ auth: "secret\r", webhook: false })
    b.top.commands.add({ type: "voted", code: "$log[x]" })
    b.client.emit("clientReady", b.client)
    assert.ok(logs.some((l) => l.text.includes("whitespace")))
    assert.ok(logs.some((l) => /there are voted commands, but "voted" is not in the extension's events/i.test(l.text)))
})

test("the ForgeDB store waits for ForgeDB to connect instead of failing at once", async () => {
    const rec = { user: USER, target: BOT, targetIsGuild: false, count: 1, points: 1, streak: 1, firstVoteAt: 0, lastVoteAt: Date.now(), expiresAt: Date.now() + 50, lastWeight: 1, reminded: false }
    const fake = { db: null, get: async () => ({ value: JSON.stringify(rec) }), set: async () => {}, find: async () => [{ value: JSON.stringify(rec) }] }
    const store = new lib.ForgeDBVoteStore("topggVote", () => fake)
    setTimeout(() => { fake.db = {} }, 100)
    const t0 = Date.now()
    const pending = await store.pending()
    assert.equal(pending.length, 1, "2.0.0 threw 'ForgeDB is not connected yet'")
    assert.ok(Date.now() - t0 >= 90)
    fake.db = null
    await assert.rejects(store.get(USER).then(() => { throw new Error("should time out") }), /not connected yet|should time out/)
})

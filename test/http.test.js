"use strict"
// The Top.gg client on Node's built-in fetch, against a real local HTTP
// server: the requests it sends (the ones @top-gg/sdk 3.x sent), how it reads
// answers and failures, and the API functions and stats posting going through
// it. Also: no production dependency brings undici 5 or @fastify/busboy back.
const { test, before, after } = require("node:test")
const assert = require("node:assert/strict")
const http = require("http")
const fs = require("fs")
const path = require("path")
const { TopGGClient, TopGGAPIError, StatsPoster, DEFAULT_POST_INTERVAL } = require("..")
const { boot, run, logs, USER } = require("./fixtures/harness")

const TOKEN = "test-token"
const seen = []
let reply = () => [200, { "content-type": "application/json" }, "{}"]
let server, base

before(async () => {
    server = http.createServer((req, res) => {
        let body = ""
        req.on("data", (c) => (body += c))
        req.on("end", () => {
            seen.push({ method: req.method, url: req.url, headers: req.headers, body })
            const out = reply(req)
            if (out === null) return // never answer
            const [status, headers, text] = out
            res.writeHead(status, headers)
            res.end(text)
        })
    })
    await new Promise((r) => server.listen(0, "127.0.0.1", r))
    base = `http://127.0.0.1:${server.address().port}/api`
})
after(() => {
    server.closeAllConnections()
    server.close()
})

const json = (status, value) => () => [status, { "content-type": "application/json; charset=utf-8" }, JSON.stringify(value)]
const client = (options = {}) => new TopGGClient(TOKEN, { baseUrl: base, ...options })
const last = () => seen[seen.length - 1]

test("sends the requests @top-gg/sdk 3.x sent, with the token as the authorization header", async () => {
    reply = (req) => {
        if (req.url.startsWith("/api/bots/check")) return json(200, { voted: 1 })()
        if (req.url === "/api/weekend") return json(200, { is_weekend: true })()
        if (req.url === "/api/bots/stats") return json(200, {})()
        return json(200, { id: "1", points: 42, monthlyPoints: 7 })()
    }
    const api = client()
    assert.equal(await api.hasVoted(USER), true)
    assert.equal(last().method, "GET")
    assert.equal(last().url, `/api/bots/check?userId=${USER}`)
    assert.equal(last().headers.authorization, TOKEN)
    assert.equal(last().headers["content-type"], undefined, "no body, no content type")

    assert.deepEqual(await api.getBot("123"), { id: "1", points: 42, monthlyPoints: 7 })
    assert.equal(last().url, "/api/bots/123")

    assert.equal(await api.isWeekend(), true)
    assert.equal(last().url, "/api/weekend")

    const stats = { serverCount: 12, shardId: 0, shardCount: 2 }
    assert.deepEqual(await api.postStats(stats), stats)
    assert.equal(last().method, "POST")
    assert.equal(last().headers["content-type"], "application/json")
    assert.deepEqual(JSON.parse(last().body), { server_count: 12, shard_id: 0, shard_count: 2 })
})

test("reads answers the way the SDK did: falsy voted, text bodies, missing arguments", async () => {
    reply = json(200, { voted: 0 })
    assert.equal(await client().hasVoted(USER), false)
    reply = json(200, {})
    assert.equal(await client().isWeekend(), false)
    reply = () => [200, { "content-type": "text/plain" }, "hello"]
    assert.equal(await client().getBot("1"), "hello")
    await assert.rejects(client().hasVoted(""), /Missing ID/)
    await assert.rejects(client().postStats({ serverCount: 0 }), /Missing Server Count/)
})

test("a non-2xx answer fails with the SDK's message, and the body is kept", async () => {
    reply = json(401, { error: "Unauthorized" })
    const err = await client().hasVoted(USER).catch((e) => e)
    assert.ok(err instanceof TopGGAPIError)
    assert.equal(err.message, "401 Unauthorized (You need a token for this endpoint)")
    assert.equal(err.status, 401)
    assert.deepEqual(err.body, { error: "Unauthorized" })
    reply = () => [503, { "content-type": "text/html" }, "<html>down</html>"]
    await assert.rejects(client().isWeekend(), { message: "503 Service Unavailable" })
    reply = () => [429, {}, ""]
    await assert.rejects(client().getBot("1"), { message: "429 Too Many Requests" })
})

test("invalid JSON, a hung server, a redirect and a closed port each fail instead of hanging or following", async () => {
    reply = () => [200, { "content-type": "application/json" }, "{not json"]
    await assert.rejects(client().hasVoted(USER), /invalid JSON/)
    reply = () => null
    const started = Date.now()
    await assert.rejects(client({ timeout: 200 }).isWeekend(), /no answer within 200 ms/)
    assert.ok(Date.now() - started < 2_000)
    reply = () => [302, { location: "http://169.254.169.254/" }, ""]
    await assert.rejects(client().isWeekend())
    const closed = http.createServer()
    await new Promise((r) => closed.listen(0, "127.0.0.1", r))
    const port = closed.address().port
    await new Promise((r) => closed.close(r))
    await assert.rejects(new TopGGClient(TOKEN, { baseUrl: `http://127.0.0.1:${port}` }).isWeekend(), /ECONNREFUSED/)
})

test("the API functions go through the real client, and the token never reaches a message", async () => {
    const ctx = await boot({ webhook: false })
    try {
        Object.assign(ctx.top.api.client, { baseUrl: base })
        reply = json(200, { voted: 1 })
        assert.equal(await run(ctx.client, `$hasVoted[${USER}]`), "true")
        assert.equal(last().headers.authorization, TOKEN)
        reply = () => [500, { "content-type": "text/plain" }, `bad token ${TOKEN}`]
        ctx.top.api.clearCache()
        logs.length = 0
        assert.equal(await run(ctx.client, "$isVoteWeekend"), null)
        assert.ok(logs.some((l) => l.text.includes("Top.gg API request failed: 500 Internal Server Error")), JSON.stringify(logs))
        assert.ok(!logs.some((l) => l.text.includes(TOKEN)), "the token is never logged")
    } finally {
        await ctx.client.destroy()
    }
})

test("stats posting: posts over HTTP, reports errors as events, and its timers never hold the process", async () => {
    const fakeClient = { ws: { status: 0 }, guilds: { cache: { size: 7 } }, shard: null, options: {} }
    const poster = new StatsPoster(TOKEN, fakeClient, { sdk: client(), postOnStart: false })
    const events = []
    poster.on("posted", (s) => events.push(["posted", s]))
    poster.on("error", (e) => events.push(["error", e.message]))
    reply = json(200, {})
    await poster.post()
    assert.deepEqual(JSON.parse(last().body), { server_count: 7, shard_count: 1 })
    reply = json(403, {})
    await poster.post()
    assert.deepEqual(events, [["posted", { serverCount: 7, shardId: undefined, shardCount: 1 }], ["error", "403 Forbidden (You don't have access to this endpoint)"]])
    assert.equal(poster.interval, DEFAULT_POST_INTERVAL)
    assert.equal(poster.start(), true)
    assert.equal(poster.scheduled, true)
    poster.stop()
    assert.equal(poster.scheduled, false, "stop() also cancels the first post that was waiting")
})

test("the start-up log names the real posting interval (3.1.0 said 15 minutes while posting every 30)", async () => {
    const ctx = await boot({ webhook: false, post: { postOnStart: false } })
    try {
        logs.length = 0
        ctx.client.ws.status = 0
        ctx.client.emit("clientReady", ctx.client)
        assert.ok(logs.some((l) => l.text.includes("Posting stats to Top.gg every 30 minutes")), JSON.stringify(logs))
    } finally {
        await ctx.client.destroy()
    }
})

test("no production dependency brings in @top-gg/sdk, undici older than 6.29.1, or @fastify/busboy", () => {
    const lock = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package-lock.json"), "utf8"))
    const production = Object.entries(lock.packages).filter(([where, p]) => where && !p.dev && !p.devOptional && !p.peer)
    const names = production.map(([where, p]) => [where.split("node_modules/").pop(), p.version])
    const older = (v, than) => {
        const a = v.split(".").map(Number), b = than.split(".").map(Number)
        for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i]
        return false
    }
    for (const [name, version] of names) {
        assert.notEqual(name, "@top-gg/sdk")
        assert.notEqual(name, "@fastify/busboy")
        assert.notEqual(name, "topgg-autoposter")
        if (name === "undici") assert.ok(!older(version, "6.29.1"), `undici ${version}`)
    }
})

"use strict"
const { test, after } = require("node:test")
const assert = require("node:assert/strict")
const { boot, request, USER, BOT } = require("./fixtures/harness")
const { signBody, checkSignature, normalizeSignedVote } = require("..")

const SECRET = "whs_test_secret"
const clients = []
after(async () => { for (const c of clients) await c.destroy() })
async function start(options = {}) {
    const b = await boot({ auth: undefined, webhook: { secret: SECRET }, port: 0, ...options })
    clients.push(b.client)
    return b
}

const created = new Date().toISOString()
const expires = new Date(Date.now() + 12 * 3_600_000).toISOString()
const voteCreate = (extra = {}) => ({
    type: "vote.create",
    data: {
        id: "808499215864008704",
        weight: 1,
        created_at: created,
        expires_at: expires,
        project: { id: "803190510032756736", type: "bot", platform: "discord", platform_id: BOT },
        user: { id: "3949456393249234923", platform_id: USER, name: "x", avatar_url: "" },
        query: { ref: "abc" },
        ...extra,
    },
})
const send = (port, body, sig, extraHeaders = {}) => {
    const raw = typeof body === "string" ? body : JSON.stringify(body)
    return request(port, { headers: { "content-type": "application/json", "x-topgg-signature": sig ?? signBody(raw, SECRET), ...extraHeaders }, body: raw })
}

test("a correctly signed vote.create is accepted and normalized", async () => {
    const { port, emitted } = await start()
    assert.equal((await send(port(), voteCreate({ weight: 2 }))).status, 204)
    const v = emitted.find((e) => e.name === "voted").x
    assert.equal(v.user, USER)
    assert.equal(v.bot, BOT)
    assert.equal(v.type, "upvote")
    assert.equal(v.weight, 2)
    assert.equal(v.isWeekend, true)
    assert.equal(v.id, "808499215864008704")
    assert.deepEqual(v.query, { ref: "abc" })
    assert.equal(v.expiresAt, Date.parse(expires))
    assert.equal(v.source, "v1")
})

test("a bad signature, a wrong secret or an old timestamp is refused", async () => {
    const { port, emitted } = await start()
    const raw = JSON.stringify(voteCreate())
    assert.equal((await send(port(), raw, signBody(raw, "whs_wrong"))).status, 401)
    assert.equal((await send(port(), raw, signBody(raw + " ", SECRET))).status, 401, "body changed after signing")
    assert.equal((await send(port(), raw, signBody(raw, SECRET, Date.now() - 6 * 60_000))).status, 401, "replayed")
    assert.equal((await send(port(), raw, "garbage")).status, 401)
    assert.equal((await send(port(), raw, "t=1,v1=zz")).status, 401)
    assert.equal(emitted.filter((e) => e.name === "voted").length, 0)
})

test("with only a v1 secret, legacy Authorization deliveries are refused", async () => {
    const { port } = await start()
    const res = await request(port(), { headers: { "content-type": "application/json", authorization: SECRET }, body: JSON.stringify({ user: USER, bot: BOT, type: "upvote" }) })
    assert.equal(res.status, 401)
})

test("both formats work when auth and secret are both set", async () => {
    const { port, emitted } = await start({ auth: "legacy" })
    await send(port(), voteCreate())
    await request(port(), { headers: { "content-type": "application/json", authorization: "legacy" }, body: JSON.stringify({ user: "111111111111111111", bot: BOT, type: "upvote" }) })
    assert.equal(emitted.filter((e) => e.name === "voted").length, 2)
})

test("signed retries are collapsed by vote ID", async () => {
    const { port, emitted } = await start()
    await send(port(), voteCreate())
    await send(port(), voteCreate())
    assert.equal(emitted.filter((e) => e.name === "voted").length, 1)
})

test("webhook.test becomes a test vote; other event types are acknowledged and ignored", async () => {
    const { port, emitted } = await start()
    const t = { type: "webhook.test", data: { project: { type: "bot", platform_id: BOT }, user: { platform_id: USER } } }
    assert.equal((await send(port(), t)).status, 204)
    assert.equal(emitted.find((e) => e.name === "voted").x.type, "test")
    assert.equal((await send(port(), { type: "integration.delete", data: { connection_id: "1" } })).status, 204)
    assert.equal(emitted.filter((e) => e.name === "voted").length, 1)
})

test("invalid signed payloads are refused with 400", async () => {
    const { port } = await start()
    assert.equal((await send(port(), voteCreate({ weight: 0 }))).status, 400)
    assert.equal((await send(port(), voteCreate({ user: { platform_id: "x" } }))).status, 400)
    assert.equal((await send(port(), { type: "vote.create" })).status, 400)
})

test("checkSignature and normalizeSignedVote units", () => {
    const raw = Buffer.from("{}")
    const now = 1_700_000_000_000
    assert.equal(checkSignature(signBody(raw, "s", now), raw, "s", now), null)
    assert.match(checkSignature(signBody(raw, "s", now), raw, "s", now + 301_000), /window/)
    assert.equal(normalizeSignedVote({ type: "integration.create", data: {} }, now), null)
    const server = normalizeSignedVote({ ...voteCreate(), data: { ...voteCreate().data, project: { type: "server", platform_id: BOT } } }, now)
    assert.equal(server.guild, BOT)
})

test("an empty v1 secret is refused at start-up", () => {
    const { ReForgeTopGG } = require("..")
    assert.throws(() => new ReForgeTopGG({ webhook: { secret: "" } }), /"webhook.secret" is empty/)
})

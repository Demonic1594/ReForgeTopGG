"use strict"
const { test, after } = require("node:test")
const assert = require("node:assert/strict")
const { boot, request, vote, upvote, AUTH, USER, BOT } = require("./fixtures/harness")
const { safeEqual, normalizeLegacyVote, VOTE_COOLDOWN } = require("..")

const clients = []
after(async () => { for (const c of clients) await c.destroy() })
async function start(options) {
    const b = await boot(options)
    clients.push(b.client)
    return b
}

test("a valid vote is emitted once, normalized", async () => {
    const { port, emitted } = await start()
    const res = await vote(port(), upvote({ isWeekend: true, query: "?ref=abc&x=1" }))
    assert.equal(res.status, 204)
    const votes = emitted.filter((e) => e.name === "voted")
    assert.equal(votes.length, 1)
    const v = votes[0].x
    assert.equal(v.user, USER)
    assert.equal(v.bot, BOT)
    assert.equal(v.type, "upvote")
    assert.equal(v.weight, 2)
    assert.deepEqual(v.query, { ref: "abc", x: "1" })
    assert.equal(v.expiresAt - v.votedAt, VOTE_COOLDOWN)
})

test("a wrong or missing Authorization header is refused and emits nothing", async () => {
    const { port, emitted } = await start()
    assert.equal((await vote(port(), upvote(), { authorization: "nope" })).status, 401)
    assert.equal((await vote(port(), upvote(), { authorization: "" })).status, 401)
    const noAuth = await request(port(), { headers: { "content-type": "application/json" }, body: JSON.stringify(upvote()) })
    assert.equal(noAuth.status, 401)
    assert.ok(!noAuth.body.includes(AUTH), "the secret is never echoed")
    assert.equal(emitted.length, 0)
})

test("an empty auth secret is refused at start-up", () => {
    const { ReForgeTopGG } = require("..")
    assert.throws(() => new ReForgeTopGG({ auth: "" }), /"auth" is empty/)
    assert.throws(() => new ReForgeTopGG({ auth: "   " }), /"auth" is empty/)
})

test("non-JSON content types are refused (the original emitted an empty vote)", async () => {
    const { port, emitted } = await start()
    const res = await request(port(), { headers: { "content-type": "text/plain", authorization: AUTH }, body: "hello" })
    assert.equal(res.status, 415)
    assert.equal(emitted.length, 0)
})

test("bodies over the size limit are refused", async () => {
    const { port, emitted } = await start({ webhook: { maxBodySize: 2048 } })
    const res = await vote(port(), upvote({ query: "x=" + "a".repeat(4096) }))
    assert.equal(res.status, 413)
    assert.equal(emitted.length, 0)
})

test("malformed JSON and invalid payloads are refused with 400; invalid payloads raise an error event", async () => {
    const { port, emitted } = await start()
    assert.equal((await vote(port(), "{not json")).status, 400)
    for (const bad of [{ hello: 1 }, upvote({ user: "abc" }), upvote({ type: "downvote" }), upvote({ bot: undefined }), upvote({ isWeekend: "yes" }), [1, 2]]) {
        const res = await vote(port(), bad)
        assert.equal(res.status, 400, JSON.stringify(bad))
    }
    assert.equal(emitted.filter((e) => e.name === "voted").length, 0)
    assert.ok(emitted.filter((e) => e.name === "error").length >= 5)
})

test("only POST on the configured path is served", async () => {
    const { port } = await start({ webhook: { path: "/votes" } })
    assert.equal((await request(port(), { method: "GET", path: "/votes" })).status, 405)
    assert.equal((await vote(port(), upvote())).status, 404, "old default path is not served")
    const res = await request(port(), { path: "/votes", headers: { "content-type": "application/json", authorization: AUTH }, body: JSON.stringify(upvote()) })
    assert.equal(res.status, 204)
})

test("server votes (guild) are accepted", async () => {
    const { port, emitted } = await start()
    const res = await vote(port(), { user: USER, guild: BOT, type: "upvote", query: "" })
    assert.equal(res.status, 204)
    assert.equal(emitted[0].x.guild, BOT)
    assert.equal(emitted[0].x.bot, undefined)
})

test("safeEqual compares in constant time over hashes and handles length differences", () => {
    assert.equal(safeEqual("abc", "abc"), true)
    assert.equal(safeEqual("abc", "abcd"), false)
    assert.equal(safeEqual("", "abc"), false)
    assert.equal(safeEqual(undefined, "abc"), false)
})

test("normalizeLegacyVote rejects non-objects", () => {
    assert.throws(() => normalizeLegacyVote(null, 0))
    assert.throws(() => normalizeLegacyVote("x", 0))
})

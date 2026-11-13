"use strict"
const { test, after } = require("node:test")
const assert = require("node:assert/strict")
const { boot, vote, upvote, USER } = require("./fixtures/harness")
const { DedupeCache, dedupeKey, normalizeLegacyVote, ReForgeTopGG } = require("..")

const clients = []
after(async () => { for (const c of clients) await c.destroy() })
async function start(options) {
    const b = await boot(options)
    clients.push(b.client)
    return b
}
const voted = (emitted) => emitted.filter((e) => e.name === "voted").length

test("a retried delivery is answered 204 but emitted only once (the original emitted it twice)", async () => {
    const { port, emitted } = await start()
    for (let i = 0; i < 3; i++) assert.equal((await vote(port(), upvote())).status, 204)
    assert.equal(voted(emitted), 1)
})

test("concurrent identical deliveries are emitted once", async () => {
    const { port, emitted } = await start()
    const results = await Promise.all(Array.from({ length: 10 }, () => vote(port(), upvote())))
    assert.ok(results.every((r) => r.status === 204))
    assert.equal(voted(emitted), 1)
})

test("different users, targets and types are not collapsed", async () => {
    const { port, emitted } = await start()
    await vote(port(), upvote())
    await vote(port(), upvote({ user: "111111111111111111" }))
    await vote(port(), upvote({ type: "test" }))
    await vote(port(), { user: USER, guild: "222222222222222222", type: "upvote" })
    assert.equal(voted(emitted), 4)
})

test("dedupeWindow: 0 turns de-duplication off", async () => {
    const { port, emitted } = await start({ dedupeWindow: 0 })
    await vote(port(), upvote())
    await vote(port(), upvote())
    assert.equal(voted(emitted), 2)
})

test("dedupeWindow is validated", () => {
    assert.throws(() => new ReForgeTopGG({ dedupeWindow: 12 * 3_600_000 }), /dedupeWindow/)
    assert.throws(() => new ReForgeTopGG({ dedupeWindow: -1 }), /dedupeWindow/)
})

test("cache entries expire and the cache stays bounded", () => {
    let now = 0
    const c = new DedupeCache(3, () => now)
    c.add("a", 100)
    assert.equal(c.has("a"), true)
    now = 100
    assert.equal(c.has("a"), false, "expired")
    for (const k of ["b", "c", "d", "e"]) c.add(k, 1000)
    assert.equal(c.size, 3)
    assert.equal(c.has("b"), false, "oldest evicted")
    assert.equal(c.has("e"), true)
})

test("test votes are collapsed for at most a minute; upvotes for the window", async () => {
    const top = new ReForgeTopGG({ webhook: false })
    const seen = []
    top.emitter.on("voted", (v) => seen.push(v.type))
    let now = 1_000_000
    top.seen = new DedupeCache(10_000, () => now)
    const v = (type) => normalizeLegacyVote({ user: USER, bot: USER, type }, now)
    await top.receive(v("test"))
    await top.receive(v("upvote"))
    now += 61_000
    await top.receive(v("test"))
    await top.receive(v("upvote"))
    assert.deepEqual(seen, ["test", "upvote", "test"])
    assert.match(dedupeKey(v("upvote")), /^v0:/)
})

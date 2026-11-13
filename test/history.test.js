"use strict"
const { test, after } = require("node:test")
const assert = require("node:assert/strict")
const { boot, run, vote, upvote, USER, BOT } = require("./fixtures/harness")
const { applyVote, currentStreak, normalizeLegacyVote, MemoryVoteStore, VOTE_COOLDOWN } = require("..")

const H = 3_600_000
const clients = []
after(async () => { for (const c of clients) await c.destroy() })

const at = (t, extra = {}) => normalizeLegacyVote(upvote(extra), t)

test("applyVote counts votes, weekend points and streaks", () => {
    let r = applyVote(undefined, at(0), 12 * H)
    assert.equal(r.count, 1)
    assert.equal(r.streak, 1)
    r = applyVote(r, at(12 * H, { isWeekend: true }), 12 * H) // right when allowed
    assert.equal(r.count, 2)
    assert.equal(r.points, 3)
    assert.equal(r.streak, 2)
    r = applyVote(r, at(12 * H + VOTE_COOLDOWN + 12 * H), 12 * H) // exactly at the end of the grace
    assert.equal(r.streak, 3)
    r = applyVote(r, at(r.expiresAt + 12 * H + 1), 12 * H) // missed it
    assert.equal(r.streak, 1)
    assert.equal(r.count, 4)
    assert.equal(r.firstVoteAt, 0)
})

test("currentStreak drops to 0 once the streak can no longer continue", () => {
    const r = applyVote(undefined, at(0), 12 * H)
    assert.equal(currentStreak(r, VOTE_COOLDOWN + 12 * H, 12 * H), 1)
    assert.equal(currentStreak(r, VOTE_COOLDOWN + 12 * H + 1, 12 * H), 0)
    assert.equal(currentStreak(undefined, 0, 12 * H), 0)
})

test("MemoryVoteStore is bounded and returns copies", () => {
    const s = new MemoryVoteStore(2)
    for (const u of ["1", "2", "3"]) s.set({ ...applyVote(undefined, at(0), 0), user: u })
    assert.equal(s.size, 2)
    assert.equal(s.get("1"), undefined)
    const r = s.get("3")
    r.count = 99
    assert.equal(s.get("3").count, 1)
})

test("history functions read what the webhook recorded; test votes are not recorded", async () => {
    const b = await boot()
    clients.push(b.client)
    const c = b.client
    assert.equal(await run(c, `$voteCount[${USER}]|$voteStreak[${USER}]|$lastVoteTime[${USER}]|$votedWithin[1h;${USER}]`), "0|0||false")
    await vote(b.port(), upvote({ type: "test" }))
    assert.equal(await run(c, `$voteCount[${USER}]`), "0")
    const before = Date.now()
    await vote(b.port(), upvote({ isWeekend: true }))
    assert.equal(await run(c, `$voteCount[${USER}]|$votePoints[${USER}]|$voteStreak[${USER}]|$votedWithin[1h;${USER}]`), "1|2|1|true")
    const last = Number(await run(c, `$lastVoteTime[${USER}]`))
    assert.ok(last >= before && last <= Date.now())
    assert.equal(Number(await run(c, `$nextVoteTime[${USER}]`)), last + VOTE_COOLDOWN)
    assert.equal(await run(c, `$voteCount[abc]`), null, "bad user ID is an error")
})

test("history functions default to the voter in a vote event", async () => {
    const b = await boot({ webhook: false })
    clients.push(b.client)
    const v = normalizeLegacyVote(upvote(), Date.now())
    await b.top.receive(v)
    assert.equal(await run(b.client, "$voteCount|$voteWeight|$voteTimestamp", v), `1|1|${v.votedAt}`)
})

test("a store that fails makes the webhook answer 500 so Top.gg retries, and the retry is not dropped", async () => {
    let fail = true
    const store = new MemoryVoteStore()
    const flaky = { get: (u) => store.get(u), set: (r) => { if (fail) throw new Error("db down"); store.set(r) } }
    const b = await boot({ store: flaky })
    clients.push(b.client)
    assert.equal((await vote(b.port(), upvote())).status, 500)
    assert.equal(b.emitted.filter((e) => e.name === "voted").length, 0)
    assert.ok(b.emitted.some((e) => e.name === "error" && /db down/.test(e.x.message)))
    fail = false
    assert.equal((await vote(b.port(), upvote())).status, 204)
    assert.equal(b.emitted.filter((e) => e.name === "voted").length, 1)
    assert.equal(store.get(USER).count, 1)
})

test("store option is validated", () => {
    const { ReForgeTopGG } = require("..")
    assert.throws(() => new ReForgeTopGG({ store: "redis" }), /"store"/)
    assert.throws(() => new ReForgeTopGG({ streakGrace: -1 }), /streakGrace/)
})

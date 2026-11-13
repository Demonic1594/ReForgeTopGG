"use strict"
const { test, after } = require("node:test")
const assert = require("node:assert/strict")
const { boot, run, USER, BOT } = require("./fixtures/harness")
const { normalizeLegacyVote } = require("..")

let b
after(() => b?.client.destroy())

test("vote functions read the vote of the event", async () => {
    b = await boot({ webhook: false })
    const v = normalizeLegacyVote({ user: USER, bot: BOT, type: "test", isWeekend: true, query: "ref=abc" }, 1_000)
    assert.equal(await run(b.client, "$voteUserID|$voteBotID|$voteGuildID|$voteType|$voteIsWeekend", v), `${USER}|${BOT}||test|true`)
    assert.equal(await run(b.client, "$voteQuery[ref]", v), "abc")
    assert.equal(await run(b.client, "$voteQuery[missing]", v), "")
    assert.deepEqual(JSON.parse(await run(b.client, "$voteQuery", v)), { ref: "abc" })
})

test("vote and stats functions are empty outside their events", async () => {
    b ??= await boot({ webhook: false })
    const notAVote = { user: "someone else's extras" }
    assert.equal(await run(b.client, "$voteUserID|$voteQuery|$postedServerCount|$postStatsError", notAVote), "|||")
    assert.equal(await run(b.client, "$postStatsError", new Error("boom")), "boom")
    assert.equal(await run(b.client, "$postedServerCount|$postedShardCount", { serverCount: 5, shardCount: 2 }), "5|2")
})

"use strict"
const { test, after } = require("node:test")
const assert = require("node:assert/strict")
const { boot, run, USER } = require("./fixtures/harness")

const clients = []
after(async () => { for (const c of clients) await c.destroy() })

test("$sendTestVote goes through the real webhook and runs voted as a test vote", async () => {
    const b = await boot()
    clients.push(b.client)
    assert.equal(await run(b.client, `$sendTestVote[${USER};true;ref=abc]`), "204")
    const v = b.emitted.find((e) => e.name === "voted").x
    assert.equal(v.type, "test")
    assert.equal(v.isWeekend, true)
    assert.deepEqual(v.query, { ref: "abc" })
    assert.equal(await run(b.client, `$voteCount[${USER}]`), "0", "test votes are not stored")
})

test("$sendTestVote is signed when a v1 secret is set", async () => {
    const b = await boot({ auth: undefined, webhook: { secret: "whs_x" } })
    clients.push(b.client)
    assert.equal(await run(b.client, `$sendTestVote[${USER}]`), "204")
    assert.equal(b.emitted.find((e) => e.name === "voted").x.source, "v1")
})

test("$sendTestVote fails clearly when the webhook is not listening", async () => {
    const b = await boot({ webhook: false })
    clients.push(b.client)
    assert.equal(await run(b.client, `$sendTestVote[${USER}]`), null)
    assert.ok(b.logs.some((l) => l.text.includes("The vote webhook is not listening")))
})

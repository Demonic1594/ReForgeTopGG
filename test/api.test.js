"use strict"
const { test, after, beforeEach } = require("node:test")
const assert = require("node:assert/strict")
const { Api } = require("@top-gg/sdk")
const { boot, run, logs, USER } = require("./fixtures/harness")

let ctx
const original = Api.prototype._request
beforeEach(() => { Api.prototype._request = original })
after(async () => { Api.prototype._request = original; await ctx?.client.destroy() })

async function client() {
    ctx ??= await boot({ webhook: false })
    return ctx.client
}

test("$hasVoted returns Top.gg's answer", async () => {
    const c = await client()
    Api.prototype._request = async (_m, path, body) => (path === "/bots/check" && body.userId === USER ? { voted: 1 } : { voted: 0 })
    assert.equal(await run(c, `$hasVoted[${USER}]`), "true")
    assert.equal(await run(c, `$hasVoted[111111111111111111]`), "false")
})

test("$hasVoted fails loudly when the request fails, instead of looking like 'not voted'", async () => {
    const c = await client()
    Api.prototype._request = async () => { throw new Error("503 Service Unavailable") }
    logs.length = 0
    // The original returned "" here, so $if[$hasVoted[..]==false;..] took the "voted" branch.
    assert.equal(await run(c, `$if[$hasVoted[${USER}]==false;no;yes]`), null)
    assert.ok(logs.some((l) => l.text.includes("Top.gg API request failed: 503 Service Unavailable")))
    assert.equal(await run(c, `$try[$hasVoted[${USER}];fallback]`), "fallback")
})

test("$hasVoted refuses something that is not a user ID", async () => {
    const c = await client()
    logs.length = 0
    assert.equal(await run(c, `$hasVoted[abc]`), null)
    assert.ok(logs.some((l) => l.text.includes("is not a user ID")))
})

test("$totalVotes and $monthlyVotes report failures and return numbers on success", async () => {
    const c = await client()
    Api.prototype._request = async () => ({ points: 42, monthlyPoints: 7 })
    assert.equal(await run(c, "$totalVotes"), "42")
    assert.equal(await run(c, "$monthlyVotes"), "7")
    Api.prototype._request = async () => { throw new Error("401 Unauthorized") }
    assert.equal(await run(c, "$totalVotes"), null)
    assert.equal(await run(c, "$try[$monthlyVotes;n/a]"), "n/a")
})

test("API errors never contain the token", async () => {
    const c = await client()
    Api.prototype._request = async () => { throw new Error("bad token test-token rejected") }
    logs.length = 0
    await run(c, `$hasVoted[${USER}]`)
    const text = logs.map((l) => l.text).join("\n")
    assert.ok(text.includes("[token]"))
    assert.ok(!text.includes("test-token"))
})

test("without a token the API functions say so", async () => {
    const b = await boot({ token: undefined, webhook: false })
    logs.length = 0
    assert.equal(await run(b.client, `$hasVoted[${USER}]`), null)
    assert.ok(logs.some((l) => l.text.includes("no \"token\"")))
    await b.client.destroy()
})

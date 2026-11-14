"use strict"
const { test } = require("node:test")
const assert = require("node:assert/strict")
const http = require("http")
const { once } = require("events")
const { ForgeClient } = require("@tryforge/forgescript")
const { boot, vote, upvote } = require("./fixtures/harness")
const { ReForgeTopGG } = require("..")

test("constructing the extension opens no port; init does", async () => {
    const top = new ReForgeTopGG({ auth: "s", port: 0 })
    assert.equal(top.server, null)
    const client = new ForgeClient({ intents: ["Guilds"], events: [], prefixes: ["!"], extensions: [top] })
    assert.ok(top.server)
    await once(top.server, "listening")
    await client.destroy()
})

test("no auth means no webhook and no open port", async () => {
    const { top, client } = await boot({ auth: undefined })
    assert.equal(top.server, null)
    assert.equal(top.webhook, null)
    await client.destroy()
})

test("webhook: false never opens a port, even with auth", async () => {
    const { top, client } = await boot({ webhook: false })
    assert.equal(top.server, null)
    await client.destroy()
})

test("a port already in use raises an error event instead of crashing", async () => {
    const blocker = http.createServer().listen(0)
    await once(blocker, "listening")
    const taken = blocker.address().port
    const { top, emitted, client } = await boot({ port: taken }, { listen: false })
    await once(top.emitter, "error").catch(() => {})
    const err = emitted.find((e) => e.name === "error")
    assert.ok(err, "an error event was emitted")
    assert.match(err.x.message, new RegExp(`port ${taken} is already in use`))
    assert.equal(top.server, null)
    await client.destroy()
    blocker.close()
})

test("client.destroy() closes the webhook server and frees the port", async () => {
    const { top, client, port } = await boot()
    const p = port()
    assert.equal((await vote(p, upvote())).status, 204)
    await client.destroy()
    assert.equal(top.server, null)
    // The port can be bound again.
    const again = http.createServer().listen(p)
    await once(again, "listening")
    again.close()
})

test("listen: false opens no port and the listener can be mounted elsewhere", async () => {
    const { top, client, emitted } = await boot({ webhook: { listen: false } }, { listen: false })
    assert.equal(top.server, null)
    const own = http.createServer(top.webhookListener).listen(0)
    await once(own, "listening")
    assert.equal((await vote(own.address().port, upvote())).status, 204)
    assert.equal(emitted.filter((e) => e.name === "voted").length, 1)
    own.close()
    await client.destroy()
})

test("running alongside forge.topgg is refused with a clear error", () => {
    const fake = { name: "forge.topgg", validateAndInit() {} }
    assert.throws(
        () => new ForgeClient({ intents: ["Guilds"], events: [], prefixes: ["!"], extensions: [fake, new ReForgeTopGG({ auth: "s", port: 0 })] }),
        /cannot run alongside forge\.topgg/i,
    )
})

test("invalid options fail at start-up", () => {
    assert.throws(() => new ReForgeTopGG({ post: { interval: 60_000 }, token: "t" }), /at least 900000/)
    assert.throws(() => new ReForgeTopGG({ post: {} }), /needs your Top.gg "token"/)
    assert.throws(() => new ReForgeTopGG({ port: 70000 }), /"port"/)
    assert.throws(() => new ReForgeTopGG({ webhook: { path: "votes" } }), /must start with \//)
})

"use strict"
const { test } = require("node:test")
const assert = require("node:assert/strict")
const { Api } = require("@top-gg/sdk")
const { boot } = require("./fixtures/harness")

test("stats posting starts once on ready, reports posted and errors, and stops on destroy", async (t) => {
    const posts = []
    t.mock.method(Api.prototype, "postStats", async (stats) => { posts.push(stats); if (posts.length > 1) throw new Error("429 Too Many Requests"); return stats })
    const b = await boot({ webhook: false, post: { interval: 900_000, postOnStart: false } })
    b.client.ws.status = 0 // pretend to be connected
    b.client.emit("clientReady", b.client)
    b.client.emit("clientReady", b.client)
    const poster = b.top.poster
    assert.ok(poster, "poster started")
    b.client.emit("clientReady", b.client)
    assert.equal(b.top.poster, poster, "a repeated ready does not start a second poster")
    await poster.post()
    await poster.post()
    await new Promise((r) => setImmediate(r))
    assert.equal(b.emitted.filter((e) => e.name === "posted").length, 1)
    assert.match(b.emitted.find((e) => e.name === "error").x.message, /429/)
    await b.client.destroy()
    assert.equal(b.top.poster, null)
    assert.equal(poster.started, false)
})

test("listens to clientReady, not the deprecated ready event (discord.js 14.22+)", async (t) => {
    const { readyEventName } = require("..")
    assert.equal(readyEventName(), "clientReady")
    t.mock.method(Api.prototype, "postStats", async (stats) => stats)
    const b = await boot({ webhook: false, reminders: true, post: { interval: 900_000, postOnStart: false } })
    assert.equal(b.client.listenerCount("ready"), 0, "no listener on the deprecated name")
    b.client.ws.status = 0
    b.client.emit("clientReady", b.client)
    const poster = b.top.poster
    assert.ok(poster, "posting starts on clientReady")
    // destroyed before topgg-autoposter's own start ran: it must not start afterwards
    await b.client.destroy()
    await new Promise((r) => setImmediate(r))
    assert.equal(poster.started, false, "no interval left running after destroy")
    assert.ok(!poster.interval, "no interval timer")
})

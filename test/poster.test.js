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
    b.client.emit("ready", b.client)
    b.client.emit("ready", b.client)
    const poster = b.top.poster
    assert.ok(poster, "poster started")
    b.client.emit("ready", b.client)
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

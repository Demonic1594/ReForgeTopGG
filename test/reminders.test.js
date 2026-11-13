"use strict"
const { test, after, mock } = require("node:test")
const assert = require("node:assert/strict")
const { boot, run, upvote, USER } = require("./fixtures/harness")
const { normalizeLegacyVote, ReminderScheduler, MemoryVoteStore, applyVote } = require("..")

const clients = []
after(async () => { for (const c of clients) await c.destroy() })

test("ReminderScheduler fires once at the deadline and can be rescheduled", () => {
    mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 })
    try {
        const fired = []
        const s = new ReminderScheduler((u, t) => fired.push([u, t]))
        s.schedule("a", 1000)
        s.schedule("a", 2000)
        mock.timers.tick(1000)
        assert.deepEqual(fired, [])
        mock.timers.tick(1000)
        assert.deepEqual(fired, [["a", 2000]])
        s.schedule("b", 500)
        s.clear()
        mock.timers.tick(1000)
        assert.equal(fired.length, 1)
    } finally {
        mock.timers.reset()
    }
})

test("voteReminder fires when the user can vote again, once, with the last vote", async () => {
    const b = await boot({ webhook: false, reminders: true })
    clients.push(b.client)
    const reminders = []
    b.top.emitter.on("voteReminder", (v) => reminders.push(v))
    const now = Date.now()
    // A vote whose cooldown ends in 50 ms.
    const v = { ...normalizeLegacyVote(upvote({ isWeekend: true }), now), expiresAt: now + 50 }
    await b.top.receive(v)
    await new Promise((r) => setTimeout(r, 120))
    assert.equal(reminders.length, 1)
    assert.equal(reminders[0].user, USER)
    assert.equal(reminders[0].weight, 2)
    assert.equal(await run(b.client, "$voteUserID|$voteWeight", reminders[0]), `${USER}|2`)
    assert.equal((await b.top.getRecord(USER)).reminded, true)
})

test("a newer vote replaces the pending reminder", async () => {
    const b = await boot({ webhook: false, reminders: true, dedupeWindow: 0 })
    clients.push(b.client)
    const reminders = []
    b.top.emitter.on("voteReminder", (v) => reminders.push(v))
    const now = Date.now()
    await b.top.receive({ ...normalizeLegacyVote(upvote(), now), expiresAt: now + 40 })
    await b.top.receive({ ...normalizeLegacyVote(upvote(), now + 1), expiresAt: now + 150 })
    await new Promise((r) => setTimeout(r, 80))
    assert.equal(reminders.length, 0)
    await new Promise((r) => setTimeout(r, 120))
    assert.equal(reminders.length, 1)
    assert.equal(reminders[0].expiresAt, now + 150)
})

test("reminders are off by default", async () => {
    const b = await boot({ webhook: false })
    clients.push(b.client)
    const reminders = []
    b.top.emitter.on("voteReminder", (v) => reminders.push(v))
    const now = Date.now()
    await b.top.receive({ ...normalizeLegacyVote(upvote(), now), expiresAt: now + 10 })
    await new Promise((r) => setTimeout(r, 50))
    assert.equal(reminders.length, 0)
})

test("pending reminders of a persistent store are rescheduled on ready", async () => {
    const store = new MemoryVoteStore()
    const now = Date.now()
    store.set({ ...applyVote(undefined, normalizeLegacyVote(upvote(), now), 0), expiresAt: now + 30 })
    const b = await boot({ webhook: false, reminders: true, store })
    clients.push(b.client)
    const reminders = []
    b.top.emitter.on("voteReminder", (v) => reminders.push(v))
    b.client.emit("ready", b.client)
    await new Promise((r) => setTimeout(r, 100))
    assert.equal(reminders.length, 1)
})

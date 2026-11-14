"use strict"
// store: "forgedb" with ReForgeDB (reforge.db) instead of ForgeDB. Its own file,
// so its own process: ReForgeDB and ForgeDB keep one configuration per process.
const { test, after } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { ForgeClient } = require("@tryforge/forgescript")
const { ReForgeDB } = require("@tryforge/reforge.db")
const { ReForgeTopGG, normalizeLegacyVote } = require("..")
const { run, upvote, logs, USER } = require("./fixtures/harness")

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rtg-rdb-"))
let client
after(async () => {
    await client?.destroy()
    fs.rmSync(dir, { recursive: true, force: true })
})

test("store: forgedb keeps history in a ReForgeDB user variable, and no reminder is shown", async () => {
    logs.length = 0
    const db = new ReForgeDB({ type: "better-sqlite3", folder: dir, logLevel: "warn", cooldownSweepInterval: 0 })
    const top = new ReForgeTopGG({ store: "forgedb", webhook: false, reminders: true, events: ["voteReminder"] })
    client = new ForgeClient({ intents: ["Guilds"], events: [], prefixes: ["!"], extensions: [db, top] })
    await ReForgeDB.ready()
    await top.receive(normalizeLegacyVote(upvote(), Date.now()))
    assert.equal(await run(client, `$voteCount[${USER}]|$voteStreak[${USER}]`), "1|1")
    const raw = await run(client, `$getUserVar[topggVote;${USER}]`)
    assert.equal(JSON.parse(raw).count, 1)
    assert.equal((await top.store.pending()).length, 1)
    assert.ok(fs.existsSync(path.join(dir, "reforge.db")), "stored in ReForgeDB's file")
    assert.deepEqual(logs.filter((l) => l.text.includes("Consider switching to ReForgeDB")), [])
})

test("the store reads and writes through client.db, ReForgeDB's DataBase", async () => {
    const top = client.getExtension(ReForgeTopGG, true)
    const realGet = client.db.get
    let calls = 0
    client.db.get = async (...a) => (calls++, realGet.apply(client.db, a))
    try {
        const vote = { ...normalizeLegacyVote(upvote(), Date.now() + 1), user: "123456789012345679" }
        assert.equal(await top.receive(vote), true)
        assert.ok(calls >= 1, "read through client.db")
    } finally {
        client.db.get = realGet
    }
})

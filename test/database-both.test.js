"use strict"
// With ReForgeDB and ForgeDB both loaded, vote history goes to ReForgeDB,
// even when ForgeDB loaded last (client.db is then ForgeDB's).
const { test, after } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { once } = require("events")
const { ForgeClient } = require("@tryforge/forgescript")
const { ReForgeDB, DataBase: ReForgeDataBase } = require("@tryforge/reforge.db")
const { ForgeDB } = require("@tryforge/forge.db")
const { ReForgeTopGG, normalizeLegacyVote } = require("..")
const { upvote, USER, logs } = require("./fixtures/harness")

const a = fs.mkdtempSync(path.join(os.tmpdir(), "rtg-a-"))
const b = fs.mkdtempSync(path.join(os.tmpdir(), "rtg-b-"))
let client
after(async () => {
    await client?.destroy()
    for (const d of [a, b]) fs.rmSync(d, { recursive: true, force: true })
})

test("both loaded: the store uses ReForgeDB and warns to keep only one", async () => {
    const reforge = new ReForgeDB({ type: "better-sqlite3", folder: a, logLevel: "error" })
    const forge = new ForgeDB({ type: "better-sqlite3", folder: b })
    const top = new ReForgeTopGG({ store: "forgedb", webhook: false })
    client = new ForgeClient({ intents: ["Guilds"], events: [], prefixes: ["!"], extensions: [reforge, top, forge] })
    assert.notEqual(client.db, ReForgeDataBase, "ForgeDB loaded last and owns client.db")
    await Promise.all([once(reforge.emitter, "connect"), once(forge.emitter, "connect")])
    await top.receive(normalizeLegacyVote(upvote(), Date.now()))
    const row = await ReForgeDataBase.get({ type: "user", name: "topggVote", id: USER })
    assert.equal(JSON.parse(row.value).count, 1, "stored in ReForgeDB")
    assert.equal(await client.db.get({ type: "user", name: "topggVote", id: USER }), null, "not in ForgeDB")
    assert.ok(logs.some((l) => /Both ReForgeDB and ForgeDB are loaded/.test(l.text)))
    assert.deepEqual(logs.filter((l) => l.text.includes("Consider switching to ReForgeDB")), [], "ReForgeDB is loaded: nothing to switch to")
})

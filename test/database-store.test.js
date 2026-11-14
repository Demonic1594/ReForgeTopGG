"use strict"
// The database store without a real database: names, errors, resolution.
const { test } = require("node:test")
const assert = require("node:assert/strict")
const { ForgeClient } = require("@tryforge/forgescript")
const lib = require("..")
require("./fixtures/harness") // collects logs instead of printing them

const { ReForgeTopGG, DatabaseVoteStore, ForgeDBVoteStore, resolveDataBase, DATABASE_EXTENSIONS } = lib
const rec = { user: "1", target: "2", targetIsGuild: false, count: 1, points: 1, streak: 1, firstVoteAt: 0, lastVoteAt: 0, expiresAt: Date.now() + 1000, lastWeight: 1, reminded: false }
const fakeDB = (extra = {}) => ({ get: async () => ({ value: JSON.stringify(rec) }), set: async () => {}, find: async () => [{ value: JSON.stringify(rec) }], ...extra })

test("\"reforgedb\" and \"forgedb\" both create the database store; ForgeDBVoteStore is the old name", () => {
    for (const store of ["reforgedb", "forgedb"]) assert.ok(new ReForgeTopGG({ store, webhook: false }).store instanceof DatabaseVoteStore, store)
    assert.equal(ForgeDBVoteStore, DatabaseVoteStore)
    assert.deepEqual([...DATABASE_EXTENSIONS], ["reforge.db", "forge.db"])
})

test("an unknown store name is refused and the message lists the valid ones", () => {
    assert.throws(() => new ReForgeTopGG({ store: "reforge", webhook: false }), /"store" must be "memory", "reforgedb" \(or "forgedb"\)/)
})

for (const store of ["reforgedb", "forgedb"]) {
    test(`store "${store}" without a database extension: the client refuses to start, naming both`, () => {
        assert.throws(
            () => new ForgeClient({ intents: ["Guilds"], events: [], prefixes: ["!"], extensions: [new ReForgeTopGG({ store, webhook: false })] }),
            (e) => /needs a database extension/.test(e.message) && /ReForgeDB\(\)/.test(e.message) && /ForgeDB\(\)/.test(e.message),
        )
    })
}

test("resolveDataBase uses client.db of the loaded extension, and explains a missing one", () => {
    const db = fakeDB()
    assert.equal(resolveDataBase({ options: { extensions: [{ name: "forge.db" }] }, db }).db, db)
    assert.equal(resolveDataBase({ options: { extensions: [{ name: "reforge.db" }] }, db }).label, "ReForgeDB")
    assert.throws(() => resolveDataBase({ options: { extensions: [] } }), /No database extension is loaded/)
    assert.throws(() => resolveDataBase({ options: { extensions: [{ name: "forge.db" }] } }), /ForgeDB is in your extensions but did not set up its database \(client\.db is missing\)/)
})

test("the store waits with ReForgeDB's ready() and reports why it never connected", async () => {
    let waited
    const ok = new DatabaseVoteStore("v", () => fakeDB({ ready: async (ms) => { waited = ms } }))
    assert.equal((await ok.get("1")).count, 1)
    assert.equal(waited, 3000, "votes wait at most 3 s")
    await ok.pending()
    assert.equal(waited, 60000, "restoring reminders waits up to 60 s")

    const down = new DatabaseVoteStore("v", () => fakeDB({ ready: async () => { throw new Error("ECONNREFUSED") } }))
    await assert.rejects(down.get("1"), /is not connected yet: ECONNREFUSED/)
})

test("an attached store finds the database extension when first used, not when attached", async () => {
    const store = new DatabaseVoteStore()
    const client = { options: { extensions: [{ name: "reforge.db" }] } }
    store.attach(client)
    // The extension loads after ReForgeTopGG and sets client.db later.
    client.db = fakeDB({ ready: async () => {} })
    assert.equal((await store.get("1")).user, "1")
})

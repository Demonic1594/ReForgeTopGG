"use strict"
// The database store against a real database extension. Each test file runs
// in its own process, because ReForgeDB and ForgeDB keep their connection in
// module state: test/reforgedb.test.js and test/forgedb.test.js call this.
const { test, after } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { once } = require("events")
const { ForgeClient } = require("@tryforge/forgescript")
const { ReForgeTopGG, DatabaseVoteStore, normalizeLegacyVote } = require("../..")
const { run, upvote, USER, logs } = require("./harness")

const EXTENSIONS = {
    "reforge.db": { label: "ReForgeDB", make: (folder) => new (require("@tryforge/reforge.db").ReForgeDB)({ type: "better-sqlite3", folder, logLevel: "warn" }) },
    "forge.db": { label: "ForgeDB", make: (folder) => new (require("@tryforge/forge.db").ForgeDB)({ type: "better-sqlite3", folder }) },
}

module.exports = function databaseStoreSuite(name) {
    const { label, make } = EXTENSIONS[name]
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rtg-"))
    let client, top, db
    after(async () => {
        await client?.destroy()
        fs.rmSync(dir, { recursive: true, force: true })
    })

    test(`${label}: listed after ReForgeTopGG, the store keeps history in a user variable`, async () => {
        db = make(dir)
        top = new ReForgeTopGG({ store: "reforgedb", webhook: false, logLevel: "debug", dedupeWindow: 0 })
        // The database extension comes last: the store looks it up when first used.
        client = new ForgeClient({ intents: ["Guilds"], events: [], prefixes: ["!"], extensions: [top, db] })
        assert.ok(top.store instanceof DatabaseVoteStore)
        await once(db.emitter, "connect")
        await top.receive(normalizeLegacyVote(upvote(), Date.now()))
        assert.equal(await run(client, `$voteCount[${USER}]|$voteStreak[${USER}]`), "1|1")
        const raw = await run(client, `$getUserVar[topggVote;${USER}]`)
        assert.equal(JSON.parse(raw).count, 1)
        assert.equal((await top.store.pending()).length, 1)
        assert.ok(logs.some((l) => l.text.includes(`vote history is kept in the ${label} user variable "topggVote"`)), "says which database it uses")
        assert.ok(!logs.some((l) => /Both .* are loaded/.test(l.text)))
    })

    test(`${label}: a second vote continues the record`, async () => {
        await top.receive(normalizeLegacyVote(upvote(), Date.now()))
        assert.equal(await run(client, `$voteCount[${USER}]`), "2")
        assert.equal(JSON.parse(await run(client, `$getUserVar[topggVote;${USER}]`)).count, 2)
    })
}

"use strict"
const { test, after } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { once } = require("events")
const { ForgeClient } = require("@tryforge/forgescript")
const { ForgeDB } = require("@tryforge/forge.db")
const { ReForgeTopGG, normalizeLegacyVote, remindToSwitch } = require("..")
const { run, upvote, logs, USER } = require("./fixtures/harness")

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rtg-"))
let client
after(async () => { await client?.destroy(); fs.rmSync(dir, { recursive: true, force: true }) })

test("store: forgedb needs ReForgeDB or ForgeDB, and the error names both", () => {
    assert.throws(
        () => new ForgeClient({ intents: ["Guilds"], events: [], prefixes: ["!"], extensions: [new ReForgeTopGG({ store: "forgedb", webhook: false })] }),
        /^Error: \[ReForgeTopGG\] Store "forgedb" needs a database extension: add new ReForgeDB\(\).*or new ForgeDB\(\)/,
    )
})

test("store: forgedb keeps history in a ForgeDB user variable", async () => {
    const db = new ForgeDB({ type: "better-sqlite3", folder: dir })
    const top = new ReForgeTopGG({ store: "forgedb", webhook: false })
    client = new ForgeClient({ intents: ["Guilds"], events: [], prefixes: ["!"], extensions: [db, top] })
    await once(db.emitter, "connect")
    await top.receive(normalizeLegacyVote(upvote(), Date.now()))
    assert.equal(await run(client, `$voteCount[${USER}]|$voteStreak[${USER}]`), "1|1")
    const raw = await run(client, `$getUserVar[topggVote;${USER}]`)
    assert.equal(JSON.parse(raw).count, 1)
    const pending = await top.store.pending()
    assert.equal(pending.length, 1)
})

test("with ForgeDB, the reminder to switch to ReForgeDB is shown once per process", () => {
    // The client above loaded ForgeDB: the reminder was shown when it started.
    const shown = logs.filter((l) => l.text.includes("Consider switching to ReForgeDB"))
    assert.equal(shown.length, 1)
    assert.match(shown[0].text, /^\[ReForgeTopGG\] .*existing data.*fewer complications, better compatibility and a better experience.*#switching-from-forgedb/)
    assert.equal(remindToSwitch(), false, "another ReForge extension asking again does not show it twice")
})

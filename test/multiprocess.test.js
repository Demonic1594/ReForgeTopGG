"use strict"
// 3.3.0: with several bot processes on one database (sharding), each restores pending reminders after a
// restart. Before, every process sent each one (2 processes: 2 DMs). Now:
//  - ReForgeDB: each reminder is claimed with a conditional write, so exactly one process sends it;
//  - ForgeDB (no conditional write): only the process with shard 0 sends restored reminders.
// Real processes on one SQLite file. Both tests fail on 3.2.0.
const { test } = require("node:test")
const assert = require("node:assert/strict")
const { spawn } = require("child_process")
const fs = require("fs")
const os = require("os")
const path = require("path")

const SCRIPT = path.join(__dirname, "fixtures", "reminderProcess.js")
const USER = "333333333333333333"

function proc(args) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [SCRIPT, ...args], { stdio: ["ignore", "pipe", "pipe"] })
        let out = ""
        child.stdout.on("data", (d) => (out += d))
        child.stderr.on("data", (d) => (out += d))
        child.on("exit", (code) => resolve({ code, out }))
    })
}

async function sentBy(ext, shards) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "topgg-mp-"))
    const seed = await proc([ext, "seed", dir, USER])
    assert.match(seed.out, /SEEDED/, seed.out)
    const runs = await Promise.all(shards.map((s) => proc([ext, "run", dir, USER, ...(s === undefined ? [] : [String(s), String(shards.length)])])))
    return runs.flatMap((r) => [...r.out.matchAll(/SENT (\S+)/g)].map((m) => m[1]))
}

test("ReForgeDB: 4 processes restore the same reminder, exactly one sends it", { timeout: 60_000 }, async () => {
    const sent = await sentBy("reforge.db", [0, 1, 2, 3])
    assert.equal(sent.length, 1, `sent by ${JSON.stringify(sent)}`)
})

test("ForgeDB: only the process with shard 0 sends a restored reminder", { timeout: 60_000 }, async () => {
    const sent = await sentBy("forge.db", [0, 1])
    assert.deepEqual(sent, ["0"])
})

test("one process, no sharding: the reminder is still sent (ReForgeDB and ForgeDB)", { timeout: 60_000 }, async () => {
    assert.equal((await sentBy("reforge.db", [undefined])).length, 1)
    assert.equal((await sentBy("forge.db", [undefined])).length, 1)
})

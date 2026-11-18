"use strict"
// One bot process for test/multiprocess.test.js (never logged in). Usage:
//   node reminderProcess.js <reforge.db|forge.db> <seed|run> <folder> <user> [shard id] [shard count]
// seed: stores a vote whose reminder comes due in 2 s, then exits.
// run:  restores reminders as after a restart and prints "SENT <shard>" for each voteReminder, for 6 s.
const path = require("path")
const [ext, role, dir, user, shardId, shardCount] = process.argv.slice(2)
process.chdir(dir)
const { ForgeClient } = require("@tryforge/forgescript")
const lib = require(path.join(__dirname, "..", ".."))

const database =
    ext === "reforge.db"
        ? new (require("@tryforge/reforge.db").ReForgeDB)({ type: "better-sqlite3", logLevel: "silent", cooldownSweepInterval: 0 })
        : new (require("@tryforge/forge.db").ForgeDB)({ type: "better-sqlite3" })
const topgg = new lib.ReForgeTopGG({ webhook: false, reminders: true, store: "reforgedb", events: ["voteReminder"], logLevel: "silent" })
const client = new ForgeClient({ intents: ["Guilds"], events: [], extensions: [database, topgg] })
if (shardId !== undefined) Object.defineProperty(client, "shard", { value: { ids: [Number(shardId)], count: Number(shardCount) } })
topgg.emitter.on("voteReminder", () => console.log(`SENT ${shardId ?? "-"}`))

;(async () => {
    // Wait for the database: the store waits too, but seeding must not race the connection.
    for (let i = 0; i < 100 && !(await topgg.store.get(user).then(() => true, () => false)); i++) await new Promise((r) => setTimeout(r, 50))
    if (role === "seed") {
        const now = Date.now()
        const vote = lib.normalizeLegacyVote({ user, bot: "1".repeat(18), type: "upvote", isWeekend: false }, now - 12 * 3600e3 + 2000)
        await topgg.store.set(lib.applyVote(undefined, vote, topgg.streakGrace))
        console.log("SEEDED")
        process.exit(0)
    }
    client.ws.status = 0
    client.emit(lib.readyEventName(), client)
    setTimeout(() => process.exit(0), 6000)
})()

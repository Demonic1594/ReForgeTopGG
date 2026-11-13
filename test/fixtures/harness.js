"use strict"
/*
 * Boots a real ForgeClient (never logs in) with ReForgeTopGG on a random
 * port, and runs ForgeScript code through the real interpreter. Network
 * calls to Top.gg are replaced by stubbing the API client per test.
 */
const http = require("http")
const { once } = require("events")
const { ForgeClient, Compiler, Interpreter, Logger } = require("@tryforge/forgescript")
const { ReForgeTopGG } = require("../..")

// Collect ForgeScript error logs instead of printing them.
const logs = []
for (const level of ["error", "warn", "info"]) {
    Logger[level] = (...args) => logs.push({ level, text: args.map(String).join(" ") })
}

const AUTH = "test-secret-123"
const USER = "123456789012345678"
const BOT = "987654321098765432"

async function boot(options = {}, { listen = true } = {}) {
    const top = new ReForgeTopGG({ token: "test-token", auth: AUTH, port: 0, ...options })
    const emitted = []
    for (const name of ["voted", "error", "posted"]) top.emitter.on(name, (x) => emitted.push({ name, x }))
    const client = new ForgeClient({ intents: ["Guilds"], events: [], prefixes: ["!"], extensions: [top] })
    client.user = { id: BOT }
    if (listen && top.server && !top.server.listening) await Promise.race([once(top.server, "listening"), once(top.emitter, "error")])
    const port = () => top.server.address().port
    return { client, top, emitted, port, logs }
}

/** Runs ForgeScript code; returns the output, or null when it failed. */
async function run(client, code, extras) {
    return Interpreter.run({ obj: {}, client, command: null, data: Compiler.compile(code), doNotSend: true, redirectErrorsToConsole: true, extras })
}

function request(port, { method = "POST", path = "/dblwebhook", headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
            let data = ""
            res.on("data", (c) => (data += c))
            res.on("end", () => resolve({ status: res.statusCode, body: data, headers: res.headers }))
        })
        req.on("error", reject)
        req.end(body)
    })
}

function vote(port, payload, headers = {}) {
    return request(port, {
        headers: { "content-type": "application/json", authorization: AUTH, ...headers },
        body: typeof payload === "string" ? payload : JSON.stringify(payload),
    })
}

const upvote = (extra = {}) => ({ user: USER, bot: BOT, type: "upvote", isWeekend: false, query: "", ...extra })

module.exports = { boot, run, request, vote, upvote, logs, AUTH, USER, BOT }

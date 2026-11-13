"use strict"
/*
 * Seeded fuzzer for the vote webhook. Thousands of requests mixing valid
 * legacy and signed votes, retries, forged secrets, mutated signatures,
 * broken bodies, wrong types, odd headers, methods and paths, sent in bursts.
 * Invariants: every request gets an answer from the expected set, nothing
 * unauthenticated is ever emitted, each vote is emitted once, the history
 * matches exactly what was accepted, and the server still works at the end.
 * Replay a run with FUZZ_SEED=<n> npm test.
 */
const { test, after } = require("node:test")
const assert = require("node:assert/strict")
const { boot, request, AUTH } = require("./fixtures/harness")
const lib = require("..")

const SEED = Number(process.env.FUZZ_SEED ?? 20261113)
const ROUNDS = Number(process.env.FUZZ_ROUNDS ?? 3000)
const SECRET = "whs_fuzz_secret"
const BOTID = "987654321098765432"
const ALLOWED = new Set([204, 400, 401, 404, 405, 413, 415])

function rng(seed) {
    let a = seed >>> 0
    return () => {
        a = (a + 0x6d2b79f5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

let b
after(() => b?.client.destroy())

test(`fuzz the webhook (seed ${SEED}, ${ROUNDS} requests)`, async () => {
    const r = rng(SEED)
    const pick = (xs) => xs[Math.floor(r() * xs.length)]
    const users = Array.from({ length: 12 }, (_, i) => String(300000000000000000n + BigInt(i)))
    b = await boot({ auth: AUTH, webhook: { secret: SECRET }, dedupeWindow: 3_600_000 })
    const port = b.port()
    const expected = new Map() // dedupe key -> user, for votes that must be emitted once
    const junk = () => pick(["", "{", "null", "[]", "1", "\"x\"", "{\"user\":1}", "\u0000\u0001", "﻿{}", "{".repeat(500), JSON.stringify({ a: "x".repeat(20000) })])
    const mutate = (s, ascii = false) => {
        const i = Math.floor(r() * Math.max(1, s.length))
        const ch = ascii ? String.fromCharCode(33 + Math.floor(r() * 94)) : String.fromCharCode(Math.floor(r() * 256))
        return pick([s.slice(0, i), s + pick(["}", ",", "x"]), s.slice(0, i) + ch + s.slice(i + 1)])
    }

    for (let round = 0; round < ROUNDS / 20; round++) {
        const batch = []
        for (let k = 0; k < 20; k++) {
            const user = pick(users)
            const kind = pick(["legacy", "legacy", "signed", "signed", "retry", "forged", "badsig", "junk", "mutated", "badtype", "method", "path", "ctype", "wrongtypes"])
            const legacy = { user, bot: BOTID, type: pick(["upvote", "upvote", "test"]), isWeekend: r() < 0.3, query: pick(["", "ref=a", "a=1&b=2", "__proto__=x"]) }
            const voteId = `${user.slice(-2)}${Math.floor(r() * 4)}` // a vote ID belongs to one vote of one user
            const signedBody = { type: pick(["vote.create", "vote.create", "webhook.test", "integration.delete"]), data: { id: voteId, weight: pick([1, 2]), created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 43200000).toISOString(), project: { type: "bot", platform_id: BOTID }, user: { platform_id: user }, query: { ref: "f" } } }
            let headers = { "content-type": "application/json" }, body, method = "POST", path = "/dblwebhook", valid = null
            if (kind === "legacy" || kind === "retry") {
                body = JSON.stringify(legacy); headers.authorization = AUTH
                valid = legacy.type === "upvote" ? `v0:${BOTID}:${user}:upvote` : null
            } else if (kind === "signed") {
                body = JSON.stringify(signedBody); headers["x-topgg-signature"] = lib.signBody(body, SECRET)
                valid = signedBody.type === "vote.create" ? `id:${voteId}` : null
                if (valid && !expected.has(valid)) expected.set(valid, user) // the first delivery of an ID wins
                valid = valid ? "signed" : null
            } else if (kind === "forged") {
                // (leading/trailing whitespace is not here: HTTP strips it from header values, RFC 9110)
                body = JSON.stringify(legacy); headers.authorization = pick(["", "x", AUTH.toUpperCase(), AUTH.slice(1), AUTH + "x", "Bearer " + AUTH, AUTH + AUTH])
            } else if (kind === "badsig") {
                body = JSON.stringify(signedBody)
                headers["x-topgg-signature"] = pick([lib.signBody(body, "whs_other"), lib.signBody(body + " ", SECRET), lib.signBody(body, SECRET, Date.now() - 400000), "t=1", "v1=00", "garbage", mutate(lib.signBody(body, SECRET), true)])
            } else if (kind === "junk") {
                body = junk(); headers.authorization = AUTH
            } else if (kind === "mutated") {
                body = mutate(JSON.stringify(legacy)); headers.authorization = AUTH
            } else if (kind === "badtype") {
                body = JSON.stringify({ ...legacy, [pick(["user", "bot", "type", "isWeekend", "query"])]: pick([123, null, true, [], {}, "", "abc", "-1"]) }); headers.authorization = AUTH
            } else if (kind === "method") {
                method = pick(["GET", "PUT", "DELETE", "PATCH", "OPTIONS"]); headers.authorization = AUTH; body = JSON.stringify(legacy)
            } else if (kind === "path") {
                path = pick(["/", "/dblwebhook/", "/DBLWEBHOOK", "/dblwebhook/../x", "/%2e%2e", "//dblwebhook"]); headers.authorization = AUTH; body = JSON.stringify(legacy)
            } else if (kind === "ctype") {
                headers["content-type"] = pick(["text/plain", "application/x-www-form-urlencoded", "", "application/jsonp", "multipart/form-data; boundary=x"])
                headers.authorization = AUTH; body = JSON.stringify(legacy)
            } else {
                body = JSON.stringify({ ...legacy, user: pick([user + "0".repeat(10), " " + user, user.slice(1)]) }); headers.authorization = AUTH
            }
            if (valid && kind !== "signed" && !expected.has(valid)) expected.set(valid, user)
            // any other authorised legacy POST whose body is a valid upvote is a real vote too
            // (a mutated digit is another valid user ID): judge it like the server must
            if (!valid && headers.authorization === AUTH && method === "POST" && path === "/dblwebhook" && headers["content-type"] === "application/json" && Buffer.byteLength(body) <= 16384) {
                try {
                    const v = lib.normalizeLegacyVote(JSON.parse(body.replace(/^\uFEFF/, "")), 0)
                    if (v.type === "upvote" && !expected.has(lib.dedupeKey(v))) expected.set(lib.dedupeKey(v), v.user)
                } catch { /* not a vote: must be refused with 400 */ }
            }
            if (headers["content-type"] === "") delete headers["content-type"]
            const genuine = kind === "badsig" ? lib.signBody(body, SECRET).split("v1=")[1] : null
            const ifAccepted = kind === "badsig" && signedBody.type === "vote.create" ? [`id:${voteId}`, user] : null
            batch.push(request(port, { method, path, headers, body }).then((res) => ({ kind, res, sent: headers["x-topgg-signature"] ?? headers.authorization, genuine, ifAccepted })))
            if (kind === "retry") batch.push(request(port, { method, path, headers, body }).then((res) => ({ kind, res })))
        }
        for (const { kind, res, sent, genuine, ifAccepted } of await Promise.all(batch)) {
            if (ifAccepted && res.status === 204 && !expected.has(ifAccepted[0])) expected.set(...ifAccepted)
            assert.ok(ALLOWED.has(res.status), `${kind}: unexpected HTTP ${res.status} ${res.body}`)
            if (kind === "forged") assert.equal(res.status, 401, `forged must be refused: ${sent}`)
            // a mutated signature may only pass if it still carries the genuine HMAC (e.g. a trailing comma)
            if (kind === "badsig" && res.status !== 401) assert.ok(sent.toLowerCase().includes(genuine), `a signature without the genuine HMAC passed: ${sent}`)
            if (["legacy", "retry", "signed"].includes(kind)) assert.equal(res.status, 204, `${kind}: ${res.body}`)
            assert.ok(!res.body.includes(AUTH) && !res.body.includes(SECRET), "a secret was echoed")
        }
    }

    const upvotes = b.emitted.filter((e) => e.name === "voted" && e.x.type === "upvote")
    const keys = upvotes.map((e) => lib.dedupeKey(e.x))
    assert.equal(new Set(keys).size, keys.length, "a vote was emitted twice")
    const extra = keys.filter((k) => !expected.has(k)), missing = [...expected.keys()].filter((k) => !keys.includes(k))
    assert.deepEqual({ extra, missing }, { extra: [], missing: [] }, "emitted votes differ from the accepted ones: " + JSON.stringify(upvotes.filter((e) => extra.includes(lib.dedupeKey(e.x))).map((e) => e.x)))
    for (const e of upvotes) assert.equal(e.x.user, expected.get(lib.dedupeKey(e.x)))
    // the history counts exactly what was accepted, per user
    const perUser = {}
    for (const u of expected.values()) perUser[u] = (perUser[u] ?? 0) + 1
    for (const [u, n] of Object.entries(perUser)) {
        const rec = await b.top.getRecord(u)
        assert.equal(rec.count, n, `history count of ${u}`)
        assert.ok(rec.points >= rec.count && rec.points <= 2 * rec.count && rec.streak >= 1)
    }
    // still works
    const last = JSON.stringify({ user: "399999999999999999", bot: BOTID, type: "upvote" })
    assert.equal((await request(port, { headers: { "content-type": "application/json", authorization: AUTH }, body: last })).status, 204)
})

test(`fuzz vote history against a reference model (seed ${SEED})`, () => {
    const r = rng(SEED + 1)
    const H = 3_600_000
    for (let run = 0; run < 300; run++) {
        const grace = Math.floor(r() * 24) * H
        let record, t = Math.floor(r() * 1e12), count = 0, points = 0, streak = 0, prevExpiry = null
        for (let i = 0; i < 40; i++) {
            t += Math.floor(r() * 60 * H) + 12 * H // a user can vote every 12 hours at the earliest
            const weekend = r() < 0.3
            record = lib.applyVote(record, lib.normalizeLegacyVote({ user: "300000000000000000", bot: BOTID, type: "upvote", isWeekend: weekend }, t), grace)
            count++
            points += weekend ? 2 : 1
            streak = prevExpiry !== null && t <= prevExpiry + grace ? streak + 1 : 1
            prevExpiry = t + 12 * H
            assert.deepEqual([record.count, record.points, record.streak, record.lastVoteAt, record.expiresAt], [count, points, streak, t, prevExpiry])
            const later = t + Math.floor(r() * 48 * H)
            assert.equal(lib.currentStreak(record, later, grace), later <= prevExpiry + grace ? streak : 0)
        }
    }
})

test(`fuzz every function with hostile arguments (seed ${SEED})`, async () => {
    const { run, logs } = require("./fixtures/harness")
    const { Api } = require("@top-gg/sdk")
    const real = Api.prototype._request
    Api.prototype._request = async () => { throw new Error("503 Service Unavailable") }
    try {
        const fns = require("../metadata/functions.json")
        const r = rng(SEED + 2)
        const pick = (xs) => xs[Math.floor(r() * xs.length)]
        const hostile = ["", " ", "\;", "\\]", "<@>", "<@!123>", "123", "1".repeat(30), "-1", "1e309", "NaN", "Infinity", "__proto__", "constructor", "toString",
            "$authorID", "<@300000000000000000>", "300000000000000000", "🗳️", "x".repeat(5000), "true", "false", "null", "undefined", "12h", "-5s", "0", "{}", "[]"]
        const contexts = [undefined, lib.normalizeLegacyVote({ user: "300000000000000000", bot: BOTID, type: "upvote", query: "a=b" }, Date.now()), new Error("e"), { serverCount: 1 }, { user: 5 }, null]
        for (let i = 0; i < 600; i++) {
            const f = pick(fns)
            const args = (f.args ?? []).map(() => pick(hostile))
            const code = f.args?.length ? `${f.name}[${args.join(";")}]` : f.name
            logs.length = 0
            try {
                await run(b.client, code, pick(contexts))
            } catch (e) {
                if (/expects|arguments|brackets|compil/i.test(String(e?.message))) continue // ForgeScript refused to compile it: not this extension's concern
                throw e
            }
            const internal = logs.filter((l) => /TypeError|ReferenceError|Cannot read|is not a function|undefined \(reading/.test(l.text))
            assert.deepEqual(internal.map((l) => l.text.slice(0, 200)), [], `${code} hit an internal error`)
        }
    } finally {
        Api.prototype._request = real
    }
})

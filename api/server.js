const express = require("express")
const cors = require("cors")
const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const sqlite3 = require("sqlite3").verbose()

const PORT = Number(process.env.PORT || 9006)
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:9005"
const DB_FILE = process.env.DB_FILE || path.join(__dirname, "data", "networkmaps.db")
const SHARED_API_KEY = String(process.env.API_KEY || "").trim()

const app = express()
app.use(cors({ origin: CORS_ORIGIN }))
app.use(express.json({ limit: "5mb" }))

function ensureDatabaseFile(dbFilePath) {
    const dbDirectory = path.dirname(dbFilePath)
    if (!fs.existsSync(dbDirectory)) {
        fs.mkdirSync(dbDirectory, { recursive: true })
    }

    if (!fs.existsSync(dbFilePath)) {
        fs.closeSync(fs.openSync(dbFilePath, "w"))
    }
}

app.use("/api", (req, res, next) => {
    const publicPaths = new Set([
        "/health",
        "/auth/status",
        "/auth/setup-admin",
        "/auth/login"
    ])

    if (publicPaths.has(req.path) || req.method === "OPTIONS") {
        next()
        return
    }

    const providedKey = String(req.get("x-api-key") || "").trim()
    if (!providedKey) {
        res.status(401).json({ error: "Unauthorized. API key is required." })
        return
    }

    if (SHARED_API_KEY && providedKey === SHARED_API_KEY) {
        req.authUser = {
            id: 0,
            username: "shared-api-key"
        }
        next()
        return
    }

    get("SELECT id, username FROM users WHERE api_key = ?", [providedKey])
        .then((user) => {
            if (!user) {
                res.status(401).json({ error: "Unauthorized. Invalid API key." })
                return
            }

            req.authUser = {
                id: user.id,
                username: user.username
            }
            next()
        })
        .catch((error) => {
            console.error(error)
            res.status(500).json({ error: "Authentication check failed." })
        })
})

ensureDatabaseFile(DB_FILE)
const db = new sqlite3.Database(DB_FILE)

function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function onRun(err) {
            if (err) {
                reject(err)
                return
            }
            resolve({ id: this.lastID, changes: this.changes })
        })
    })
}

function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) {
                reject(err)
                return
            }
            resolve(rows)
        })
    })
}

function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) {
                reject(err)
                return
            }
            resolve(row)
        })
    })
}

async function initDb() {
    await run(`
    CREATE TABLE IF NOT EXISTS network_maps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

    await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      api_key TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

    const usersColumns = await all("PRAGMA table_info(users)")
    const hasRoleColumn = usersColumns.some((column) => column.name === "role")
    if (hasRoleColumn) {
        await run("ALTER TABLE users RENAME TO users_old")
        await run(`
                CREATE TABLE users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL,
                    api_key TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                )
            `)
        await run(`
                INSERT INTO users (id, username, password_hash, api_key, created_at, updated_at)
                SELECT id, username, password_hash, api_key, created_at, updated_at
                FROM users_old
            `)
        await run("DROP TABLE users_old")
    }
}

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString("hex")
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, "sha256").toString("hex")
    return `${salt}:${hash}`
}

function verifyPassword(password, storedHash) {
    if (!storedHash || typeof storedHash !== "string" || !storedHash.includes(":")) {
        return false
    }

    const [salt, expectedHash] = storedHash.split(":")
    if (!salt || !expectedHash) {
        return false
    }

    const candidateHash = crypto.pbkdf2Sync(password, salt, 100000, 32, "sha256").toString("hex")
    if (candidateHash.length !== expectedHash.length) {
        return false
    }
    return crypto.timingSafeEqual(Buffer.from(candidateHash, "hex"), Buffer.from(expectedHash, "hex"))
}

function generateApiKey() {
    return crypto.randomBytes(24).toString("hex")
}

async function getUserCount() {
    const row = await get("SELECT COUNT(*) AS count FROM users")
    return Number(row?.count || 0)
}

app.get("/api/health", (_req, res) => {
    res.json({ ok: true })
})

app.get("/api/auth/status", async (_req, res) => {
    try {
        const count = await getUserCount()
        res.json({ needsSetup: count === 0 })
    } catch (error) {
        console.error(error)
        res.status(500).json({ error: "Failed to read auth status." })
    }
})

app.post("/api/auth/setup-admin", async (req, res) => {
    try {
        const existingUsers = await getUserCount()
        if (existingUsers > 0) {
            res.status(409).json({ error: "Admin setup already completed." })
            return
        }

        const username = String(req.body?.username || "").trim()
        const password = String(req.body?.password || "")
        if (!username || !password) {
            res.status(400).json({ error: "Fields 'username' and 'password' are required." })
            return
        }

        const passwordHash = hashPassword(password)
        const apiKey = generateApiKey()
        await run(
            "INSERT INTO users (username, password_hash, api_key, created_at, updated_at) VALUES (?, ?, ?, datetime('now'), datetime('now'))",
            [username, passwordHash, apiKey]
        )

        const user = await get("SELECT id, username FROM users WHERE username = ?", [username])
        res.status(201).json({
            user,
            apiKey
        })
    } catch (error) {
        if (String(error?.message || "").includes("UNIQUE constraint failed")) {
            res.status(409).json({ error: "Username already exists." })
            return
        }
        console.error(error)
        res.status(500).json({ error: "Failed to setup admin user." })
    }
})

app.post("/api/auth/login", async (req, res) => {
    try {
        const username = String(req.body?.username || "").trim()
        const password = String(req.body?.password || "")
        if (!username || !password) {
            res.status(400).json({ error: "Fields 'username' and 'password' are required." })
            return
        }

        const user = await get("SELECT id, username, password_hash FROM users WHERE username = ?", [username])
        if (!user || !verifyPassword(password, user.password_hash)) {
            res.status(401).json({ error: "Invalid username or password." })
            return
        }

        const apiKey = generateApiKey()
        await run("UPDATE users SET api_key = ?, updated_at = datetime('now') WHERE id = ?", [apiKey, user.id])

        res.json({
            user: {
                id: user.id,
                username: user.username
            },
            apiKey
        })
    } catch (error) {
        console.error(error)
        res.status(500).json({ error: "Failed to login." })
    }
})

app.get("/api/auth/me", (req, res) => {
    res.json({ user: req.authUser })
})

app.post("/api/auth/logout", async (req, res) => {
    try {
        await run("UPDATE users SET api_key = NULL, updated_at = datetime('now') WHERE id = ?", [req.authUser.id])
        res.json({ ok: true })
    } catch (error) {
        console.error(error)
        res.status(500).json({ error: "Failed to logout." })
    }
})

app.post("/api/users", async (req, res) => {
    try {
        const username = String(req.body?.username || "").trim()
        const password = String(req.body?.password || "")

        if (!username || !password) {
            res.status(400).json({ error: "Fields 'username' and 'password' are required." })
            return
        }

        const passwordHash = hashPassword(password)
        const result = await run(
            "INSERT INTO users (username, password_hash, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))",
            [username, passwordHash]
        )

        const created = await get("SELECT id, username, created_at AS createdAt FROM users WHERE id = ?", [result.id])
        res.status(201).json({ user: created })
    } catch (error) {
        if (String(error?.message || "").includes("UNIQUE constraint failed")) {
            res.status(409).json({ error: "Username already exists." })
            return
        }
        console.error(error)
        res.status(500).json({ error: "Failed to create user." })
    }
})

app.post("/api/maps", async (req, res) => {
    try {
        const name = String(req.body?.name || "").trim()
        const map = req.body?.map

        if (!name) {
            res.status(400).json({ error: "Field 'name' is required." })
            return
        }

        if (!map || typeof map !== "object") {
            res.status(400).json({ error: "Field 'map' must be a JSON object." })
            return
        }

        const payload = JSON.stringify(map)
        const result = await run(
            "INSERT INTO network_maps (name, payload, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))",
            [name, payload]
        )

        const saved = await get(
            "SELECT id, name, created_at AS createdAt, updated_at AS updatedAt FROM network_maps WHERE id = ?",
            [result.id]
        )

        res.status(201).json(saved)
    } catch (error) {
        console.error(error)
        res.status(500).json({ error: "Failed to save network map." })
    }
})

app.get("/api/maps", async (_req, res) => {
    try {
        const maps = await all(
            "SELECT id, name, created_at AS createdAt, updated_at AS updatedAt FROM network_maps ORDER BY id DESC"
        )
        res.json({ maps })
    } catch (error) {
        console.error(error)
        res.status(500).json({ error: "Failed to list network maps." })
    }
})

app.get("/api/maps/:id", async (req, res) => {
    try {
        const id = Number(req.params.id)
        if (!Number.isInteger(id) || id <= 0) {
            res.status(400).json({ error: "Invalid map id." })
            return
        }

        const row = await get(
            "SELECT id, name, payload, created_at AS createdAt, updated_at AS updatedAt FROM network_maps WHERE id = ?",
            [id]
        )

        if (!row) {
            res.status(404).json({ error: "Map not found." })
            return
        }

        let parsedMap = null
        try {
            parsedMap = JSON.parse(row.payload)
        } catch {
            res.status(500).json({ error: "Stored map payload is invalid JSON." })
            return
        }

        res.json({
            id: row.id,
            name: row.name,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            map: parsedMap
        })
    } catch (error) {
        console.error(error)
        res.status(500).json({ error: "Failed to retrieve network map." })
    }
})

app.put("/api/maps/:id", async (req, res) => {
    try {
        const id = Number(req.params.id)
        if (!Number.isInteger(id) || id <= 0) {
            res.status(400).json({ error: "Invalid map id." })
            return
        }

        const map = req.body?.map
        if (!map || typeof map !== "object") {
            res.status(400).json({ error: "Field 'map' must be a JSON object." })
            return
        }

        const nameCandidate = req.body?.name
        const nextName = typeof nameCandidate === "string" && nameCandidate.trim()
            ? nameCandidate.trim()
            : null

        const existing = await get("SELECT id, name FROM network_maps WHERE id = ?", [id])
        if (!existing) {
            res.status(404).json({ error: "Map not found." })
            return
        }

        const payload = JSON.stringify(map)
        await run(
            "UPDATE network_maps SET name = ?, payload = ?, updated_at = datetime('now') WHERE id = ?",
            [nextName || existing.name, payload, id]
        )

        const updated = await get(
            "SELECT id, name, created_at AS createdAt, updated_at AS updatedAt FROM network_maps WHERE id = ?",
            [id]
        )

        res.json(updated)
    } catch (error) {
        console.error(error)
        res.status(500).json({ error: "Failed to update network map." })
    }
})

app.delete("/api/maps/:id", async (req, res) => {
    try {
        const id = Number(req.params.id)
        if (!Number.isInteger(id) || id <= 0) {
            res.status(400).json({ error: "Invalid map id." })
            return
        }

        const existing = await get("SELECT id, name FROM network_maps WHERE id = ?", [id])
        if (!existing) {
            res.status(404).json({ error: "Map not found." })
            return
        }

        await run("DELETE FROM network_maps WHERE id = ?", [id])
        res.json({ deleted: true, id: existing.id, name: existing.name })
    } catch (error) {
        console.error(error)
        res.status(500).json({ error: "Failed to delete network map." })
    }
})

initDb()
    .then(() => {
        app.listen(PORT, () => {
            console.log(`Network map API listening on port ${PORT}`)
        })
    })
    .catch((error) => {
        console.error("Failed to initialize database", error)
        process.exit(1)
    })

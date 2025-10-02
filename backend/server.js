// server.js
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import PDFDocument from "pdfkit";
import pdfToPrinter from "pdf-to-printer";
const { print } = pdfToPrinter;
import multer from 'multer';
import dayjs from "dayjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// --- CORS (allow cookies from your frontend) ---
const ALLOWED_ORIGINS = [
  process.env.WEB_ORIGIN || "http://localhost:5173",
  process.env.WEB_ORIGIN_2,
  process.env.WEB_ORIGIN_3,
].filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      // Allow non-browser requests (curl, Postman) which send no origin
      if (!origin) return cb(null, true);

      // In dev mode allow file:// origins (mobile browsers or local files) and an explicit DEV override
      const devAllowAll = process.env.DEV_ALLOW_ALL === '1' || process.env.NODE_ENV !== 'production';
      if (devAllowAll) return cb(null, true);

      // Regular allowed origins (configured via env)
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);

      // Some webviews or file-based contexts may send a file:// origin; allow that for local testing
      if (String(origin).startsWith('file://')) return cb(null, true);

      cb(new Error('Not allowed by CORS'), false);
    },
    credentials: true,
  })
);

// Accept larger JSON payloads to support base64 image uploads for branding/logo
app.use(express.json({ limit: process.env.JSON_LIMIT || '8mb' }));

// simple logger
app.use((req, _res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

/** ---------- AUTH ---------- **/
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

// Built-in users (override via .env if you like)
const USERS = [
  {
    username: process.env.ADMIN_USER || "admin",
    password: process.env.ADMIN_PASS || "admin123",
    role: "super",
  },
  {
    username: process.env.STAFF_USER || "staff",
    password: process.env.STAFF_PASS || "staff123",
    role: "user",
  },
  {
    username: process.env.STAFF_USER || "staff2",
    password: process.env.STAFF_PASS || "staff123",
    role: "user",
  },
  {
    username: process.env.STAFF_USER || "staff3",
    password: process.env.STAFF_PASS || "staff123",
    role: "user",
  },
];

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "8h" });
}

function parseCookie(header) {
  if (!header) return {};
  return header.split(";").reduce((acc, part) => {
    const [k, ...rest] = part.trim().split("=");
    acc[k.trim()] = rest.join("=");
    return acc;
  }, {});
}

function auth(required = true) {
  return (req, res, next) => {
    try {
      const cookies = parseCookie(req.headers.cookie);
      const token = cookies["token"];
      if (!token) {
        if (required)
          return res.status(401).json({ ok: false, error: "Unauthorized" });
        req.user = null;
        return next();
      }
      const decoded = jwt.verify(token, JWT_SECRET);

      // If single-session enforcement is active, validate session id
      try {
        const stored = getSessionStmt.get(String(decoded.username)) || null;
        const storedSession = stored ? stored.session_id : null;
        if (storedSession) {
          if (!decoded.sessionId || decoded.sessionId !== storedSession) {
            if (required) return res.status(401).json({ ok: false, error: 'Unauthorized' });
            req.user = null;
            return next();
          }
        } else {
          // If no stored session exists but token has sessionId, fail
          if (decoded.sessionId) {
            if (required) return res.status(401).json({ ok: false, error: 'Unauthorized' });
            req.user = null;
            return next();
          }
        }
      } catch (e) {
        if (required) return res.status(401).json({ ok: false, error: 'Unauthorized' });
        req.user = null;
        return next();
      }

      req.user = decoded;
      next();
    } catch {
      if (required)
        return res.status(401).json({ ok: false, error: "Unauthorized" });
      req.user = null;
      next();
    }
  };
}

// SUPER-only middleware
function requireSuper(req, res, next) {
  if (!req.user || req.user.role !== "super") {
    return res.status(403).json({ ok: false, error: "Forbidden" });
  }
  next();
}

function setAuthCookie(res, token) {
  const secure = process.env.NODE_ENV === "production";
  const opts = [
    `token=${token}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${60 * 60 * 8}`,
  ];
  if (secure) opts.push("Secure");
  res.setHeader("Set-Cookie", opts.join("; "));
}

function clearAuthCookie(res) {
  const opts = ["token=", "HttpOnly", "Path=/", "SameSite=Lax", "Max-Age=0"];
  res.setHeader("Set-Cookie", opts.join("; "));
}

// Login
app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  const user = USERS.find(
    (u) => u.username === username && u.password === password
  );
  if (!user)
    return res.status(401).json({ ok: false, error: "Invalid credentials" });
  // create a per-login session id and persist it so older tokens are invalidated
  const sessionId = crypto.randomBytes(16).toString('hex');
  upsertSessionStmt.run(user.username, sessionId, now());
  // notify other clients that user's session was replaced
  broadcastEvent('session:invalidated', { username: user.username, sessionId });
  const token = signToken({ username: user.username, role: user.role, sessionId });
  setAuthCookie(res, token);
  res.json({ ok: true, user: { username: user.username, role: user.role } });
});

// Logout
app.post("/api/logout", auth(true), (req, res) => {
  // remove stored session so tokens are invalidated
  try {
    if (req.user && req.user.username) deleteSessionStmt.run(req.user.username);
  } catch (e) {}
  clearAuthCookie(res);
  res.json({ ok: true });
});

// Current user
app.get("/api/me", auth(false), (req, res) => {
  if (!req.user) return res.json({ ok: true, user: null });
  res.json({
    ok: true,
    user: { username: req.user.username, role: req.user.role },
  });
});

/** ---------- DB SETUP ---------- **/
const db = new Database(path.join(__dirname, "crs.sqlite"));
db.exec(`
CREATE TABLE IF NOT EXISTS campers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  nickname      TEXT NOT NULL,
  age           INTEGER,
  congregation TEXT,
  gender        TEXT,
  is_leader     INTEGER DEFAULT 0,
  paid          INTEGER DEFAULT 0,
  sports        VARCHAR(250),
  additional_info VARCHAR(250),
  invoice_no    TEXT,
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP,
  paid_at       TEXT
);
`);
db.exec(`
CREATE UNIQUE INDEX IF NOT EXISTS campers_unique
ON campers (
  lower(first_name),
  lower(last_name),
  COALESCE(age, 0),
  lower(COALESCE(congregation, ''))
);
`);

// --- SETTINGS TABLE + HELPERS ---
db.prepare(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  )
`).run();

// Sessions table for single-session policy (session id per username)
db.prepare(`
  CREATE TABLE IF NOT EXISTS sessions (
    username TEXT PRIMARY KEY,
    session_id TEXT,
    updated_at TEXT
  )
`).run();

const getSessionStmt = db.prepare(`SELECT session_id FROM sessions WHERE username = ?`);
const upsertSessionStmt = db.prepare(`
  INSERT INTO sessions (username, session_id, updated_at) VALUES (?, ?, ?)
  ON CONFLICT(username) DO UPDATE SET session_id=excluded.session_id, updated_at=excluded.updated_at
`);
const deleteSessionStmt = db.prepare(`DELETE FROM sessions WHERE username = ?`);

const getSettingStmt = db.prepare(`SELECT value FROM settings WHERE key = ?`);
const upsertSettingStmt = db.prepare(`
  INSERT INTO settings (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value=excluded.value
`);

function getSetting(key, fallback = null) {
  const row = getSettingStmt.get(key);
  return row ? row.value : fallback;
}
function setSetting(key, value) {
  upsertSettingStmt.run(key, String(value ?? ""));
  return value;
}

// Defaults & accessors
const DEFAULT_ACTIVITY_NAME =
  process.env.ACTIVITY_NAME || "Church Connect - Activity Registration System";
const DEFAULT_ACTIVITY_TYPE = process.env.ACTIVITY_TYPE || "Camp"; // "Camp" | "Fellowship"
const DEFAULT_REGISTRATION_FEE = process.env.REGISTRATION_FEE || "500";

if (!getSetting("activity_name")) setSetting("activity_name", DEFAULT_ACTIVITY_NAME);
if (!getSetting("activity_type")) setSetting("activity_type", DEFAULT_ACTIVITY_TYPE);
if (!getSetting("registration_fee")) setSetting("registration_fee", DEFAULT_REGISTRATION_FEE);

const getActivityType = () => (getSetting("activity_type") || "Camp");
const getRegistrationFee = () => {
  return getActivityType() === "Camp"
    ? Number(getSetting("registration_fee") || "0") || 0
    : 0;
};

// add invoice_no if DB existed before
try {
  const cols = db.prepare(`PRAGMA table_info(campers)`).all();
  const hasInvoice = cols.some((c) => c.name === "invoice_no");
  if (!hasInvoice) {
    db.exec(`ALTER TABLE campers ADD COLUMN invoice_no TEXT;`);
  }
} catch (e) {
  // ignore
}

// unique index for invoice_no
try {
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS campers_invoice_unique ON campers (invoice_no);`
  );
} catch (e) {}

/** ---------- FILES / HELPERS ---------- **/
const RECEIPTS_DIR = path.join(__dirname, "receipts");
if (!fs.existsSync(RECEIPTS_DIR)) fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
// Uploads (for branding assets like logo)
const UPLOADS_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
// serve uploads statically
app.use('/uploads', express.static(UPLOADS_DIR));

const now = () => dayjs().format("YYYY-MM-DD HH:mm:ss");
const makeReceiptNo = (id) => `YC-${dayjs().format("YYYYMMDD-HHmmss")}-${id}`;
const makeInvoiceNo = (id) =>
  `INV-${dayjs().format("YYYYMMDD")}-${String(id).padStart(5, "0")}`;

function toSafeFilename(s, fallback = "file") {
  const cleaned = String(s || "")
    .normalize("NFKD")
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/_{2,}/g, "_")
    .replace(/-{2,}/g, "-")
    .slice(0, 120)
    .replace(/^[_-]+|[_-]+$/g, "");
  return cleaned || fallback;
}

function generateReceiptPDF(
  { receiptNo, invoiceNo, fullName, congregation, amount, datetime },
  outPath
) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 36 });
    const stream = fs.createWriteStream(outPath);
    doc.pipe(stream);

    const activityName = getSetting("activity_name") || DEFAULT_ACTIVITY_NAME;
      // include branding logo if present
      const logoFile = getSetting('branding_logo');
      if (logoFile) {
        const logoPath = path.join(UPLOADS_DIR, String(logoFile));
        try { if (fs.existsSync(logoPath)) { doc.image(logoPath, { width: 100 }); doc.moveDown(0.5); } } catch (e) {}
      }
    const type = getActivityType();

    doc.fontSize(16).text(`${activityName} — ${type === "Camp" ? "Payment Receipt" : "Registration Receipt"}`);
    doc.moveDown(0.5);
    doc.fontSize(12).text(`Generated: ${datetime}`);
    doc.text(`Receipt #: ${receiptNo}`);
    if (invoiceNo) doc.text(`Invoice #: ${invoiceNo}`);
    doc.text(`Date & Time: ${datetime}`);
    doc.moveDown(0.5);
    doc.text(`Participant: ${fullName}`);
    doc.text(`Congregation: ${congregation || "-"}`);
    doc.text(`Amount: ₱${amount}`);
    doc.moveDown(1).text("Thank you! See you at the event.");
    doc.end();

    stream.on("finish", () => resolve(outPath));
    stream.on("error", reject);
  });
}

async function autoPrint(filePath, printerName) {
  await print(filePath, printerName ? { printer: printerName } : undefined);
}

/** ---------- ROUTES ---------- **/

// SETTINGS
// Get all settings (public read so login/branding can display)
app.get("/api/settings", auth(false), (_req, res) => {
  const rows = db.prepare(`SELECT key, value FROM settings`).all();
  res.json({
    ok: true,
    settings: Object.fromEntries(rows.map((r) => [r.key, r.value])),
  });
});

// Back-compat: update only activity_name
app.put("/api/settings/activity_name", auth(true), requireSuper, (req, res) => {
  const { value } = req.body || {};
  if (typeof value !== "string" || !value.trim()) {
    return res.status(400).json({ ok: false, error: "Invalid value" });
  }
  const v = value.trim();
  setSetting("activity_name", v);
  res.json({ ok: true, key: "activity_name", value: v });
});

// NEW: bulk update (super-only) activity_name / activity_type / registration_fee
app.put("/api/settings", auth(true), requireSuper, (req, res) => {
  const { activity_name, activity_type, registration_fee } = req.body || {};

  if (typeof activity_name === "string" && activity_name.trim()) {
    setSetting("activity_name", activity_name.trim());
  }

  if (typeof activity_type === "string") {
    const at = activity_type.trim();
    if (!["Camp", "Fellowship"].includes(at)) {
      return res.status(400).json({ ok: false, error: "Invalid activity_type" });
    }
    setSetting("activity_type", at);
    if (at === "Fellowship") setSetting("registration_fee", "0");
  }

  if (typeof registration_fee !== "undefined") {
    const feeNum = Number(registration_fee);
    if (getActivityType() === "Camp" && !(feeNum >= 0)) {
      return res.status(400).json({ ok: false, error: "Invalid registration_fee" });
    }
    setSetting("registration_fee", String(Math.max(0, feeNum)));
  }

  const rows = db.prepare(`SELECT key, value FROM settings`).all();
  const settingsObj = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  // notify clients of settings updates
  broadcastEvent('settings:updated', { settings: settingsObj });
  res.json({ ok: true, settings: settingsObj });
});

// Duplicate check (nice UX)
app.get("/api/campers/exists", (req, res) => {
  const {
    first_name = "",
    last_name = "",
    age = "",
    congregation = "",
  } = req.query;
  const row = db
    .prepare(
      `
    SELECT 1 FROM campers
    WHERE lower(first_name)=lower(@first_name)
      AND lower(last_name)=lower(@last_name)
      AND COALESCE(age,0)=COALESCE(@age,0)
      AND lower(COALESCE(congregation,''))=lower(COALESCE(@congregation,''))
    LIMIT 1
  `
    )
    .get({
      first_name: String(first_name).trim(),
      last_name: String(last_name).trim(),
      age: age === "" ? null : Number(age),
      congregation: String(congregation).trim(),
    });
  res.json({ exists: !!row });
});

// Create camper (paid on creation) — requires login (any role)
app.post("/api/campers", auth(true), (req, res) => {
  try {
    const {
      first_name,
      last_name,
      nickname,
      age,
      congregation,
      gender,
      is_leader,
      additional_info,
      sports,
    } = req.body;

    const insertStmt = db.prepare(`
      INSERT INTO campers (
        first_name,last_name,nickname,age,congregation,gender,
        is_leader,paid,additional_info,sports,created_at,paid_at
      )
      VALUES (
        @first_name,@last_name,@nickname,@age,@congregation,@gender,
        @is_leader,1,@additional_info,@sports,@created_at,@paid_at
      )
    `);

    const info = insertStmt.run({
      first_name: (first_name || "").trim(),
      last_name: (last_name || "").trim(),
      nickname: (nickname || "").trim(),
      age: String(age) === "" ? null : Number(age),
      congregation: (congregation || "").trim(),
      gender: (gender || "").trim(),
      is_leader: is_leader ? 1 : 0,
      additional_info: (additional_info || "").trim(),
      sports: (sports || "").trim(),
      created_at: now(),
      paid_at: now(),
    });

    const id = info.lastInsertRowid;
    const invoice_no = makeInvoiceNo(id);
    db.prepare(`UPDATE campers SET invoice_no=@inv WHERE id=@id`).run({
      inv: invoice_no,
      id,
    });

    // notify clients a camper was created
    broadcastEvent('campers:created', { id, first_name: (first_name || '').trim(), last_name: (last_name || '').trim() });

    res.json({ ok: true, id, invoice_no });
  } catch (e) {
    if (
      e &&
      (e.code === "SQLITE_CONSTRAINT" || e.code === "SQLITE_CONSTRAINT_UNIQUE")
    ) {
      return res.status(409).json({
        ok: false,
        code: "DUPLICATE",
        message: "Camper already exists",
      });
    }
    console.error(e);
    res.status(500).json({ ok: false, message: "DB insert failure" });
  }
});

// Total cash collected across ALL paid campers
app.get("/api/campers/total_amount", auth(true), (_req, res) => {
  try {
    const { n } = db
      .prepare(`SELECT COUNT(*) AS n FROM campers WHERE paid = 1`)
      .get();
    const fee = getRegistrationFee();               // <-- dynamic fee
    const grandTotal = Number((n * fee).toFixed(2));
    res.json({ ok: true, grandTotal });
  } catch (e) {
    console.error("Error fetching grand total:", e);
    res
      .status(500)
      .json({ ok: false, message: "Failed to calculate grand total." });
  }
});

// Get a single camper's details (for editing) — requires login (any role)
app.get("/api/campers/:id", auth(true), (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = db.prepare(`SELECT * FROM campers WHERE id=?`).get(id);
    if (!row) return res.status(404).json({ ok: false, message: "Not found" });

    res.json({ ok: true, camper: row });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false });
  }
});

// **EDIT Camper Details** — Any logged-in user (staff or super) can edit
app.put("/api/campers/:id", auth(true), (req, res) => {
  try {
    const id = Number(req.params.id);
    const {
      first_name,
      last_name,
      nickname,
      age,
      congregation,
      gender,
      is_leader,
      additional_info,
      sports,
    } = req.body;

    const updateStmt = db.prepare(`
      UPDATE campers SET
        first_name = @first_name,
        last_name = @last_name,
        nickname = @nickname,
        age = @age,
        congregation = @congregation,
        gender = @gender,
        is_leader = @is_leader,
        additional_info = @additional_info,
        sports = @sports
      WHERE id = @id
    `);

    const info = updateStmt.run({
      id,
      first_name: (first_name || "").trim(),
      last_name: (last_name || "").trim(),
      nickname: (nickname || "").trim(),
      age: String(age) === "" ? null : Number(age),
      congregation: (congregation || "").trim(),
      gender: (gender || "").trim(),
      is_leader: is_leader ? 1 : 0,
      additional_info: (additional_info || "").trim(),
      sports: (sports || "").trim(),
    });

    if (info.changes === 0) {
      const existing = db.prepare("SELECT 1 FROM campers WHERE id=?").get(id);
      if (!existing) {
        return res.status(404).json({ ok: false, message: "Camper not found" });
      }
      return res.json({ ok: true, message: "No changes made" });
    }

    // notify clients a camper was updated
    broadcastEvent('campers:updated', { id });
    res.json({ ok: true, id });
  } catch (e) {
    if (
      e &&
      (e.code === "SQLITE_CONSTRAINT" || e.code === "SQLITE_CONSTRAINT_UNIQUE")
    ) {
      return res.status(409).json({
        ok: false,
        code: "DUPLICATE",
        message:
          "Update failed: Another camper with this name, age, and congregation already exists.",
      });
    }
    console.error(e);
    res.status(500).json({ ok: false, message: "DB update failure" });
  }
});

// List with filters — requires login (any role)
app.get("/api/campers", auth(true), (req, res) => {
  try {
    const { congregation, gender, age, is_leader } = req.query;

    let sql = `SELECT * FROM campers WHERE 1=1`;
    const params = {};
    if (congregation && congregation !== "All") {
      sql += ` AND congregation=@congregation`;
      params.congregation = congregation;
    }
    if (gender && gender !== "All") {
      sql += ` AND gender=@gender`;
      params.gender = gender;
    }
    if (age && age !== "All") {
      sql += ` AND age=@age`;
      params.age = Number(age);
    }
    if (is_leader && is_leader !== "All") {
      sql += ` AND is_leader=@is_leader`;
      params.is_leader = Number(is_leader);
    }
    sql += ` ORDER BY created_at DESC`;

    const fee = getRegistrationFee();              // <-- dynamic fee
    const rows = db
      .prepare(sql)
      .all(params)
      .map((r) => ({
        ...r,
        amount: fee.toFixed(2),
      }));
    res.json({ ok: true, rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false });
  }
});

// Provide distinct congregations for autocomplete/suggestions
app.get("/api/congregations", auth(false), (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    let rows;
    if (q) {
      rows = db
        .prepare(
          `SELECT DISTINCT congregation FROM campers WHERE congregation IS NOT NULL AND congregation != '' AND lower(congregation) LIKE '%' || lower(@q) || '%' ORDER BY lower(congregation)`
        )
        .all({ q });
    } else {
      rows = db
        .prepare(
          `SELECT DISTINCT congregation FROM campers WHERE congregation IS NOT NULL AND congregation != '' ORDER BY lower(congregation)`
        )
        .all();
    }
    const congregations = rows.map((r) => r.congregation).filter(Boolean);
    res.json({ ok: true, congregations });
  } catch (e) {
    console.error("Failed to fetch congregations", e);
    res.status(500).json({ ok: false, error: "Failed to fetch congregations" });
  }
});

// Teams persistence endpoints (save/load/clear) — require login
app.get('/api/teams', auth(true), (req, res) => {
  try {
    const raw = getSetting('teams_state');
    if (!raw) return res.json({ ok: true, teams: [], saved_at: null, saved_by: null });
    const payload = JSON.parse(raw || '{}');
    const teams = payload.teams || [];
    res.json({ ok: true, teams, saved_at: payload.saved_at || null, saved_by: payload.saved_by || null });
  } catch (e) {
    console.error('Failed to load teams', e);
    res.status(500).json({ ok: false, error: 'Failed to load teams' });
  }
});

app.post('/api/teams', auth(true), (req, res) => {
  try {
    const { teams } = req.body || {};
    if (!Array.isArray(teams)) return res.status(400).json({ ok: false, error: 'Invalid payload' });
    const payload = { teams, saved_at: now(), saved_by: req.user?.username || null };
    setSetting('teams_state', JSON.stringify(payload));
    // notify connected clients
    broadcastEvent('teams:updated', { saved_at: payload.saved_at, saved_by: payload.saved_by });
    res.json({ ok: true, saved_at: payload.saved_at, saved_by: payload.saved_by });
  } catch (e) {
    console.error('Failed to save teams', e);
    res.status(500).json({ ok: false, error: 'Failed to save teams' });
  }
});

app.delete('/api/teams', auth(true), (req, res) => {
  try {
    setSetting('teams_state', '');
    broadcastEvent('teams:cleared', {});
    res.json({ ok: true });
  } catch (e) {
    console.error('Failed to clear teams', e);
    res.status(500).json({ ok: false, error: 'Failed to clear teams' });
  }
});

// Print a single receipt — requires login (any role)
app.post("/api/campers/:id/print-receipt", auth(true), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = db.prepare(`SELECT * FROM campers WHERE id=?`).get(id);
    if (!row || !row.paid)
      return res
        .status(400)
        .json({ ok: false, error: "Not paid or not found" });

    const receiptNo = makeReceiptNo(id);
    const invoiceNo = row.invoice_no || "";

    const camperName = `${row.first_name || ""} ${row.last_name || ""}`.trim();
    const safeName = toSafeFilename(camperName, `Camper_${id}`);
    const safeCong = toSafeFilename(row.congregation || "NoCongregation");
    const safeInv = toSafeFilename(invoiceNo || receiptNo);
    const fileName = `${safeName}-${safeCong}-${safeInv}.pdf`;
    const file = path.join(RECEIPTS_DIR, fileName);

    const fee = getRegistrationFee();              // <-- dynamic fee
    await generateReceiptPDF(
      {
        receiptNo,
        invoiceNo,
        fullName: camperName,
        congregation: row.congregation,
        amount: fee.toFixed(2),
        datetime: row.paid_at || now(),
      },
      file
    );

    await autoPrint(file);

    res.json({
      ok: true,
      receiptNo,
      invoice_no: invoiceNo,
      file_name: fileName,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false });
  }
});

// Print current list — requires login (any role)
app.post("/api/print-camper-list", auth(true), async (req, res) => {
  try {
    const { congregation, age, gender, is_leader } = req.body || {};

    let sql = `
      SELECT first_name, last_name, age, congregation, gender
      FROM campers
      WHERE 1=1
    `;
    const params = {};
    if (congregation && congregation !== "All") {
      sql += ` AND congregation=@congregation`;
      params.congregation = congregation;
    }
    if (typeof age !== "undefined" && age !== "All") {
      sql += ` AND age=@age`;
      params.age = Number(age);
    }
    if (gender && gender !== "All") {
      sql += ` AND gender=@gender`;
      params.gender = gender;
    }
    if (typeof is_leader !== "undefined" && is_leader !== "All") {
      sql += ` AND is_leader=@is_leader`;
      params.is_leader = Number(is_leader);
    }
    sql += ` ORDER BY congregation ASC, last_name ASC, first_name ASC`;

    const rows = db.prepare(sql).all(params);

    const file = path.join(
      RECEIPTS_DIR,
      `CamperList-${dayjs().format("YYYYMMDD-HHmmss")}.pdf`
    );

    await new Promise((resolve, reject) => {
      const margin = 36;
      const doc = new PDFDocument({ size: "A4", margin });
      const stream = fs.createWriteStream(file);
      doc.pipe(stream);

      const activityName = getSetting("activity_name") || DEFAULT_ACTIVITY_NAME;
      const logoFile = getSetting('branding_logo');
      if (logoFile) {
        const logoPath = path.join(UPLOADS_DIR, String(logoFile));
        try { if (fs.existsSync(logoPath)) { doc.image(logoPath, margin, doc.y, { width: 100 }); doc.moveDown(0.5); } } catch (e) {}
      }

      // Page header
      doc.font("Helvetica-Bold").fontSize(16).text(`${activityName} — Camper List`);
      doc.font("Helvetica").fontSize(10).text(`Generated: ${now()}`);
      const activeFilters = [
        congregation && congregation !== "All" ? `Congregation: ${congregation}` : null,
        age && age !== "All" ? `Age: ${age}` : null,
        gender && gender !== "All" ? `Gender: ${gender}` : null,
        is_leader && is_leader !== "All" ? `Leader: ${is_leader ? "Yes" : "No"}` : null,
      ].filter(Boolean);
      if (activeFilters.length) doc.text(activeFilters.join(" | "));
      doc.moveDown(0.5);

      // Column layout
      const col = {
        name: margin,
        cong: margin + 230,
        age: margin + 230 + 190,
        gen: margin + 230 + 190 + 40,
      };
      const widths = { name: 220, cong: 190, age: 40, gen: 60 };
      const lineHeight = 16;

      function drawHeader() {
        doc.moveDown(0.25);
        doc.font("Helvetica-Bold").fontSize(11);
        doc.text("Name", col.name, doc.y, { width: widths.name });
        doc.text("Congregation", col.cong, doc.y, { width: widths.cong });
        doc.text("Age", col.age, doc.y, { width: widths.age });
        doc.text("Gender", col.gen, doc.y, { width: widths.gen });
        const y = doc.y + 4;
        doc.moveTo(margin, y).lineTo(doc.page.width - margin, y).strokeColor("#999").lineWidth(0.5).stroke();
        doc.moveDown(0.3);
        doc.font("Helvetica").fontSize(10);
      }

      function maybeNewPage() {
        const bottom = doc.page.height - margin - 40;
        if (doc.y > bottom) {
          doc.addPage();
          drawHeader();
        }
      }

      drawHeader();

      rows.forEach((r) => {
        const name = `${r.first_name} ${r.last_name}`.trim();
        const rowY = doc.y;
        doc.text(name, col.name, rowY, { width: widths.name });
        doc.text(r.congregation || "-", col.cong, rowY, { width: widths.cong });
        doc.text(String(r.age ?? "-"), col.age, rowY, { width: widths.age });
        doc.text(r.gender || "-", col.gen, rowY, { width: widths.gen });

        doc.moveDown(0.4);
        doc.y = Math.max(rowY + lineHeight, doc.y);
        maybeNewPage();
      });

      doc.end();
      stream.on("finish", resolve);
      stream.on("error", reject);
    });

    await autoPrint(file);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false });
  }
});

// Upload branding logo — accept multipart/form-data (file) OR JSON base64 payload { filename, data }
const upload = multer({ dest: UPLOADS_DIR });
app.post('/api/settings/logo', auth(true), requireSuper, upload.single('file'), async (req, res) => {
  try {
    // If multer handled a file upload
    if (req.file) {
      const tmpPath = req.file.path;
      const origName = req.file.originalname || 'upload.png';
      const ext = path.extname(origName) || '';
      const safeName = toSafeFilename(path.basename(origName, path.extname(origName))) + '-' + Date.now() + (ext || '.png');
      const outPath = path.join(UPLOADS_DIR, safeName);
      // move temporary file to our safe name
      fs.renameSync(tmpPath, outPath);
      setSetting('branding_logo', safeName);
      broadcastEvent('settings:updated', { key: 'branding_logo', value: safeName });
      return res.json({ ok: true, file: safeName, url: `/uploads/${safeName}` });
    }

    // Fallback: accept JSON { filename, data } where data may be a data URL or raw base64
    const { filename, data } = req.body || {};
    if (!filename || !data) return res.status(400).json({ ok: false, error: 'Invalid payload' });
    const match = String(data).match(/^data:(image\/[^;]+);base64,(.*)$/);
    let b64 = data;
    let ext = path.extname(filename) || '';
    if (match) {
      b64 = match[2];
      const mime = match[1];
      if (!ext) {
        ext = mime.split('/')[1] ? `.${mime.split('/')[1]}` : '';
      }
    }
    const safeName = toSafeFilename(path.basename(filename, path.extname(filename))) + '-' + Date.now() + (ext || '.png');
    const outPath = path.join(UPLOADS_DIR, safeName);
    const buf = Buffer.from(b64, 'base64');
    fs.writeFileSync(outPath, buf);
    setSetting('branding_logo', safeName);
    broadcastEvent('settings:updated', { key: 'branding_logo', value: safeName });
    res.json({ ok: true, file: safeName, url: `/uploads/${safeName}` });
  } catch (e) {
    console.error('Failed to upload logo', e);
    res.status(500).json({ ok: false, error: 'Failed to upload' });
  }
});

// Delete a camper — SUPER ONLY
app.delete("/api/campers/:id", auth(true), requireSuper, (req, res) => {
  try {
    const id = Number(req.params.id);
    const info = db.prepare("DELETE FROM campers WHERE id = ?").run(id);
    if (info.changes === 0)
      return res.status(404).json({ ok: false, message: "Not found" });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Failed to delete" });
  }
});

// JSON error handler
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  if (res.headersSent) return;
  res.status(500).json({ ok: false, message: err?.message || "Server error" });
});

const PORT = process.env.PORT || 3001;
// bind host: default to 0.0.0.0 so it's reachable on the LAN unless explicitly set
const HOST = process.env.HOST || "0.0.0.0";
app.listen(PORT, HOST, () => console.log(`Server running at http://${HOST}:${PORT}`));

// --- Simple Server-Sent Events (SSE) support for realtime updates ---
const sseClients = new Set();

function broadcastEvent(eventType, payload) {
  const msg = `event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(msg);
    } catch (e) {
      // ignore write errors; client will eventually close
    }
  }
}

app.get('/api/events', auth(false), (req, res) => {
  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  // Allow CORS credentials for cross-origin
  res.flushHeaders && res.flushHeaders();

  // send a comment to keep connection alive
  res.write(': connected\n\n');
  sseClients.add(res);

  // Remove on close
  req.on('close', () => {
    sseClients.delete(res);
  });
});

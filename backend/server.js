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
import ThermalPrinter from 'node-thermal-printer';
const { PrinterTypes, CharacterSet, BreakLine } = ThermalPrinter;
import { spawn } from 'child_process';
import os from 'os';
import { printReceipt } from "./printer.js";

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
    username: process.env.ADMIN_USER2 || "admin2",
    password: process.env.ADMIN_PASS2 || "admin123",
    role: "super",
  },
  {
    username: process.env.STAFF_USER || "staff",
    password: process.env.STAFF_PASS || "staff123",
    role: "user",
  },
  {
    username: process.env.STAFF_USER2 || "staff2",
    password: process.env.STAFF_PASS2 || "staff123",
    role: "user",
  },
  {
    username: process.env.STAFF_USER3 || "staff3",
    password: process.env.STAFF_PASS3 || "staff123",
    role: "user",
  },
  {
    username: process.env.STAFF_USER4 || "staff4",
    password: process.env.STAFF_PASS4 || "staff123",
    role: "user",
  },
  {
    username: process.env.STAFF_USER5 || "staff5",
    password: process.env.STAFF_PASS5 || "staff123",
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
  is_baptized   INTEGER DEFAULT 0,
  is_guardian   INTEGER DEFAULT 0,
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
  process.env.ACTIVITY_NAME || "Church Activity Registration System";
const DEFAULT_ACTIVITY_TYPE = process.env.ACTIVITY_TYPE || "Camp"; // "Camp" | "Fellowship"
const DEFAULT_REGISTRATION_FEE = process.env.REGISTRATION_FEE || "500";

if (!getSetting("activity_name")) setSetting("activity_name", DEFAULT_ACTIVITY_NAME);
if (!getSetting("activity_type")) setSetting("activity_type", DEFAULT_ACTIVITY_TYPE);
if (!getSetting("registration_fee")) setSetting("registration_fee", DEFAULT_REGISTRATION_FEE);

const getActivityType = () => (getSetting("activity_type") || "Camp");
const getActivityName = () => (getSetting("activity_name") || DEFAULT_ACTIVITY_NAME);
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
    // --- Paper presets (points). 1in = 72pt. 58mm ≈ 2.283in ≈ 164pt.
    const PAPER = process.env.RECEIPT_PAPER || '58'; // '58' | '80'
    // 58mm receipt width ≈ 164pt; we give it ~180pt to avoid clipping.
    const widthPt = 180;                 // set RECEIPT_PAPER=80 later and bump to ~226 if you move to 80mm
  const margin  = 4;                   // Small safe margin to avoid top clipping while staying compact
    const usable = widthPt - (margin * 2); // Calculate usable width
    const doc = new PDFDocument({ size: [widthPt, 800], margin }); // height will auto-extend as needed

    const stream = fs.createWriteStream(outPath);
    doc.pipe(stream);

  // Ensure predictable rendering
  doc.fillColor('#000');
  try { doc.font('Helvetica'); } catch (e) {}

    const currentDate = new Date().toLocaleString('en-PH', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
    
    const formattedDate = currentDate.substring(0, 20);

  // Optional: thin top rule to confirm printer renders graphics
  doc.moveDown(0.5);

  // Use larger font sizes since page is narrow - optimized for thermal receipt
    doc.fontSize(12).text('OFFICIAL RECEIPT', { align: 'center', width: usable });
    doc.moveDown(0.3);
    doc.fontSize(8).text('================================', { align: 'center', width: usable });

    doc.moveDown(0.3);
    doc.text(`Date: ${formattedDate}`, { width: usable });
      doc.moveDown(0.03);
    doc.text(`Receipt: ${receiptNo}`, { width: usable });
      doc.moveDown(0.03);
    doc.text(`Invoice: ${invoiceNo}`, { width: usable });

    doc.moveDown(0.3);
    doc.fontSize(8).text('----------------------------------------------------', { align: 'center', width: usable });

    doc.moveDown(0.3);
    doc.fontSize(8).text('MEMBER INFO:', { width: usable });
    doc.moveDown(0.2);
    // Split long names if needed
    if (fullName.length > 32) {
      doc.text(fullName.substring(0, 32), { width: usable });
      doc.text(fullName.substring(32), { width: usable });
    } else {
      doc.text(`Name: ${fullName}`, { width: usable });
    }

    doc.text(`Congregation: ${congregation || 'N/A'}`, { width: usable });

    
    doc.fontSize(8).text('----------------------------------------------------', { align: 'center', width: usable });
    
    doc.moveDown(0.1);
    doc.text('PAYMENT DETAILS:', {width: usable });
    doc.moveDown(0.1);

    // Right-align amounts with proper spacing
    const fee = `PHP ${amount}`;
    const regLine = `Reg Fee${' '.repeat(32 - 7 - fee.length)}${fee}`;
    const totalLine = `Total${' '.repeat(32 - 5 - fee.length)}${fee}`;
    const paidLine = `Paid${' '.repeat(32 - 4 - fee.length)}${fee}`;
    const changeLine = `Change${' '.repeat(32 - 6 - 11)}PHP   0.00`;
    
    doc.text(regLine, { width: usable });
    doc.moveDown(0.1);
    doc.text(totalLine, { width: usable });
    doc.moveDown(0.2);
    doc.text(paidLine, { width: usable });
    doc.moveDown(0.2);
    doc.text('================================', { align: 'center', width: usable });

    doc.moveDown(0.1);
    doc.fontSize(12).text('PAID IN FULL', { align: 'center', width: usable });
    doc.moveDown(-0.2);
    doc.fontSize(8).text('Thank you for your payment!', { align: 'center', width: usable });
    doc.moveDown(0.0);
    doc.fontSize(8).text('This serves as your official receipt and', { align: 'center', width: usable });
    doc.moveDown(0.2);
    doc.fontSize(8).text('proof of payment.', { align: 'center', width: usable });

    // allow content to grow; if we ever overflow, start a new short page
    doc.end();
    stream.on('finish', () => resolve(outPath));
    stream.on('error', reject);
  });
}


async function autoPrint(filePath, printerName) {
  const options = {};
  if (printerName) options.printer = printerName;
  // Help POS58 drivers by forcing monochrome and fitting the page
  options.monochrome = true;
  options.scale = 'fit';
  try {
    await print(filePath, options);
  } catch (err) {
    console.warn('autoPrint failed with options, retrying without extras:', err.message);
    await print(filePath, printerName ? { printer: printerName } : undefined);
  }
}

// Raw thermal printing using Windows commands and direct file writing
async function rawThermalPrint(receiptText, printerPort = 'USB001') {
  return new Promise((resolve, reject) => {
    try {
      console.log(`Attempting raw print to ${printerPort}`);
      
      // Create ESC/POS commands using Buffer for proper binary encoding
      const ESC = 0x1B;
      const GS = 0x1D;
      
      // Build command arrays
      const INIT = [ESC, 0x40];                    // Initialize printer
      const CENTER = [ESC, 0x61, 0x01];            // Center align
      const LEFT = [ESC, 0x61, 0x00];              // Left align
      const BOLD_ON = [ESC, 0x45, 0x01];           // Bold on
      const BOLD_OFF = [ESC, 0x45, 0x00];          // Bold off
      const CUT = [GS, 0x56, 0x00];                // Cut paper (full cut)
      const LF = [0x0A];                           // Line feed
      
      // Helper function to add text
      const text = (str) => Buffer.from(str, 'ascii');
      
      // Build the receipt as a buffer - each command should be separate from text
      const bufferParts = [
        Buffer.from(INIT),
        Buffer.from(LF),
        Buffer.from(LF),  // Extra line feeds after init to clear any issues
        Buffer.from(CENTER),
        Buffer.from(BOLD_ON),
        text('CHURCH ACTIVITY'),
        Buffer.from(BOLD_OFF),
        Buffer.from(LF),
        Buffer.from(BOLD_ON),
        text('PAYMENT RECEIPT'),
        Buffer.from(BOLD_OFF),
        Buffer.from(LF),
        Buffer.from(LF),
        text('================================'),
        Buffer.from(LF),
        Buffer.from(LF),
        Buffer.from(LEFT),
        text(receiptText),
        Buffer.from(LF),
        Buffer.from(LF),
        Buffer.from(CENTER),
        Buffer.from(BOLD_ON),
        text('PAID IN FULL'),
        Buffer.from(BOLD_OFF),
        Buffer.from(LF),
        Buffer.from(LF),
        text('Thank you for your payment!'),
        Buffer.from(LF),
        text('See you at the event!'),
        Buffer.from(LF),
        Buffer.from(LF),
        text('This serves as your'),
        Buffer.from(LF),
        text('official receipt and'),
        Buffer.from(LF),
        text('proof of payment.'),
        Buffer.from(LF),
        Buffer.from(LF),
        text('Keep this receipt'),
        Buffer.from(LF),
        text('for your records'),
        Buffer.from(LF),
        Buffer.from(LF),
        Buffer.from(LF),
        Buffer.from(LF),
        Buffer.from(CUT)
      ];
      
      const rawData = Buffer.concat(bufferParts);

      // Get printer name from environment - use exact name from Windows
      const printerName = process.env.THERMAL_PRINTER_NAME || 'POSPrinter POS58';
      // const printerName = process.env.THERMAL_PRINTER_NAME || 'Receipt-Printer';

      // Create temp file with .prn extension
      const tempFile = path.join(os.tmpdir(), `receipt_${Date.now()}.prn`);
      fs.writeFileSync(tempFile, rawData);
      console.log(`Created temp file: ${tempFile}`);
      
      // Use CMD copy command to send to printer - this is the most reliable method
      const copyCommand = `copy /b "${tempFile}" "\\\\localhost\\${printerName}"`;
      console.log(`Executing: ${copyCommand}`);
      
      const cmdProcess = spawn('cmd.exe', ['/c', copyCommand], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });

      let stdout = '';
      let stderr = '';

      cmdProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      cmdProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      cmdProcess.on('close', (code) => {
        console.log(`CMD output: ${stdout}`);
        if (stderr) console.log(`CMD stderr: ${stderr}`);
        
        // Clean up temp file
        try {
          fs.unlinkSync(tempFile);
        } catch (e) {
          console.log('Could not delete temp file:', e.message);
        }

        if (code === 0 && stdout.includes('copied')) {
          console.log(`Successfully sent to printer: ${printerName}`);
          resolve();
        } else {
          reject(new Error(`Copy command failed with code ${code}`));
        }
      });

      cmdProcess.on('error', (error) => {
        // Clean up temp file
        try {
          fs.unlinkSync(tempFile);
        } catch (e) {}
        reject(new Error(`CMD process error: ${error.message}`));
      });

    } catch (error) {
      reject(new Error(`Raw print setup error: ${error.message}`));
    }
  });
}

// Simple thermal printer function using our new printer.js
async function printThermalReceipt(receiptData) {
  try {
    console.log('Starting PDF receipt printing...');
    
    // Generate PDF receipt with compact formatting
    const filename = `receipt_${Date.now()}.pdf`;
    const pdfPath = path.join(__dirname, 'receipts', filename);
    
    // Ensure receipts directory exists
    const receiptsDir = path.dirname(pdfPath);
    if (!fs.existsSync(receiptsDir)) {
      fs.mkdirSync(receiptsDir, { recursive: true });
    }
    
    // Generate compact PDF
    await generateReceiptPDF(receiptData, pdfPath);
    console.log(`PDF generated: ${pdfPath}`);
    
    // Auto-print to thermal printer if configured
    const printerName = process.env.THERMAL_PRINTER_NAME;
    if (printerName) {
      console.log(`Auto-printing to: ${printerName}`);
      await autoPrint(pdfPath, printerName);
      console.log('PDF printed successfully');
    } else {
      console.log('No printer configured, PDF saved only');
    }
    
  } catch (error) {
    console.error('PDF printing error:', error);
    throw new Error(`PDF printing failed: ${error.message}`);
  }
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
      is_baptized,
      is_guardian,
      additional_info,
      sports,
    } = req.body;

    const insertStmt = db.prepare(`
      INSERT INTO campers (
        first_name,last_name,nickname,age,congregation,gender,
        is_leader,is_baptized,is_guardian,paid,additional_info,sports,created_at,paid_at
      )
      VALUES (
        @first_name,@last_name,@nickname,@age,@congregation,@gender,
        @is_leader,@is_baptized,@is_guardian,1,@additional_info,@sports,@created_at,@paid_at
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
      is_baptized: is_baptized ? 1 : 0,
      is_guardian: is_guardian ? 1 : 0,
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
      is_baptized,
      is_guardian,
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
        is_baptized = @is_baptized,
        is_guardian = @is_guardian,
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
      is_baptized: is_baptized ? 1 : 0,
      is_guardian: is_guardian ? 1 : 0,
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
    const { congregation, gender, age, is_leader, is_baptized, is_guardian } = req.query;

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
    if (is_baptized && is_baptized !== "All") {
      sql += ` AND is_baptized=@is_baptized`;
      params.is_baptized = Number(is_baptized);
    }
    if (is_guardian && is_guardian !== "All") {
      sql += ` AND is_guardian=@is_guardian`;
      params.is_guardian = Number(is_guardian);
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
    
    // Try thermal printing first, fallback to PDF if thermal fails
    const receiptData = {
      receiptNo,
      invoiceNo,
      fullName: camperName,
      congregation: row.congregation,
      amount: fee.toFixed(2),
      datetime: row.paid_at || now(),
    };

    let printMethod = 'thermal';
    try {
      // Attempt thermal printing
      await printThermalReceipt(receiptData);
      console.log('Receipt printed via thermal printer');
    } catch (thermalError) {
      console.warn('Thermal printing failed, falling back to PDF:', thermalError.message);
      printMethod = 'PDF';
      
      // Fallback to PDF printing - always generate and auto-print
      await generateReceiptPDF(receiptData, file);
      try {
        await autoPrint(file, process.env.THERMAL_PRINTER_NAME);
        console.log('Receipt printed via PDF fallback - sent to default printer');
      } catch (printError) {
        console.warn('Auto-print failed, PDF saved for manual printing:', printError.message);
      }
    }

    res.json({
      ok: true,
      receiptNo,
      invoice_no: invoiceNo,
      file_name: fileName,
      print_method: printMethod,
      message: printMethod === 'thermal' ? 'Receipt sent to thermal printer' : 'Receipt sent to default printer (PDF)'
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false });
  }
});

// Test thermal printer connection — requires login (any role)
app.post("/api/test-thermal-printer", auth(true), async (req, res) => {
  try {
    console.log('Testing thermal printer connection...');

    // Print test receipt
    const testReceiptData = {
      receiptNo: 'TEST-001',
      invoiceNo: 'TEST-INV-001',
      fullName: 'Test User',
      congregation: 'Test Congregation',
      amount: '100.00',
      datetime: new Date().toISOString(),
    };

    await printThermalReceipt(testReceiptData);

    res.json({
      ok: true,
      message: 'Test receipt sent to thermal printer! Check if it printed.',
      method: 'Node thermal printer via Generic / Text Only interface',
      interface: 'printer:Generic / Text Only'
    });
  } catch (e) {
    console.error('Thermal printer test error:', e);
    res.json({ 
      ok: false, 
      error: 'Thermal printing failed: ' + e.message,
      help: 'Check if thermal printer is connected and recognized by Windows as Generic / Text Only printer.',
      attempted_interface: 'printer:Generic / Text Only'
    });
  }
});


// Print thermal receipt directly — requires login (any role)
app.post("/api/campers/:id/print-thermal", auth(true), async (req, res) => {
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
    const fee = getRegistrationFee();

    const receiptData = {
      receiptNo,
      invoiceNo,
      fullName: camperName,
      congregation: row.congregation,
      amount: fee.toFixed(2),
      datetime: row.paid_at || now(),
    };

    await printThermalReceipt(receiptData);

    res.json({
      ok: true,
      receiptNo,
      invoice_no: invoiceNo,
      printed_method: 'thermal'
    });
  } catch (e) {
    console.error('Thermal printing error:', e);
    res.status(500).json({ 
      ok: false, 
      error: 'Thermal printing failed: ' + e.message 
    });
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
    if (typeof is_baptized !== "undefined" && is_baptized !== "All") {
      sql += ` AND is_baptized=@is_baptized`;
      params.is_baptized = Number(is_baptized);
    }
    if (typeof is_guardian !== "undefined" && is_guardian !== "All") {
      sql += ` AND is_guardian=@is_guardian`;
      params.is_guardian = Number(is_guardian);
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

    await autoPrint(file, process.env.THERMAL_PRINTER_NAME);
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

// Reset/truncate database — SUPER ONLY, DANGEROUS
app.post("/api/admin/reset-database", auth(true), requireSuper, (req, res) => {
  try {
    // Count records before deletion for confirmation
    const countStmt = db.prepare("SELECT COUNT(*) as count FROM campers");
    const { count } = countStmt.get();
    
    // Delete all camper records
    const deleteInfo = db.prepare("DELETE FROM campers").run();
    
    // Reset the auto-increment counter
    db.prepare("DELETE FROM sqlite_sequence WHERE name = 'campers'").run();
    
    console.log(`Database reset: ${deleteInfo.changes} campers deleted`);
    
    // Broadcast event to notify connected clients
    broadcastEvent('database:reset', { deletedCount: deleteInfo.changes });
    
    // Clear persisted teams_state directly via SQL (we expect this key to exist)
    const row = db.prepare("SELECT value FROM settings WHERE key = 'teams_state'").get();
    db.prepare("UPDATE settings SET value = '' WHERE key = 'teams_state'").run();
    broadcastEvent('teams:cleared', {});
    console.log('Cleared teams_state setting via SQL');
    
    res.json({ 
      ok: true, 
      deletedCount: deleteInfo.changes,
      message: `Database reset complete. ${deleteInfo.changes} records deleted.`
    });
  } catch (e) {
    console.error("Failed to reset database:", e);
    res.status(500).json({ ok: false, error: "Failed to reset database" });
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

// Non-destructive preview of what the reset will remove — SUPER ONLY
app.get('/api/admin/reset-preview', auth(true), requireSuper, (req, res) => {
  try {
    // DB counts
    const campersRow = db.prepare("SELECT COUNT(*) AS n FROM campers").get();
    const campersCount = campersRow ? campersRow.n : 0;
    const sessionsRow = db.prepare("SELECT COUNT(*) AS n FROM sessions").get();
    const sessionsCount = sessionsRow ? sessionsRow.n : 0;

    // settings value for teams_state
    const teamsState = getSetting('teams_state') || '';

    // Files in receipts and uploads
    const receiptsFiles = fs.existsSync(RECEIPTS_DIR) ? fs.readdirSync(RECEIPTS_DIR).filter(f => f) : [];
    const uploadsFiles = fs.existsSync(UPLOADS_DIR) ? fs.readdirSync(UPLOADS_DIR).filter(f => f) : [];

    res.json({
      ok: true,
      campersCount,
      sessionsCount,
      teamsStatePresent: !!teamsState,
      teamsStatePreview: teamsState ? (teamsState.length > 1000 ? teamsState.substring(0, 1000) + '...' : teamsState) : null,
      receipts: { count: receiptsFiles.length, sample: receiptsFiles.slice(0, 20) },
      uploads: { count: uploadsFiles.length, sample: uploadsFiles.slice(0, 20) }
    });
  } catch (e) {
    console.error('Reset preview failed:', e);
    res.status(500).json({ ok: false, error: 'Reset preview failed' });
  }
});
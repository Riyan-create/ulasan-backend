// server.js
// Backend sistem kartu review NFC/QR — redirect pintar + aktivasi + edit terkunci PIN
//
// Alur inti:
//   Tag NFC / QR kartu berisi URL tetap:  https://domainmu.com/k/A1B2C3
//   GET /k/:id  -> kalau kartu sudah aktif, redirect ke link Google Review-nya
//                  kalau belum aktif, redirect ke halaman aktivasi
//
// Jalankan:
//   npm install
//   cp .env.example .env   (isi semua nilainya, lihat README.md)
//   node server.js

const express = require("express");
const Database = require("better-sqlite3");
const bcrypt = require("bcrypt");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const morgan = require("morgan");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const PORT = process.env.PORT || 3000;
const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
const FORCE_HTTPS = process.env.FORCE_HTTPS === "true";

const db = new Database(path.join(__dirname, "ulasin.db"));
db.exec(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"));

// ---------- Email (untuk pemulihan PIN) ----------
const smtpConfigured = !!process.env.SMTP_HOST;
const mailer = smtpConfigured
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null;

async function sendResetEmail(toEmail, cardId, rawToken) {
  const link = `${BASE_URL}/reset-pin/${cardId}?token=${rawToken}`;
  if (!smtpConfigured) {
    console.log(`[dev] SMTP belum diset. Link reset PIN untuk ${cardId}: ${link}`);
    return;
  }
  await mailer.sendMail({
    from: process.env.SMTP_FROM || "Ulasin <no-reply@ulasin.id>",
    to: toEmail,
    subject: "Reset PIN kartu Ulasin kamu",
    text: `Klik link berikut untuk membuat PIN baru (berlaku 15 menit): ${link}\n\nKalau kamu tidak meminta ini, abaikan saja email ini.`,
  });
}

// ---------- App setup ----------
const app = express();
app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false, hsts: { maxAge: 31536000, includeSubDomains: true } }));
app.use(morgan("combined"));
app.use(express.json());
app.use(express.static(path.join(__dirname, "frontend")));

if (FORCE_HTTPS) {
  app.use((req, res, next) => {
    if (req.secure || req.headers["x-forwarded-proto"] === "https") return next();
    res.redirect(301, `https://${req.headers.host}${req.url}`);
  });
}

// ---------- Rate limiting ----------
const pinLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Terlalu banyak percobaan, coba lagi beberapa menit lagi." },
});
const forgotLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5 });

// ---------- Helper ----------
function getCard(id) {
  return db.prepare("SELECT * FROM cards WHERE id = ?").get(id);
}

function safeCard(card) {
  if (!card) return null;
  const { pin_hash, reset_token_hash, ...safe } = card;
  return safe;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PIN_RE = /^\d{4}$/;

function recentFailedAttempts(cardId) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM pin_attempts
       WHERE card_id = ? AND success = 0 AND attempted_at > datetime('now', '-10 minutes')`
    )
    .get(cardId);
  return row.n;
}

function logPinAttempt(cardId, success) {
  db.prepare("INSERT INTO pin_attempts (card_id, success) VALUES (?, ?)").run(cardId, success ? 1 : 0);
}

async function verifyPin(cardId, pin) {
  const card = getCard(cardId);
  if (!card || !card.pin_hash) return { ok: false, reason: "Kartu belum aktif" };
  if (recentFailedAttempts(cardId) >= 5) {
    return { ok: false, reason: "Terlalu banyak percobaan salah, tunggu 10 menit" };
  }
  const match = await bcrypt.compare(pin, card.pin_hash);
  logPinAttempt(cardId, match);
  return match ? { ok: true } : { ok: false, reason: "PIN salah" };
}

// MODE MANUAL (tanpa Google Places API): nama bisnis dan link review diisi
// sendiri oleh pemilik kartu, bukan hasil pencarian otomatis.
function sanitizeBusinessName(name) {
  if (!name || typeof name !== "string") return null;
  const trimmed = name.trim().replace(/[\r\n\t]+/g, " ");
  if (trimmed.length < 2 || trimmed.length > 100) return null;
  return trimmed;
}

function sanitizeReviewLink(link) {
  if (!link || typeof link !== "string") return null;
  const trimmed = link.trim();
  if (trimmed.length > 500) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

// ================= REDIRECT UTAMA (yang ditulis ke NFC/QR) =================
app.get("/k/:id", (req, res) => {
  const card = getCard(req.params.id);
  if (!card) return res.status(404).send("Kartu tidak dikenali.");
  if (card.status === "active" && card.review_link) {
    return res.redirect(302, card.review_link);
  }
  return res.redirect(302, `${BASE_URL}/aktivasi/${card.id}`);
});

// ================= HALAMAN AKTIVASI / KELOLA / RESET PIN =================
app.get(["/aktivasi/:id", "/kelola/:id"], (req, res) => {
  res.sendFile(path.join(__dirname, "frontend", "manage.html"));
});
app.get("/reset-pin/:id", (req, res) => {
  res.sendFile(path.join(__dirname, "frontend", "reset-pin.html"));
});

// ================= AKTIVASI =================
app.post("/api/cards/:id/activate", pinLimiter, async (req, res) => {
  const { id } = req.params;
  const { businessName, reviewLink, pin, ownerEmail } = req.body;

  const card = getCard(id);
  if (!card) return res.status(404).json({ ok: false, error: "Kartu tidak ditemukan" });
  if (card.status === "active") {
    return res.status(400).json({ ok: false, error: "Kartu sudah aktif, gunakan endpoint edit" });
  }
  if (!PIN_RE.test(pin || "")) {
    return res.status(400).json({ ok: false, error: "PIN harus 4 digit angka" });
  }
  if (!EMAIL_RE.test(ownerEmail || "")) {
    return res.status(400).json({ ok: false, error: "Email tidak valid — dipakai untuk pemulihan PIN nanti" });
  }
  const cleanName = sanitizeBusinessName(businessName);
  if (!cleanName) {
    return res.status(400).json({ ok: false, error: "Nama bisnis harus 2-100 karakter" });
  }
  const cleanLink = sanitizeReviewLink(reviewLink);
  if (!cleanLink) {
    return res.status(400).json({ ok: false, error: "Link review harus URL https:// yang valid" });
  }

  const pinHash = await bcrypt.hash(pin, 10);

  db.prepare(
    `UPDATE cards
     SET status = 'active', business_name = ?, review_link = ?, pin_hash = ?, owner_email = ?,
         activated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(cleanName, cleanLink, pinHash, ownerEmail.toLowerCase(), id);

  res.json({ ok: true, businessName: cleanName, reviewLink: cleanLink });
});

// ================= VERIFIKASI PIN =================
app.post("/api/cards/:id/verify-pin", pinLimiter, async (req, res) => {
  const result = await verifyPin(req.params.id, req.body.pin || "");
  res.status(result.ok ? 200 : 401).json(result);
});

// ================= EDIT (butuh PIN valid) =================
app.post("/api/cards/:id/edit", pinLimiter, async (req, res) => {
  const { id } = req.params;
  const { pin, businessName, reviewLink, newPin, ownerEmail } = req.body;

  const check = await verifyPin(id, pin || "");
  if (!check.ok) return res.status(401).json(check);

  const card = getCard(id);
  let finalName = card.business_name;
  let finalLink = card.review_link;

  if (businessName) {
    const cleanName = sanitizeBusinessName(businessName);
    if (!cleanName) return res.status(400).json({ ok: false, error: "Nama bisnis harus 2-100 karakter" });
    finalName = cleanName;
  }
  if (reviewLink) {
    const cleanLink = sanitizeReviewLink(reviewLink);
    if (!cleanLink) return res.status(400).json({ ok: false, error: "Link review harus URL https:// yang valid" });
    finalLink = cleanLink;
  }

  if (ownerEmail && !EMAIL_RE.test(ownerEmail)) {
    return res.status(400).json({ ok: false, error: "Email tidak valid" });
  }

  const nextPinHash = newPin && PIN_RE.test(newPin) ? await bcrypt.hash(newPin, 10) : card.pin_hash;
  const nextEmail = ownerEmail ? ownerEmail.toLowerCase() : card.owner_email;

  db.prepare(
    `UPDATE cards
     SET business_name = ?, review_link = ?, pin_hash = ?, owner_email = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(finalName, finalLink, nextPinHash, nextEmail, id);

  res.json({ ok: true, businessName: finalName, reviewLink: finalLink });
});

// ================= LUPA PIN =================
app.post("/api/cards/:id/forgot-pin", forgotLimiter, async (req, res) => {
  const { id } = req.params;
  const { email } = req.body;
  const generic = { ok: true, message: "Kalau email cocok dengan data kartu ini, link reset sudah dikirim." };

  const card = getCard(id);
  if (!card || card.status !== "active" || !card.owner_email || !EMAIL_RE.test(email || "")) {
    return res.json(generic);
  }
  if (email.toLowerCase() !== card.owner_email) return res.json(generic);

  const rawToken = crypto.randomBytes(24).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  db.prepare(`UPDATE cards SET reset_token_hash = ?, reset_token_expires = ? WHERE id = ?`).run(tokenHash, expires, id);

  try {
    await sendResetEmail(card.owner_email, id, rawToken);
  } catch (e) {
    console.error("Gagal kirim email reset:", e.message);
  }
  res.json(generic);
});

app.post("/api/cards/:id/reset-pin", pinLimiter, async (req, res) => {
  const { id } = req.params;
  const { token, newPin } = req.body;
  if (!PIN_RE.test(newPin || "")) return res.status(400).json({ ok: false, error: "PIN harus 4 digit angka" });

  const card = getCard(id);
  if (!card || !card.reset_token_hash || !card.reset_token_expires) {
    return res.status(400).json({ ok: false, error: "Link reset tidak valid" });
  }
  if (new Date(card.reset_token_expires).getTime() < Date.now()) {
    return res.status(400).json({ ok: false, error: "Link reset sudah kedaluwarsa, minta ulang" });
  }
  const tokenHash = crypto.createHash("sha256").update(token || "").digest("hex");
  if (tokenHash !== card.reset_token_hash) {
    return res.status(400).json({ ok: false, error: "Link reset tidak valid" });
  }

  const pinHash = await bcrypt.hash(newPin, 10);
  db.prepare(
    `UPDATE cards SET pin_hash = ?, reset_token_hash = NULL, reset_token_expires = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(pinHash, id);

  res.json({ ok: true });
});

// ================= INFO KARTU =================
app.get("/api/cards/:id", (req, res) => {
  const card = getCard(req.params.id);
  if (!card) return res.status(404).json({ ok: false, error: "Kartu tidak ditemukan" });
  res.json({ ok: true, card: safeCard(card) });
});

// ================= ADMIN (lihat semua kartu) =================
app.get("/api/admin/cards", (req, res) => {
  if (!ADMIN_API_KEY || req.headers["x-admin-key"] !== ADMIN_API_KEY) {
    return res.status(401).json({ ok: false, error: "Tidak diizinkan" });
  }
  const rows = db.prepare("SELECT * FROM cards ORDER BY created_at DESC").all();
  res.json({ ok: true, cards: rows.map(safeCard) });
});

app.listen(PORT, () => {
  console.log(`Ulasin backend jalan di http://localhost:${PORT}`);
  console.log(`Contoh redirect kartu: http://localhost:${PORT}/k/A1B2C3`);
  if (!smtpConfigured) console.log("SMTP belum dikonfigurasi — link reset PIN akan dicetak ke console ini.");
});

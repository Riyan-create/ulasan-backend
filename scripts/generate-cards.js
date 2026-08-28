// scripts/generate-cards.js
// Bikin banyak kartu kosong sekaligus: ID unik + baris database + file QR code
// yang PASTI cocok dengan ID tersimpan (tidak ada proses tempel-manual yang rawan salah).
//
// Pemakaian:
//   node scripts/generate-cards.js 50
//   (menghasilkan 50 kartu baru)

const Database = require("better-sqlite3");
const QRCode = require("qrcode");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const COUNT = parseInt(process.argv[2] || "10", 10);
const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");

// Alfabet tanpa karakter yang gampang ketuker (tanpa 0/O, 1/I/l)
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function randomId(len = 6) {
  return Array.from(crypto.randomBytes(len))
    .map((b) => ALPHABET[b % ALPHABET.length])
    .join("");
}

async function main() {
  const db = new Database(path.join(__dirname, "..", "ulasin.db"));
  db.exec(fs.readFileSync(path.join(__dirname, "..", "schema.sql"), "utf8"));

  const outDir = path.join(__dirname, "..", "output");
  const qrDir = path.join(outDir, "qrcodes");
  fs.mkdirSync(qrDir, { recursive: true });

  const exists = db.prepare("SELECT 1 FROM cards WHERE id = ?");
  const insert = db.prepare("INSERT INTO cards (id, status) VALUES (?, 'inactive')");

  const rows = [];
  for (let i = 0; i < COUNT; i++) {
    let id;
    do { id = randomId(); } while (exists.get(id));
    insert.run(id);

    const url = `${BASE_URL}/k/${id}`;
    const qrPath = path.join(qrDir, `${id}.png`);
    await QRCode.toFile(qrPath, url, { width: 600, margin: 2 });

    rows.push({ id, url, qrPath: path.relative(outDir, qrPath) });
    console.log(`✓ ${id}  ->  ${url}`);
  }

  const csvPath = path.join(outDir, "cards.csv");
  const isNewFile = !fs.existsSync(csvPath);
  const csvLines = rows.map((r) => `${r.id},${r.url},${r.qrPath}`);
  fs.writeFileSync(
    csvPath,
    (isNewFile ? "id,url,qr_file\n" : "") + csvLines.join("\n") + "\n",
    { flag: "a" }
  );

  console.log(`\n${COUNT} kartu baru dibuat.`);
  console.log(`QR code: ${qrDir}`);
  console.log(`Daftar lengkap: ${csvPath}`);
  console.log(`\nSelanjutnya: kirim file-file di output/qrcodes/ ke percetakan, dan tulis`);
  console.log(`URL yang sama (kolom "url" di cards.csv) ke chip NFC tiap kartu.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

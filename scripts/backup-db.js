// scripts/backup-db.js
// Backup sederhana: salin ulasin.db ke folder backups/ dengan nama bertanggal.
// Jalankan manual, atau jadwalkan lewat cron (lihat README.md).
//
// Pemakaian: node scripts/backup-db.js

const fs = require("fs");
const path = require("path");

const src = path.join(__dirname, "..", "ulasin.db");
const backupDir = path.join(__dirname, "..", "backups");

if (!fs.existsSync(src)) {
  console.error("ulasin.db belum ada — jalankan server dulu setidaknya sekali.");
  process.exit(1);
}

fs.mkdirSync(backupDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const dest = path.join(backupDir, `ulasin-${stamp}.db`);
fs.copyFileSync(src, dest);

console.log(`Backup tersimpan: ${dest}`);

// Bersihkan backup lama, simpan 30 file terbaru saja
const files = fs
  .readdirSync(backupDir)
  .filter((f) => f.startsWith("ulasin-") && f.endsWith(".db"))
  .sort();
const excess = files.length - 30;
if (excess > 0) {
  files.slice(0, excess).forEach((f) => fs.unlinkSync(path.join(backupDir, f)));
  console.log(`Menghapus ${excess} backup lama, menyisakan 30 terbaru.`);
}

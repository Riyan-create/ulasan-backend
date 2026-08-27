-- Skema database untuk sistem kartu review NFC/QR
-- Cocok untuk SQLite (dipakai server.js) — tinggal sesuaikan tipe data kalau pindah ke Postgres/MySQL

CREATE TABLE IF NOT EXISTS cards (
  id                   TEXT PRIMARY KEY,           -- kode unik kartu, ditulis ke chip NFC & QR (mis. 'A1B2C3')
  status               TEXT NOT NULL DEFAULT 'inactive',  -- 'inactive' | 'active'
  business_name        TEXT,                       -- SELALU diisi dari hasil verifikasi Google, bukan input bebas
  place_id             TEXT,                        -- Google Place ID, diverifikasi server sebelum disimpan
  review_link          TEXT,                        -- link review Google yang sudah jadi, hasil dari place_id
  pin_hash             TEXT,                        -- HASH PIN (bcrypt) — jangan pernah simpan PIN mentah
  owner_email          TEXT,                        -- untuk verifikasi & jalur lupa-PIN
  reset_token_hash     TEXT,                        -- hash token reset PIN yang sedang aktif (jika ada)
  reset_token_expires  TIMESTAMP,                   -- kedaluwarsa token reset (15 menit dari dibuat)
  created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  activated_at         TIMESTAMP,
  updated_at           TIMESTAMP
);

-- Log percobaan PIN, dipakai untuk rate limiting sederhana (cegah brute force PIN 4 digit)
CREATE TABLE IF NOT EXISTS pin_attempts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id     TEXT NOT NULL,
  success     INTEGER NOT NULL DEFAULT 0,
  attempted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pin_attempts_card_time
  ON pin_attempts (card_id, attempted_at);

-- Contoh mengisi kartu kosong sebelum dijual/dipasang tag NFC-nya
-- (biasanya dilakukan lewat scripts/generate-cards.js, bukan manual)
-- INSERT INTO cards (id, status) VALUES ('A1B2C3', 'inactive');

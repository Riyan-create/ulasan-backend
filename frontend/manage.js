      // manage.js — dipakai untuk /aktivasi/:id maupun /kelola/:id
// Semua data diambil/dikirim lewat fetch() ke backend. Nama bisnis dan link
// review diisi manual oleh pemilik kartu (tanpa Google Places API), dan
// semua teks dinamis di-escape sebelum dirender untuk mencegah XSS.

const app = document.getElementById("app");
const cardId = window.location.pathname.split("/").filter(Boolean).pop();

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

const state = {
  card: null,
  businessName: "",
  reviewLink: "",
  email: "",
  pin: "",
  pinConfirm: "",
  newPin: "",
  error: "",
  mode: "loading",
};

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.reason || "Terjadi kesalahan");
  return data;
}

async function loadCard() {
  try {
    const data = await api(`/api/cards/${cardId}`);
    state.card = data.card;
    state.mode = data.card.status === "active" ? "active-summary" : "activate-search";
  } catch (e) {
    state.mode = "notfound";
  }
  render();
}

// ---------- PIN pad ----------
function pinPadHTML(value, max = 4) {
  const dots = Array.from({ length: max })
    .map((_, i) => `<span class="pin-dot ${i < value.length ? "filled" : ""}"></span>`)
    .join("");
  const keys = ["1","2","3","4","5","6","7","8","9","","0","del"]
    .map((k) => {
      if (k === "") return `<div></div>`;
      if (k === "del") return `<button type="button" class="pin-key pin-key-del" data-key="del">⌫</button>`;
      return `<button type="button" class="pin-key" data-key="${k}">${k}</button>`;
    })
    .join("");
  return `<div class="pin-dots">${dots}</div><div class="pin-grid">${keys}</div>`;
}

function bindPinPad(container, getValue, setValue, onComplete, max = 4) {
  container.querySelectorAll(".pin-key").forEach((btn) => {
    btn.addEventListener("click", () => {
      let v = getValue();
      const key = btn.dataset.key;
      if (key === "del") v = v.slice(0, -1);
      else if (v.length < max) v += key;
      setValue(v);
      if (v.length === max && onComplete) onComplete(v);
    });
  });
}

// ---------- Render ----------
function render() {
  if (state.mode === "loading") {
    app.innerHTML = `<p class="sub center">Memuat kartu…</p>`;
    return;
  }

  if (state.mode === "notfound") {
    app.innerHTML = `
      <p class="card-id">#${escapeHtml(cardId)}</p>
      <h1>Kartu tidak dikenali</h1>
      <p class="sub">Kode kartu ini belum terdaftar di sistem. Hubungi penjual kartunya.</p>`;
    return;
  }

  if (state.mode === "activate-search") {
    app.innerHTML = `
      <p class="card-id">#${escapeHtml(cardId)}</p>
      <div class="step-dots"><span class="step-dot done"></span><span class="step-dot"></span><span class="step-dot"></span></div>
      <h1>Kartu belum aktif</h1>
      <p class="sub">Isi nama bisnis kamu dan link review Google-nya.</p>
      ${state.error ? `<div class="error-text">${escapeHtml(state.error)}</div>` : ""}
      <div class="search-box" style="margin-bottom:10px"><input id="name" placeholder="Nama bisnis" autofocus value="${escapeHtml(state.businessName)}" /></div>
      <div class="search-box"><input id="link" placeholder="Link review Google (https://...)" value="${escapeHtml(state.reviewLink)}" /></div>
      <p class="footnote" style="margin-top:10px;text-align:left">
        Belum punya link-nya? Buka Google Maps, cari bisnis kamu, tekan "Share"/Bagikan.
        Atau lewat business.google.com &gt; menu "Get more reviews" untuk link yang langsung buka kotak bintang.
      </p>
      <button class="btn-primary" id="next" style="margin-top:14px">Lanjut</button>
    `;
    document.getElementById("next").addEventListener("click", () => {
      const name = document.getElementById("name").value.trim();
      const link = document.getElementById("link").value.trim();
      if (name.length < 2) { state.error = "Nama bisnis minimal 2 karakter"; render(); return; }
      if (!/^https:\/\//.test(link)) { state.error = "Link harus diawali https://"; render(); return; }
      state.businessName = name;
      state.reviewLink = link;
      state.error = "";
      state.mode = "activate-email";
      render();
    });
    return;
  }

  if (state.mode === "activate-email") {
    app.innerHTML = `
      <p class="card-id">#${escapeHtml(cardId)}</p>
      <div class="step-dots"><span class="step-dot done"></span><span class="step-dot done"></span><span class="step-dot"></span></div>
      <h1>Email pemilik bisnis</h1>
      <p class="sub">Dipakai kalau nanti kamu lupa PIN — bukan untuk promosi apa pun.</p>
      ${state.error ? `<div class="error-text">${escapeHtml(state.error)}</div>` : ""}
      <div class="search-box"><input id="email" type="email" placeholder="nama@email.com" value="${escapeHtml(state.email)}" /></div>
      <button class="btn-primary" id="next" style="margin-top:14px">Lanjut ke PIN</button>
      <button class="btn-ghost" id="back">← Kembali</button>
    `;
    document.getElementById("back").addEventListener("click", () => { state.mode = "activate-search"; render(); });
    document.getElementById("next").addEventListener("click", () => {
      const email = document.getElementById("email").value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        state.error = "Masukkan email yang valid";
        render();
        return;
      }
      state.email = email;
      state.error = "";
      state.pin = "";
      state.pinConfirm = "";
      state.mode = "activate-pin";
      render();
    });
    return;
  }

  if (state.mode === "activate-pin") {
    const creating = state.pin.length < 4;
    app.innerHTML = `
      <p class="card-id">#${escapeHtml(cardId)}</p>
      <div class="step-dots"><span class="step-dot done"></span><span class="step-dot done"></span><span class="step-dot done"></span></div>
      <h1>${creating ? "Buat PIN 4 digit" : "Ulangi PIN"}</h1>
      <p class="sub">${creating ? "Dipakai untuk edit kartu ini nanti. Simpan baik-baik." : "Masukkan sekali lagi untuk konfirmasi."}</p>
      ${state.error ? `<div class="error-text">${escapeHtml(state.error)}</div>` : ""}
      <div id="pad">${pinPadHTML(creating ? state.pin : state.pinConfirm)}</div>
    `;
    const pad = document.getElementById("pad");
    if (creating) {
      bindPinPad(pad, () => state.pin, (v) => { state.pin = v; render(); }, () => { state.error = ""; render(); });
    } else {
      bindPinPad(pad, () => state.pinConfirm, (v) => { state.pinConfirm = v; }, async (v) => {
        if (v !== state.pin) {
          state.error = "PIN tidak sama, coba lagi";
          state.pinConfirm = "";
          render();
          return;
        }
        try {
          const data = await api(`/api/cards/${cardId}/activate`, {
            method: "POST",
            body: JSON.stringify({ businessName: state.businessName, reviewLink: state.reviewLink, pin: state.pin, ownerEmail: state.email }),
          });
          state.card = { ...state.card, status: "active", business_name: data.businessName, review_link: data.reviewLink };
          state.mode = "activate-done";
          render();
        } catch (e) {
          state.error = e.message;
          state.pin = "";
          state.pinConfirm = "";
          state.mode = "activate-pin";
          render();
        }
      });
    }
    return;
  }

  if (state.mode === "activate-done") {
    app.innerHTML = `
      <div class="center">
        <div class="check-circle">✓</div>
        <h1>Kartu aktif</h1>
        <p class="sub">#${escapeHtml(cardId)} sekarang tersambung ke halaman review<br><b>${escapeHtml(state.card.business_name)}</b>.</p>
        <p class="footnote">Tap ulang kartu ini kapan saja untuk langsung menuju halaman review Google.</p>
      </div>`;
    return;
  }

  if (state.mode === "active-summary") {
    app.innerHTML = `
      <p class="card-id">#${escapeHtml(cardId)}</p>
      <span class="status-pill">Aktif</span>
      <h1>${escapeHtml(state.card.business_name)}</h1>
      <p class="sub">Kartu ini tersambung ke halaman review Google bisnis kamu.</p>
      <a class="btn-primary" style="display:block;text-align:center;text-decoration:none;box-sizing:border-box" href="${escapeHtml(state.card.review_link)}" target="_blank" rel="noopener">Buka halaman review</a>
      <button class="btn-ghost" id="editBtn">✎ Edit data kartu</button>
    `;
    document.getElementById("editBtn").addEventListener("click", () => {
      state.mode = "edit-verify";
      state.pin = "";
      state.error = "";
      render();
    });
    return;
  }

  if (state.mode === "edit-verify") {
    app.innerHTML = `
      <p class="card-id">#${escapeHtml(cardId)}</p>
      <h1>Masukkan PIN</h1>
      <p class="sub">Diperlukan untuk mengubah data kartu ini.</p>
      ${state.error ? `<div class="error-text">${escapeHtml(state.error)}</div>` : ""}
      <div id="pad">${pinPadHTML(state.pin)}</div>
      <button class="btn-ghost" id="forgot">Lupa PIN?</button>
      <button class="btn-ghost" id="back">← Batal</button>
    `;
    const pad = document.getElementById("pad");
    bindPinPad(pad, () => state.pin, (v) => { state.pin = v; }, async (v) => {
      try {
        await api(`/api/cards/${cardId}/verify-pin`, { method: "POST", body: JSON.stringify({ pin: v }) });
        state.mode = "edit-form";
        state.newPin = "";
        render();
      } catch (e) {
        state.error = e.message || "PIN salah";
        state.pin = "";
        render();
      }
    });
    document.getElementById("back").addEventListener("click", () => { state.mode = "active-summary"; render(); });
    document.getElementById("forgot").addEventListener("click", () => {
      window.location.href = `/reset-pin/${cardId}`;
    });
    return;
  }

  if (state.mode === "edit-form") {
    app.innerHTML = `
      <p class="card-id">#${escapeHtml(cardId)}</p>
      <h1>Edit data kartu</h1>
      <p class="sub">Ubah nama bisnis, link review, atau buat PIN baru (opsional).</p>
      ${state.error ? `<div class="error-text">${escapeHtml(state.error)}</div>` : ""}
      <div class="search-box" style="margin-bottom:10px"><input id="name" placeholder="Nama bisnis" value="${escapeHtml(state.card.business_name || "")}" /></div>
      <div class="search-box"><input id="link" placeholder="Link review Google" value="${escapeHtml(state.card.review_link || "")}" /></div>
      <p class="sub" style="margin-top:14px;margin-bottom:6px">PIN baru (kosongkan jika tidak diganti)</p>
      <div id="pad">${pinPadHTML(state.newPin || "")}</div>
      <button class="btn-primary" id="save">Simpan perubahan</button>
      <button class="btn-ghost" id="cancel">← Batal</button>
    `;
    const pad = document.getElementById("pad");
    bindPinPad(pad, () => state.newPin || "", (v) => { state.newPin = v; render(); });
    document.getElementById("cancel").addEventListener("click", () => { state.mode = "active-summary"; render(); });
    document.getElementById("save").addEventListener("click", async () => {
      const name = document.getElementById("name").value.trim();
      const link = document.getElementById("link").value.trim();
      if (name.length < 2) { state.error = "Nama bisnis minimal 2 karakter"; render(); return; }
      if (!/^https:\/\//.test(link)) { state.error = "Link harus diawali https://"; render(); return; }
      try {
        const body = { pin: state.pin, businessName: name, reviewLink: link };
        if (state.newPin && state.newPin.length === 4) body.newPin = state.newPin;
        const data = await api(`/api/cards/${cardId}/edit`, { method: "POST", body: JSON.stringify(body) });
        state.card = { ...state.card, business_name: data.businessName, review_link: data.reviewLink };
        state.mode = "edit-done";
        render();
      } catch (e) {
        state.error = e.message;
        render();
      }
    });
    return;
  }

  if (state.mode === "edit-done") {
    app.innerHTML = `
      <div class="center">
        <div class="check-circle">✓</div>
        <h1>Perubahan disimpan</h1>
        <p class="sub">Kartu #${escapeHtml(cardId)} sekarang tersambung ke<br><b>${escapeHtml(state.card.business_name)}</b>.</p>
        <button class="btn-primary" id="ok">Selesai</button>
      </div>`;
    document.getElementById("ok").addEventListener("click", () => { state.mode = "active-summary"; render(); });
    return;
  }
}

loadCard();

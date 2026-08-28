// reset-pin.js
// Tanpa ?token= di URL -> tahap 1: minta email, kirim link reset.
// Dengan ?token= di URL -> tahap 2: buat PIN baru.

const app = document.getElementById("app");
const cardId = window.location.pathname.split("/").filter(Boolean).pop();
const token = new URLSearchParams(window.location.search).get("token");

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Terjadi kesalahan");
  return data;
}

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

if (!token) {
  // Tahap 1: minta email
  app.innerHTML = `
    <p class="card-id">#${escapeHtml(cardId)}</p>
    <h1>Lupa PIN?</h1>
    <p class="sub">Masukkan email yang dipakai saat aktivasi kartu ini. Kami kirim link reset ke sana.</p>
    <div id="msg"></div>
    <div class="search-box"><input id="email" type="email" placeholder="nama@email.com" /></div>
    <button class="btn-primary" id="send" style="margin-top:14px">Kirim link reset</button>
  `;
  document.getElementById("send").addEventListener("click", async () => {
    const email = document.getElementById("email").value.trim();
    const msg = document.getElementById("msg");
    try {
      const data = await api(`/api/cards/${cardId}/forgot-pin`, { method: "POST", body: JSON.stringify({ email }) });
      msg.innerHTML = `<p class="sub" style="color:var(--green-deep)">${escapeHtml(data.message)}</p>`;
    } catch (e) {
      msg.innerHTML = `<div class="error-text">${escapeHtml(e.message)}</div>`;
    }
  });
} else {
  // Tahap 2: buat PIN baru
  let pin = "";
  let pinConfirm = "";
  let stage = "new"; // new | confirm | done
  let error = "";

  function render() {
    if (stage === "done") {
      app.innerHTML = `
        <div class="center">
          <div class="check-circle">✓</div>
          <h1>PIN baru tersimpan</h1>
          <p class="sub">Silakan kembali dan masuk pakai PIN barumu.</p>
          <a class="btn-primary" style="display:block;text-align:center;text-decoration:none;box-sizing:border-box" href="/kelola/${escapeHtml(cardId)}">Kembali ke kartu</a>
        </div>`;
      return;
    }
    const creating = stage === "new";
    app.innerHTML = `
      <p class="card-id">#${escapeHtml(cardId)}</p>
      <h1>${creating ? "Buat PIN baru" : "Ulangi PIN baru"}</h1>
      <p class="sub">${creating ? "Pilih PIN 4 digit yang baru." : "Masukkan sekali lagi untuk konfirmasi."}</p>
      ${error ? `<div class="error-text">${escapeHtml(error)}</div>` : ""}
      <div id="pad">${pinPadHTML(creating ? pin : pinConfirm)}</div>
    `;
    const pad = document.getElementById("pad");
    if (creating) {
      bindPinPad(pad, () => pin, (v) => { pin = v; render(); }, () => { stage = "confirm"; error = ""; render(); });
    } else {
      bindPinPad(pad, () => pinConfirm, (v) => { pinConfirm = v; }, async (v) => {
        if (v !== pin) {
          error = "PIN tidak sama, coba lagi";
          pinConfirm = "";
          render();
          return;
        }
        try {
          await api(`/api/cards/${cardId}/reset-pin`, { method: "POST", body: JSON.stringify({ token, newPin: pin }) });
          stage = "done";
          render();
        } catch (e) {
          error = e.message;
          stage = "new";
          pin = "";
          pinConfirm = "";
          render();
        }
      });
    }
  }
  render();
                               }

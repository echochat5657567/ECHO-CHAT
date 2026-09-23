const GIFS = Array.isArray(window.SSML_GIFS) ? window.SSML_GIFS : [];

let socket = null;

function connectSocket(){
  if (socket || typeof window.io !== "function") return false;

  socket = window.io();

  socket.on("connect", () => {
    if (token) socket.emit("identify", token);
  });

  socket.on("history", list => {
    messages.innerHTML = "";
    list.forEach(renderMessage);
  });

  socket.on("message", m => {
    renderMessage(m);
    if (m.username !== currentUser?.username) {
      notificationSound.currentTime = 0;
      notificationSound.play().catch(() => {});
      if ($("notifyToggle").checked && Notification?.permission === "granted" && document.hidden) {
        new Notification(`${m.username} in SSML`, { body: m.text || "sent a GIF or file" });
      }
    }
  });

  socket.on("system-message", data => addSystem(data.text, data.kind));

  socket.on("history-cleaned", () => {
    addSystem("10 messages have been deleted to prevent lag :)");
  });

  socket.on("reaction", data => rebuildReactions(data.messageId, data.username, data.gif));
  socket.on("chat-error", showToast);

  socket.on("bot-sound", () => {
    notificationSound.currentTime = 0;
    notificationSound.play().catch(() => {});
  });

  socket.on("history-cleared", () => {
    messages.innerHTML = "";
    addSystem("Chat history cleared.");
  });

  socket.on("command-list", commands => {
    addSystem(commands.join("   •   "), "moderation");
  });

  return true;
}

let token = localStorage.getItem("ssml_token") || "";
let currentUser = null;
let authMode = "login";
let selectedGif = "";
let devUnlocked = false;

const $ = (id) => document.getElementById(id);
const messages = $("messages");
const input = $("messageInput");
const gifPicker = $("gifPicker");
const toast = $("toast");
const bgMusic = $("bgMusic");
const notificationSound = $("notificationSound");

function showToast(text) {
  toast.textContent = text;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2300);
}

function setAuthError(text) {
  $("authError").textContent = text || "";
}

function avatarStyle(url) {
  return url ? `background-image:url("${url}")` : "";
}

function escapeText(text) {
  return String(text).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

function glowLetters(text) {
  return escapeText(text).split("").map(c => c === " " ? " " : `<span class="letter">${c}</span>`).join("");
}

function renderMessage(m) {
  const row = document.createElement("article");
  row.className = "message" + (m.bot ? " bot" : "");
  row.dataset.id = m.id;

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.style = avatarStyle(m.avatar);

  const main = document.createElement("div");
  main.className = "message-main";

  const meta = document.createElement("div");
  meta.className = "message-meta";

  const name = document.createElement("span");
  name.className = "username" + (m.staff ? " staff" : "");
  name.textContent = m.username;

  meta.appendChild(name);
  if (m.staff) {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = "STAFF!";
    meta.appendChild(badge);
  }

  const react = document.createElement("button");
  react.className = "react-btn";
  react.textContent = "＋ GIF";
  react.onclick = () => openReactionPicker(m.id);
  meta.appendChild(react);

  main.appendChild(meta);

  if (m.text) {
    const text = document.createElement("div");
    text.className = "message-text";
    text.innerHTML = glowLetters(m.text);
    main.appendChild(text);
  }

  if (m.gif) {
    const img = document.createElement("img");
    img.className = "message-gif";
    img.src = m.gif;
    img.alt = "GIF";
    main.appendChild(img);
  }

  if (m.attachment?.url) {
    if (m.attachment.type?.startsWith("video/")) {
      const video = document.createElement("video");
      video.className = "attachment";
      video.controls = true;
      video.src = m.attachment.url;
      main.appendChild(video);
    } else {
      const img = document.createElement("img");
      img.className = "attachment";
      img.src = m.attachment.url;
      img.alt = m.attachment.name || "upload";
      main.appendChild(img);
    }
  }

  const reactions = document.createElement("div");
  reactions.className = "reactions";
  if (m.reactions) {
    Object.entries(m.reactions).forEach(([user, gif]) => {
      const r = document.createElement("button");
      r.className = "reaction";
      r.title = user;
      r.innerHTML = `<img src="${gif}" alt="reaction">`;
      r.onclick = () => { if (socket) socket.emit("react", { messageId: m.id, gif }); };
      reactions.appendChild(r);
    });
  }
  main.appendChild(reactions);

  row.append(avatar, main);
  messages.appendChild(row);
  messages.scrollTop = messages.scrollHeight;
}

function addSystem(text, kind = "") {
  const row = document.createElement("div");
  row.className = `system ${kind}`;
  row.textContent = text;
  messages.appendChild(row);
  messages.scrollTop = messages.scrollHeight;
}

function rebuildReactions(messageId, username, gif) {
  const row = messages.querySelector(`[data-id="${CSS.escape(messageId)}"]`);
  if (!row) return;
  let box = row.querySelector(".reactions");
  if (!box) return;
  const r = document.createElement("button");
  r.className = "reaction";
  r.title = username;
  r.innerHTML = `<img src="${gif}" alt="reaction">`;
  r.onclick = () => { if (socket) socket.emit("react", { messageId, gif }); };
  box.appendChild(r);
}

function populateGifPicker() {
  gifPicker.innerHTML = "";
  GIFS.forEach(g => {
    const img = document.createElement("img");
    img.className = "gif-choice";
    img.src = g.url;
    img.title = g.name;
    img.onclick = () => {
      selectedGif = g.url;
      gifPicker.classList.remove("open");
      showToast(`${g.name} attached`);
    };
    gifPicker.appendChild(img);
  });
}

function openReactionPicker(messageId) {
  const old = document.querySelector(".reaction-picker");
  if (old) old.remove();

  const box = document.createElement("div");
  box.className = "reaction-picker";
  box.style.cssText = "position:fixed;z-index:80;display:flex;gap:5px;padding:8px;background:#09090f;border:1px solid #6043aa;border-radius:12px;box-shadow:0 0 25px #4b2d88;";
  GIFS.forEach(g => {
    const img = document.createElement("img");
    img.src = g.url;
    img.style.cssText = "width:50px;height:50px;object-fit:cover;border-radius:7px;cursor:pointer";
    img.onclick = () => {
      if (socket) socket.emit("react", { messageId, gif: g.url });
      box.remove();
    };
    box.appendChild(img);
  });
  document.body.appendChild(box);
  const row = messages.querySelector(`[data-id="${CSS.escape(messageId)}"]`);
  const rect = row?.getBoundingClientRect();
  if (rect) {
    box.style.left = `${Math.min(rect.left, innerWidth - 260)}px`;
    box.style.top = `${Math.max(10, rect.bottom - 60)}px`;
  }
}

async function api(url, options = {}) {
  options.headers ||= {};
  if (token) options.headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(url, options);
  } catch {
    throw new Error("The SSML server is offline. Run npm start, then open http://localhost:3000");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function boot() {
  populateGifPicker();

  if (!token) {
    $("authScreen").classList.remove("hidden");
    return;
  }

  try {
    const data = await api("/api/me");
    currentUser = data.user;
    finishAuth();
  } catch {
    token = "";
    localStorage.removeItem("ssml_token");
    $("authScreen").classList.remove("hidden");
  }
}

function finishAuth() {
  const connected = connectSocket();
  $("authScreen").classList.add("hidden");
  $("myProfileBtn").style = avatarStyle(currentUser.avatar);
  if (!connected && typeof window.io !== "function") {
    showToast("Chat connection script is unavailable. Refresh the page from the server.");
  }
}

document.querySelectorAll(".auth-tabs button").forEach(btn => {
  btn.onclick = () => {
    authMode = btn.dataset.mode;
    document.querySelectorAll(".auth-tabs button").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    $("authSubmit").textContent = authMode === "login" ? "ENTER CHAT" : "CREATE ACCOUNT";
    setAuthError("");
  };
});

$("authSubmit").onclick = async () => {
  setAuthError("");
  try {
    const endpoint = authMode === "login" ? "/api/auth/login" : "/api/auth/register";
    const data = await api(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: $("authUsername").value,
        password: $("authPassword").value
      })
    });
    token = data.token;
    localStorage.setItem("ssml_token", token);
    currentUser = data.user;
    finishAuth();
  } catch (e) {
    setAuthError(e.message);
  }
};

$("messageInput").addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 120) + "px";
});

$("composer").onsubmit = e => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text && !selectedGif) return;

  if (text.startsWith("/") && currentUser?.staff) {
    if (socket) socket.emit("dev-command", { command: text });
    input.value = "";
    input.style.height = "auto";
    return;
  }

  if (socket) socket.emit("send-message", { text, gif: selectedGif });
  input.value = "";
  input.style.height = "auto";
  selectedGif = "";
};

$("gifBtn").onclick = () => gifPicker.classList.toggle("open");
$("uploadBtn").onclick = () => $("fileInput").click();

$("fileInput").onchange = async () => {
  const file = $("fileInput").files[0];
  if (!file) return;
  try {
    const form = new FormData();
    form.append("file", file);
    const data = await api("/api/upload", { method: "POST", body: form });
    if (socket) socket.emit("send-message", {
      text: "",
      attachment: { url: data.url, name: data.name, type: data.type }
    });
  } catch (e) {
    showToast(e.message);
  }
};

$("myProfileBtn").onclick = () => openProfile(currentUser);
$("settingsBtn").onclick = () => $("settingsModal").classList.remove("hidden");

function openProfile(user) {
  $("profileBanner").style.backgroundImage = user.banner ? `url("${user.banner}")` : "";
  $("profileAvatar").style.backgroundImage = user.avatar ? `url("${user.avatar}")` : "";
  $("profileName").textContent = user.username;
  $("profileBadge").classList.toggle("hidden", !user.staff);

  $("profileImages").innerHTML = "";
  const profileImages = window.SSML_PROFILE_CONFIG?.images || [];
  profileImages.forEach(url => {
    const img = document.createElement("img");
    img.src = url;
    $("profileImages").appendChild(img);
  });

  const actions = $("profileActions");
  actions.innerHTML = "";
  if (currentUser && currentUser.username.toLowerCase() === user.username.toLowerCase()) {
    const edit = document.createElement("button");
    edit.className = "primary-btn";
    edit.textContent = "EDIT PROFILE";
    edit.onclick = () => {
      $("profileModal").classList.add("hidden");
      $("editModal").classList.remove("hidden");
      $("editAvatar").value = user.avatar || "";
      $("editBanner").value = user.banner || "";
    };
    actions.appendChild(edit);
  }
  $("profileModal").classList.remove("hidden");
}

document.querySelectorAll("[data-close]").forEach(btn => {
  btn.onclick = () => $(btn.dataset.close).classList.add("hidden");
});

$("saveProfileBtn").onclick = async () => {
  try {
    const data = await api("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ avatar: $("editAvatar").value, banner: $("editBanner").value })
    });
    currentUser = data.user;
    $("myProfileBtn").style = avatarStyle(currentUser.avatar);
    $("editModal").classList.add("hidden");
    showToast("Profile saved.");
  } catch (e) { showToast(e.message); }
};

$("logoutBtn").onclick = () => {
  token = "";
  currentUser = null;
  localStorage.removeItem("ssml_token");
  location.reload();
};

$("volumeRange").oninput = () => {
  const v = Number($("volumeRange").value) / 100;
  bgMusic.volume = v;
  notificationSound.volume = v;
};

$("musicToggle").onchange = () => {
  if ($("musicToggle").checked) bgMusic.play().catch(() => {});
  else bgMusic.pause();
};

$("soundBtn").onclick = () => {
  bgMusic.play().catch(() => {});
  showToast("Sound enabled.");
};

$("notifyToggle").onchange = async () => {
  if ($("notifyToggle").checked && Notification?.permission === "default")
    await Notification.requestPermission();
};

window.addEventListener("keydown", e => {
  if (e.ctrlKey && e.key.toLowerCase() === "p") {
    e.preventDefault();
    if (!currentUser?.staff) return showToast("Access denied.");
    $("devModal").classList.remove("hidden");
  }
});

$("devUnlock").onclick = () => {
  if ($("devPassword").value !== "Dev-team") {
    showToast("Invalid developer password.");
    return;
  }
  devUnlocked = true;
  $("devWelcome").textContent = `WELCOME ${currentUser.username.toUpperCase()} TO DEV-TEAM PANEL`;
  setTimeout(() => {
    $("devModal").classList.add("hidden");
    $("commandBar").classList.remove("hidden");
    $("commandInput").focus();
  }, 1500);
};

$("commandInput").addEventListener("keydown", e => {
  if (e.key === "Enter") {
    if (socket) socket.emit("dev-command", { command: e.target.value });
    e.target.value = "";
    setTimeout(() => $("commandBar").classList.add("hidden"), 3000);
  }
});

boot();

const authCard = document.querySelector(".auth-card");
if (authCard) {
  authCard.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      $("authSubmit").click();
    }
  });
}
window.addEventListener("error", (e) => {
  const box = $("startupError");
  if (box) box.textContent = "Chat script error: " + (e.message || "unknown error");
});
window.addEventListener("unhandledrejection", (e) => {
  const box = $("startupError");
  if (box) box.textContent = "Chat script error: " + (e.reason?.message || e.reason || "unknown error");
});

import express from "express";
import http from "http";
import { Server } from "socket.io";
import bcrypt from "bcryptjs";
import multer from "multer";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "server-data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const DB_FILE = path.join(DATA_DIR, "db.json");

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const defaultDb = {
  users: {},
  messages: [],
  muted: {},
  bans: {}
};

if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify(defaultDb, null, 2));
let db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));

function saveDb() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function cleanUser(user) {
  if (!user) return null;
  return {
    username: user.username,
    avatar: user.avatar || "",
    banner: user.banner || "",
    staff: !!user.staff
  };
}

function makeToken(username) {
  const secret = process.env.SESSION_SECRET || "ssml-chat-secret";
  return crypto.createHash("sha256")
    .update(username + ":" + secret)
    .digest("hex");
}

const sessions = new Map();

function auth(req) {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  return sessions.get(token) || null;
}

app.use(express.json({ limit: "2mb" }));
app.use(express.static(__dirname));

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 75 * 1024 * 1024 }
});

app.post("/api/auth/register", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");

  if (!/^[A-Za-z0-9_]{2,24}$/.test(username))
    return res.status(400).json({ error: "Username must be 2-24 letters, numbers, or underscores." });
  if (password.length < 4)
    return res.status(400).json({ error: "Password must be at least 4 characters." });
  if (db.users[username.toLowerCase()])
    return res.status(409).json({ error: "That username is already taken." });

  const user = {
    username,
    password: await bcrypt.hash(password, 10),
    avatar: "",
    banner: "",
    staff: username.toLowerCase() === "ssml" || username.toLowerCase() === "dev"
  };

  db.users[username.toLowerCase()] = user;
  saveDb();

  const token = makeToken(username + crypto.randomUUID());
  sessions.set(token, username);
  res.json({ token, user: cleanUser(user), firstJoin: true });

  io.emit("system-message", {
    text: `new guy named ${username} has joined the SSML.`,
    kind: "join"
  });
});

app.post("/api/auth/login", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const user = db.users[username.toLowerCase()];

  if (!user || !(await bcrypt.compare(password, user.password)))
    return res.status(401).json({ error: "Wrong username or password." });

  const token = makeToken(username + crypto.randomUUID());
  sessions.set(token, username);
  res.json({ token, user: cleanUser(user) });
});

app.get("/api/me", (req, res) => {
  const username = auth(req);
  if (!username) return res.status(401).json({ error: "Not signed in." });
  res.json({ user: cleanUser(db.users[username.toLowerCase()]) });
});

app.get("/api/profile/:username", (req, res) => {
  const key = String(req.params.username || "").trim().toLowerCase();
  const user = db.users[key];
  if (!user) return res.status(404).json({ error: "User not found." });
  res.json({ user: cleanUser(user) });
});

app.post("/api/profile", (req, res) => {
  const username = auth(req);
  if (!username) return res.status(401).json({ error: "Not signed in." });

  const user = db.users[username.toLowerCase()];
  user.avatar = String(req.body.avatar || "").slice(0, 500);
  user.banner = String(req.body.banner || "").slice(0, 500);
  saveDb();

  io.emit("profile-update", cleanUser(user));
  res.json({ user: cleanUser(user) });
});

app.post("/api/upload", upload.single("file"), (req, res) => {
  const username = auth(req);
  if (!username) return res.status(401).json({ error: "Not signed in." });
  if (!req.file) return res.status(400).json({ error: "No file." });

  const ext = path.extname(req.file.originalname).toLowerCase();
  const safe = req.file.filename + ext;
  fs.renameSync(req.file.path, path.join(UPLOAD_DIR, safe));

  res.json({
    url: `/server-data/uploads/${safe}`,
    name: req.file.originalname,
    type: req.file.mimetype
  });
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "SSML Chat" });
});

app.use("/server-data", express.static(DATA_DIR));

function isMuted(username) {
  const until = db.muted[username.toLowerCase()];
  if (!until) return false;
  if (Date.now() >= until) {
    delete db.muted[username.toLowerCase()];
    saveDb();
    return false;
  }
  return true;
}

function isBanned(username) {
  const until = db.bans[username.toLowerCase()];
  if (!until) return false;
  if (until !== Infinity && Date.now() >= until) {
    delete db.bans[username.toLowerCase()];
    saveDb();
    return false;
  }
  return true;
}

function addMessage(message) {
  db.messages.push(message);

  // Every tenth message clears the old history and leaves one bot notice.
  if (db.messages.length >= 10) {
    const removed = db.messages.length;
    db.messages = [{
      id: crypto.randomUUID(),
      username: "SSML Bot",
      avatar: "",
      staff: true,
      text: `${removed} messages have been deleted to prevent lag :)`,
      bot: true,
      reactions: {},
      createdAt: Date.now()
    }];
    saveDb();
    return true;
  }

  saveDb();
  return false;
}

io.on("connection", (socket) => {
  socket.on("identify", (token) => {
    const username = sessions.get(token);
    if (!username) return;
    socket.username = username;
    socket.emit("history", db.messages);
  });

  socket.on("send-message", (payload) => {
    if (!socket.username) return;

    const username = socket.username;
    if (isBanned(username)) {
      socket.emit("chat-error", "You are banned from this chat.");
      return;
    }
    if (isMuted(username)) {
      socket.emit("chat-error", "You've been muted for 30 secs");
      return;
    }

    const text = String(payload?.text || "").slice(0, 2000);
    const gif = payload?.gif ? String(payload.gif).slice(0, 500) : "";
    const attachment = payload?.attachment || null;

    if (!text && !gif && !attachment) return;

    const user = db.users[username.toLowerCase()];
    const message = {
      id: crypto.randomUUID(),
      username: user.username,
      avatar: user.avatar || "",
      staff: !!user.staff,
      text,
      gif,
      attachment,
      reactions: {},
      createdAt: Date.now()
    };

    const cleaned = addMessage(message);
    if (cleaned) {
      io.emit("history-cleaned");
      io.emit("history", db.messages);
      return;
    }

    io.emit("message", message);
  });

  socket.on("react", ({ messageId, gif }) => {
    if (!socket.username || !gif) return;
    const msg = db.messages.find(m => m.id === messageId);
    if (!msg) return;
    msg.reactions ||= {};
    msg.reactions[socket.username] = String(gif).slice(0, 500);
    saveDb();
    io.emit("reaction", {
      messageId,
      username: socket.username,
      gif: msg.reactions[socket.username]
    });
  });

  socket.on("dev-command", ({ command }) => {
    if (!socket.username) return;
    const actor = db.users[socket.username.toLowerCase()];
    if (!actor?.staff) return;
    const raw = String(command || "").trim();

    if (raw.toLowerCase() === "/commands") {
      socket.emit("command-list", [
        "/commands",
        "/ban Username",
        "/mute Username",
        "/unmute Username",
        "/sound",
        "/clear"
      ]);
      return;
    }

    const [cmd, ...rest] = raw.split(/\s+/);
    const target = rest.join(" ").trim();
    const key = target.toLowerCase();

    if (cmd.toLowerCase() === "/mute" && db.users[key]) {
      db.muted[key] = Date.now() + 30000;
      saveDb();
      io.emit("system-message", { text: `${db.users[key].username} was muted for 30 secs.`, kind: "moderation" });
    } else if (cmd.toLowerCase() === "/unmute") {
      delete db.muted[key];
      saveDb();
      io.emit("system-message", { text: `${target} was unmuted.`, kind: "moderation" });
    } else if (cmd.toLowerCase() === "/ban" && db.users[key]) {
      db.bans[key] = Infinity;
      saveDb();
      io.emit("system-message", { text: `${db.users[key].username} was banned.`, kind: "moderation" });
    } else if (cmd.toLowerCase() === "/sound") {
      io.emit("bot-sound");
    } else if (cmd.toLowerCase() === "/clear") {
      db.messages = [];
      saveDb();
      io.emit("history-cleared");
    }
  });
});

server.listen(PORT, () => {
  console.log(`SSML Chat running on port ${PORT}`);
});

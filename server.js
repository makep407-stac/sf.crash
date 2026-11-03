const http = require("node:http");
const crypto = require("node:crypto");
const { WebSocketServer, WebSocket } = require("ws");

const PORT = Number(process.env.PORT || 10000);
const SESSION_SECRET = process.env.SFCRASH_SESSION_SECRET;

// Provider credentials are read from Render environment variables.
// Values are never returned by the API or written to logs.
const providerCredentials = Object.freeze({
  session: process.env.XBET_SESSION || "",
  userhash: process.env.XBET_USERHASH || "",
  accessToken: process.env.XBET_ACCESS_TOKEN || ""
});
const TOKEN_TTL_SECONDS = 60 * 60 * 12;
const sessions = new Map();
const rateBuckets = new Map();

const providerLive = {
  state: "not_configured",
  authenticated: false,
  connectedAt: null,
  lastMessageAt: null,
  messagesReceived: 0,
  lastMessageKind: null,
  lastError: null
};
let providerSocket = null;
let providerRetry = null;
let providerRetryDelay = 3000;

function connectCrashFeed() {
  if (!providerCredentials.accessToken) {
    providerLive.state = "missing_token";
    return;
  }
  if (providerSocket && (providerSocket.readyState === WebSocket.OPEN || providerSocket.readyState === WebSocket.CONNECTING)) return;

  const target = new URL("wss://1dz-x.com/games-frame/sockets/crash");
  target.search = new URLSearchParams({
    ref: "1", gr: "1188", whence: "114", fcountry: "8",
    appGuid: "games-web-host-b2c-web-v3", lng: "ar", v: "1.5",
    access_token: providerCredentials.accessToken
  }).toString();

  providerLive.state = "connecting";
  providerLive.lastError = null;
  const ws = new WebSocket(target.toString(), {
    headers: { Origin: "https://1dz-x.com" },
    handshakeTimeout: 10000,
    maxPayload: 1024 * 1024
  });
  providerSocket = ws;

  ws.on("open", () => {
    providerLive.state = "connected_unverified";
    providerLive.authenticated = false;
    providerLive.connectedAt = new Date().toISOString();
    providerRetryDelay = 3000;
  });

  ws.on("message", data => {
    providerLive.messagesReceived += 1;
    providerLive.lastMessageAt = new Date().toISOString();
    // Keep only a coarse, non-sensitive message classification; never persist raw frames.
    try {
      const parsed = JSON.parse(data.toString());
      const keys = parsed && typeof parsed === "object" ? Object.keys(parsed) : [];
      providerLive.lastMessageKind = keys.slice(0, 12).join(",");
    } catch {
      providerLive.lastMessageKind = "non_json_frame";
    }
  });

  ws.on("unexpected-response", (_req, res) => {
    providerLive.state = "rejected";
    providerLive.authenticated = false;
    providerLive.lastError = "upstream_http_" + res.statusCode;
  });

  ws.on("error", err => {
    providerLive.lastError = String(err && err.code || "connection_error").slice(0, 80);
  });

  ws.on("close", (code) => {
    providerLive.state = "disconnected";
    providerLive.authenticated = false;
    providerSocket = null;
    if (providerRetry) clearTimeout(providerRetry);
    providerRetry = setTimeout(connectCrashFeed, providerRetryDelay);
    providerRetryDelay = Math.min(providerRetryDelay * 2, 60000);
  });
}

function providerStatusPayload() {
  return {
    provider: "1xBet Crash",
    credentialsConfigured: Boolean(providerCredentials.accessToken),
    connectionState: providerLive.state,
    authenticated: providerLive.authenticated,
    connectedAt: providerLive.connectedAt,
    lastMessageAt: providerLive.lastMessageAt,
    messagesReceived: providerLive.messagesReceived,
    lastMessageKind: providerLive.lastMessageKind,
    lastError: providerLive.lastError,
    rawFramesStored: false,
    predictionAvailable: false
  };
}


if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  console.error("SFCRASH_SESSION_SECRET must be set to a random secret of at least 32 characters.");
  process.exit(1);
}

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  res.end(JSON.stringify(body));
}

function rateLimited(ip) {
  const now = Date.now();
  const entry = rateBuckets.get(ip) || { count: 0, resetAt: now + 60_000 };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + 60_000;
  }
  entry.count += 1;
  rateBuckets.set(ip, entry);
  return entry.count > 20;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 4096) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try { resolve(JSON.parse(raw || "{}")); }
      catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

function sign(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("base64url");
}

function safeEqual(a, b) {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function issueAppSession(accountId) {
  const now = Math.floor(Date.now() / 1000);
  const id = crypto.randomBytes(24).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    sid: id,
    accountId,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
    scope: "sfcrash:app"
  })).toString("base64url");
  const token = payload + "." + sign(payload);
  sessions.set(id, { accountId, expiresAt: now + TOKEN_TTL_SECONDS });
  return { token, expiresIn: TOKEN_TTL_SECONDS };
}

function verifyAppSession(token) {
  if (typeof token !== "string" || token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !safeEqual(sign(parts[0]), parts[1])) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    const stored = sessions.get(payload.sid);
    if (!stored || stored.expiresAt <= Math.floor(Date.now() / 1000) ||
        payload.exp <= Math.floor(Date.now() / 1000) ||
        payload.scope !== "sfcrash:app") return null;
    return payload;
  } catch {
    return null;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, {
      ok: true,
      service: "sf.crash-backend",
      websocket: true,
      providerCredentials: {
        session: Boolean(providerCredentials.session),
        userhash: Boolean(providerCredentials.userhash),
        accessToken: Boolean(providerCredentials.accessToken)
      },
      providerStatus: providerStatusPayload(),
      providerLinked: providerLive.authenticated
    });
  }

  if (req.method === "GET" && url.pathname === "/api/provider/status") {
    return json(res, 200, providerStatusPayload());
  }

  if (req.method === "POST" && url.pathname === "/api/session") {
    const ip = req.socket.remoteAddress || "unknown";
    if (rateLimited(ip)) return json(res, 429, { error: "Too many requests. Try again later." });
    try {
      const body = await readJson(req);
      const accountId = String(body.accountId || "").trim();
      if (!/^[A-Za-z0-9_-]{3,64}$/.test(accountId)) {
        return json(res, 400, { error: "Enter a valid account ID (3-64 letters, numbers, _ or -)." });
      }
      const issued = issueAppSession(accountId);
      return json(res, 201, {
        ...issued,
        sessionType: "sf.crash app session",
        accountId,
        providerLinked: false,
        notice: "This app session does not authenticate or connect to 1xBet."
      });
    } catch (error) {
      return json(res, 400, { error: error.message || "Invalid request." });
    }
  }

  return json(res, 404, { error: "Not found" });
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname !== "/ws") {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws, req));
});

wss.on("connection", ws => {
  let authenticated = false;
  const authTimeout = setTimeout(() => {
    if (!authenticated) ws.close(4401, "Authentication required");
  }, 5000);

  ws.on("message", raw => {
    let message;
    try { message = JSON.parse(raw.toString()); }
    catch { ws.close(4400, "Invalid JSON"); return; }

    if (!authenticated) {
      const session = verifyAppSession(message.token);
      if (!session) { ws.close(4401, "Invalid app session"); return; }
      authenticated = true;
      clearTimeout(authTimeout);
      ws.send(JSON.stringify({
        type: "connected",
        accountId: session.accountId,
        providerLinked: false,
        message: "Connected to sf.crash backend. No 1xBet account connection is active."
      }));
      return;
    }

    if (message.type === "ping") {
      ws.send(JSON.stringify({ type: "pong", at: new Date().toISOString() }));
    } else {
      ws.send(JSON.stringify({ type: "notice", message: "No authorized game-data source is configured yet." }));
    }
  });

  ws.on("close", () => clearTimeout(authTimeout));
  ws.on("error", () => clearTimeout(authTimeout));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`sf.crash backend listening on port ${PORT}`);
  connectCrashFeed();
});

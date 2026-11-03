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
  lastFrameType: null,
  lastFrameBytes: null,
  lastFrameAt: null,
  lastFramePreview: null,
  lastCloseCode: null,
  lastCloseReason: null,
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

  ws.on("message", (data, isBinary) => {
    providerLive.messagesReceived += 1;
    const now = new Date().toISOString();
    providerLive.lastMessageAt = now;
    providerLive.lastFrameType = isBinary ? "binary" : "text";
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
    providerLive.lastFrameBytes = bytes.length;
    providerLive.lastFrameAt = now;

    // Inspect only safe structure. Never retain or log upstream frame contents.
    if (isBinary) {
      providerLive.lastMessageKind = "binary_frame_unparsed";
      providerLive.lastFrameShape = "binary";
      return;
    }

    const frame = bytes.toString("utf8");
    // Redact secrets first, then preserve non-ASCII characters as Unicode escapes
    // so diagnostics can identify the actual message without exposing raw frames.
    const safeFrame = frame
      .replace(/(access_token|token|authorization|cookie|session|userhash|jwt)(["'\\s:=]+)[^&\\s"'<>]+/gi, "$1$2[redacted]")
      .replace(/eyJ[A-Za-z0-9_-]{10,}(?:\\.[A-Za-z0-9_-]+){1,2}/g, "[redacted-jwt]")
      .replace(/[A-Za-z0-9_-]{48,}/g, "[redacted-long-value]");
    const preview = [...safeFrame].map(ch => {
      const cp = ch.codePointAt(0);
      return cp < 0x20 || cp > 0x7e
        ? "\\u{" + cp.toString(16).toUpperCase() + "}"
        : ch;
    }).join("").slice(0, 240);
    providerLive.lastFramePreview = preview;
    providerLive.lastFrameShape = "text";
    const trimmed = frame.trim().replace(/[\x1e]+$/, "");
    // The upstream explicitly canceled its application-level handshake.
    // A WebSocket TCP upgrade is not proof of provider authentication.
    try {
      const upstreamError = JSON.parse(trimmed);
      if (upstreamError && typeof upstreamError.error === "string" &&
          /handshake.*canceled/i.test(upstreamError.error)) {
        providerLive.state = "handshake_rejected";
        providerLive.authenticated = false;
        providerLive.lastMessageKind = "upstream_handshake_canceled";
        providerLive.lastFrameShape = "upstream_error_json";
        providerLive.lastError = "upstream_handshake_canceled";
        return;
      }
    } catch {}
    if (trimmed === "ping" || trimmed === "pong") {
      providerLive.lastMessageKind = trimmed + "_heartbeat";
      providerLive.lastFrameShape = "plain_ascii_word";
      return;
    }
    if (trimmed === "2" || trimmed === "3") {
      providerLive.lastMessageKind = trimmed === "2" ? "engineio_ping" : "engineio_pong";
      providerLive.lastFrameShape = "single_digit";
      return;
    }
    if (trimmed === "40" || trimmed === "41") {
      providerLive.lastMessageKind = trimmed === "40" ? "socketio_connect" : "socketio_disconnect";
      providerLive.lastFrameShape = "two_digit_protocol_frame";
      return;
    }
    try {
      const parsed = JSON.parse(trimmed);
      providerLive.lastMessageKind = Array.isArray(parsed)
        ? "json_array"
        : parsed === null ? "json_null" : typeof parsed === "object" ? "json_object" : "json_scalar";
      providerLive.lastFrameShape = "valid_json";
    } catch {
      const printable = [...frame].filter(ch => {
        const code = ch.codePointAt(0);
        return code >= 0x20 && code <= 0x7e;
      }).length;
      const whitespace = [...frame].filter(ch => /\\s/.test(ch)).length;
      const digits = [...frame].filter(ch => /[0-9]/.test(ch)).length;
      const letters = [...frame].filter(ch => /[A-Za-z]/.test(ch)).length;
      const punctuation = [...frame].filter(ch => /[^A-Za-z0-9\\s]/.test(ch)).length;
      providerLive.lastMessageKind = "non_json_text_unclassified";
      providerLive.lastFrameShape = JSON.stringify({
        characters: [...frame].length,
        printableAscii: printable,
        letters,
        digits,
        whitespace,
        punctuation
      });
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

  ws.on("close", (code, reason) => {
    providerLive.lastCloseCode = Number(code);
    // Store only a short, sanitized close reason; never log frames or credentials.
    providerLive.lastCloseReason = String(reason || "").replace(/[^\x20-\x7E]/g, "").replace(/(access_token|token|authorization|cookie)\s*[:=]\s*[^\s&]+/gi, "$1=[redacted]").slice(0, 100) || null;
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
    lastFrameType: providerLive.lastFrameType,
    lastFrameBytes: providerLive.lastFrameBytes,
    lastFrameAt: providerLive.lastFrameAt,
    lastFrameShape: providerLive.lastFrameShape || null,
    lastFramePreview: providerLive.lastFramePreview,
    lastCloseCode: providerLive.lastCloseCode,
    lastCloseReason: providerLive.lastCloseReason,
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

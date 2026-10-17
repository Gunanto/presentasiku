"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");

const PORT = 3107;
const COOKIE_NAME = "gezyslide_access";
const ADMIN_COOKIE_NAME = "gezyslide_admin";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_FAILURES = 8;
const FAILURE_WINDOW_MS = 10 * 60 * 1000;
const SHARED_DECK = "__shared__";
const TOKEN_PATTERN = /^[A-Z0-9]{5,10}$/;
const DECK_PATH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*\/$/;
const TARGET_PATTERN = /^\/[A-Za-z0-9][A-Za-z0-9._\/-]*\/?$/;
const CONFIG_PATH = process.env.SLIDE_CONFIG_PATH || "/var/lib/gezyslide/config.json";
const DEFAULT_CONFIG_PATH = path.join(__dirname, "default-config.json");
const secret = process.env.SLIDE_AUTH_SECRET;
const adminPassword = process.env.SLIDE_ADMIN_PASSWORD;

const envTokens = Object.freeze({
  "2026-10-13-pgri-ai-digital/": process.env.SLIDE_TOKEN_PGRI,
  "2026-10-20-fkn-muse-asisten-ai/": process.env.SLIDE_TOKEN_FKN,
  "2026-10-6-fkk-daring-3/": process.env.SLIDE_TOKEN_FKK_DS3,
  "2026-10-6-fkk-daring-3-pengantar/": process.env.SLIDE_TOKEN_PFKK_D3
});

const aliasToDeck = Object.freeze({
  "ringkasan-modul-pm-kka/": "2026-10-6-fkk-daring-3/"
});

if (!secret || typeof adminPassword !== "string" || adminPassword.length < 12) {
  throw new Error("Authentication environment is incomplete.");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function validateTokens(tokens) {
  if (!tokens || typeof tokens !== "object" || Array.isArray(tokens)) {
    throw new Error("Token configuration is invalid.");
  }
  const result = {};
  for (const [deck, token] of Object.entries(tokens)) {
    if (!DECK_PATH_PATTERN.test(deck) || !TOKEN_PATTERN.test(token || "")) {
      throw new Error("Token configuration is invalid.");
    }
    result[deck] = token;
  }
  if (!Object.keys(result).length) throw new Error("At least one slide token is required.");
  return result;
}

function validateCards(cards) {
  if (!Array.isArray(cards) || cards.length > 100) throw new Error("Card configuration is invalid.");
  return cards.map((card) => {
    const normalized = {
      id: String(card?.id || "").trim(),
      active: card?.active !== false,
      date: String(card?.date || "").trim(),
      title: String(card?.title || "").trim(),
      description: String(card?.description || "").trim(),
      target: String(card?.target || "").trim(),
      thumbnail: String(card?.thumbnail || "").trim()
    };
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,80}$/.test(normalized.id)) throw new Error("Card id is invalid.");
    if (!TARGET_PATTERN.test(normalized.target) || !normalized.target.endsWith("/")) throw new Error("Card target is invalid.");
    if (!TARGET_PATTERN.test(normalized.thumbnail)) throw new Error("Card thumbnail is invalid.");
    if (!normalized.title || normalized.title.length > 200) throw new Error("Card title is invalid.");
    if (normalized.date.length > 80 || normalized.description.length > 1000) throw new Error("Card text is invalid.");
    return normalized;
  });
}

function normalizeConfig(config) {
  return {
    tokens: validateTokens(config.tokens),
    cards: validateCards(config.cards)
  };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

function loadConfig() {
  try {
    return normalizeConfig(readJson(CONFIG_PATH));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const defaults = readJson(DEFAULT_CONFIG_PATH);
    const initial = normalizeConfig({ tokens: envTokens, cards: defaults.cards });
    writeJson(CONFIG_PATH, initial);
    return initial;
  }
}

let config = loadConfig();

function saveConfig(nextConfig) {
  const normalized = normalizeConfig(nextConfig);
  writeJson(CONFIG_PATH, normalized);
  config = normalized;
  return normalized;
}

const app = express();
const failures = new Map();
app.disable("x-powered-by");
app.set("trust proxy", "loopback");
app.use(express.json({ limit: "64kb" }));

function sign(value) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function secureEqual(left, right) {
  const leftBuffer = Buffer.from(left || "");
  const rightBuffer = Buffer.from(right || "");
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function readCookie(header, name) {
  const prefix = `${name}=`;
  return (header || "").split(/;\s*/).find((part) => part.startsWith(prefix))?.slice(prefix.length);
}

function pathOnly(target) {
  return typeof target === "string" ? target.split(/[?#]/, 1)[0] : "";
}

function deckForTarget(target) {
  const targetPath = pathOnly(target);
  if (!targetPath.startsWith("/") || targetPath.startsWith("//")) return null;
  const knownPrefixes = [...Object.keys(config.tokens), ...Object.keys(aliasToDeck)];
  const matched = knownPrefixes.find((prefix) => targetPath.startsWith(`/${prefix}`));
  if (matched) return aliasToDeck[matched] || matched;
  return SHARED_DECK;
}

function registeredTokens() {
  return [...new Set(Object.values(config.tokens))];
}

function tokenSignature(deck) {
  const material = deck === SHARED_DECK ? registeredTokens().sort().join("|") : config.tokens[deck];
  return sign(`token:${deck}:${material}`);
}

function tokenMatches(deck, token) {
  if (deck === SHARED_DECK) return registeredTokens().some((candidate) => secureEqual(token, candidate));
  return secureEqual(token, config.tokens[deck]);
}

function sessionFor(cookie) {
  if (!cookie) return null;
  const separator = cookie.lastIndexOf(".");
  if (separator < 1) return null;
  const payload = cookie.slice(0, separator);
  const signature = cookie.slice(separator + 1);
  if (!secureEqual(signature, sign(`slide:${payload}`))) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const validDeck = session.deck === SHARED_DECK || Object.hasOwn(config.tokens, session.deck);
    if (session.exp <= Date.now() || !validDeck || !secureEqual(session.tokenSignature, tokenSignature(session.deck))) return null;
    return session;
  } catch {
    return null;
  }
}

function adminSessionFor(cookie) {
  if (!cookie) return false;
  const separator = cookie.lastIndexOf(".");
  if (separator < 1) return false;
  const payload = cookie.slice(0, separator);
  const signature = cookie.slice(separator + 1);
  if (!secureEqual(signature, sign(`admin:${payload}`))) return false;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return session.role === "admin" && session.exp > Date.now();
  } catch {
    return false;
  }
}

function requireAdmin(req, res, next) {
  if (adminSessionFor(readCookie(req.get("cookie"), ADMIN_COOKIE_NAME))) return next();
  return res.status(401).json({ error: "Admin login diperlukan." });
}

function failureRecord(ip) {
  const now = Date.now();
  const record = failures.get(ip);
  if (!record || record.expiresAt <= now) return { count: 0, expiresAt: now + FAILURE_WINDOW_MS };
  return record;
}

function hasTooManyFailures(ip) {
  return failureRecord(ip).count >= MAX_FAILURES;
}

function recordFailure(ip) {
  const record = failureRecord(ip);
  record.count += 1;
  failures.set(ip, record);
}

app.get("/_slide_health", (_req, res) => res.status(204).end());

app.get("/_slide_config", (_req, res) => {
  res.set("Cache-Control", "no-store");
  return res.json({ cards: config.cards });
});

app.get("/_slide_auth", (req, res) => {
  const deck = deckForTarget(req.get("x-original-uri") || "");
  const session = sessionFor(readCookie(req.get("cookie"), COOKIE_NAME));
  if (deck && session?.deck === deck) return res.status(204).end();
  return res.status(401).end();
});

app.post("/_slide_login", (req, res) => {
  const ip = req.ip;
  const target = req.body?.target;
  const token = req.body?.token;
  const deck = deckForTarget(target);
  if (!deck || typeof token !== "string" || hasTooManyFailures(ip)) {
    if (hasTooManyFailures(ip)) return res.status(429).json({ error: "Terlalu banyak percobaan. Coba lagi beberapa menit lagi." });
    recordFailure(ip);
    return res.status(401).json({ error: "Token tidak sesuai." });
  }
  if (!tokenMatches(deck, token)) {
    recordFailure(ip);
    return res.status(401).json({ error: "Token tidak sesuai." });
  }
  failures.delete(ip);
  const payload = Buffer.from(JSON.stringify({ deck, tokenSignature: tokenSignature(deck), exp: Date.now() + SESSION_TTL_MS })).toString("base64url");
  const cookie = `${payload}.${sign(`slide:${payload}`)}`;
  res.cookie(COOKIE_NAME, cookie, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: SESSION_TTL_MS,
    path: "/"
  });
  return res.status(204).end();
});

app.post("/_slide_logout", (_req, res) => {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, secure: true, sameSite: "lax", path: "/" });
  return res.status(204).end();
});

app.post("/_slide_admin_login", (req, res) => {
  const password = req.body?.password;
  if (typeof password !== "string" || !secureEqual(password, adminPassword)) {
    return res.status(401).json({ error: "Password admin tidak sesuai." });
  }
  const payload = Buffer.from(JSON.stringify({ role: "admin", exp: Date.now() + ADMIN_SESSION_TTL_MS })).toString("base64url");
  const cookie = `${payload}.${sign(`admin:${payload}`)}`;
  res.cookie(ADMIN_COOKIE_NAME, cookie, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    maxAge: ADMIN_SESSION_TTL_MS,
    path: "/"
  });
  return res.status(204).end();
});

app.post("/_slide_admin_logout", (_req, res) => {
  res.clearCookie(ADMIN_COOKIE_NAME, { httpOnly: true, secure: true, sameSite: "strict", path: "/" });
  return res.status(204).end();
});

app.get("/_slide_admin_config", requireAdmin, (_req, res) => {
  res.set("Cache-Control", "no-store");
  return res.json(config);
});

app.put("/_slide_admin_config", requireAdmin, (req, res) => {
  try {
    const nextConfig = saveConfig(req.body || {});
    return res.json({ ok: true, config: nextConfig });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Konfigurasi tidak valid." });
  }
});

app.use((_req, res) => res.status(404).end());
app.listen(PORT, "127.0.0.1", () => console.log(`Gezyslide auth listening on 127.0.0.1:${PORT}`));

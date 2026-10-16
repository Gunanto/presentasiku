"use strict";

const crypto = require("crypto");
const express = require("express");

const PORT = 3107;
const COOKIE_NAME = "gezyslide_access";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_FAILURES = 8;
const FAILURE_WINDOW_MS = 10 * 60 * 1000;
const SHARED_DECK = "__shared__";
const secret = process.env.SLIDE_AUTH_SECRET;

const tokenByDeck = Object.freeze({
  "2026-10-13-pgri-ai-digital/": process.env.SLIDE_TOKEN_PGRI,
  "2026-10-20-fkn-muse-asisten-ai/": process.env.SLIDE_TOKEN_FKN,
  "2026-10-6-fkk-daring-3/": process.env.SLIDE_TOKEN_FKK_DS3,
  "2026-10-6-fkk-daring-3-pengantar/": process.env.SLIDE_TOKEN_PFKK_D3
});
const aliasToDeck = Object.freeze({
  "ringkasan-modul-pm-kka/": "2026-10-6-fkk-daring-3/"
});
const registeredTokens = Object.freeze([...new Set(Object.values(tokenByDeck))]);

if (!secret || registeredTokens.some((token) => !/^[A-Z0-9]{5,10}$/.test(token || ""))) {
  throw new Error("Authentication environment is incomplete.");
}

const app = express();
const failures = new Map();
app.disable("x-powered-by");
app.set("trust proxy", "loopback");
app.use(express.json({ limit: "2kb" }));

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

function deckForTarget(target) {
  if (typeof target !== "string" || !target.startsWith("/") || target.startsWith("//")) return null;
  const path = target.split(/[?#]/, 1)[0];
  const matched = [...Object.keys(tokenByDeck), ...Object.keys(aliasToDeck)]
    .find((prefix) => path.startsWith(`/${prefix}`));
  if (matched) return aliasToDeck[matched] || matched;
  return SHARED_DECK;
}

function tokenMatches(deck, token) {
  if (deck === SHARED_DECK) return registeredTokens.some((candidate) => secureEqual(token, candidate));
  return secureEqual(token, tokenByDeck[deck]);
}

function sessionFor(cookie) {
  if (!cookie) return null;
  const separator = cookie.lastIndexOf(".");
  if (separator < 1) return null;
  const payload = cookie.slice(0, separator);
  const signature = cookie.slice(separator + 1);
  if (!secureEqual(signature, sign(payload))) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (session.exp <= Date.now() || (session.deck !== SHARED_DECK && !Object.hasOwn(tokenByDeck, session.deck))) return null;
    return session;
  } catch {
    return null;
  }
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

app.get("/_slide_auth", (req, res) => {
  const originalUri = req.get("x-original-uri") || "";
  const deck = deckForTarget(originalUri);
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
  const payload = Buffer.from(JSON.stringify({ deck, exp: Date.now() + SESSION_TTL_MS })).toString("base64url");
  const cookie = `${payload}.${sign(payload)}`;
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

app.use((_req, res) => res.status(404).end());
app.listen(PORT, "127.0.0.1", () => console.log(`Gezyslide auth listening on 127.0.0.1:${PORT}`));

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");

dotenv.config({ path: path.join(__dirname, ".env") });

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3001;
const RIOT_API_KEY = (process.env.RIOT_API_KEY || "").trim();
const FRIENDS_FILE = path.join(__dirname, "friends.json");
const CACHE_FILE = path.join(__dirname, "ladder-cache.json");
const API_STATS_FILE = path.join(__dirname, "api-stats.json");
const METRICS_FILE = path.join(__dirname, "visit-metrics.json");
const CLIENT_DIST_DIR = path.join(__dirname, "..", "client", "dist");
const CLIENT_INDEX_FILE = path.join(CLIENT_DIST_DIR, "index.html");
const HAS_CLIENT_BUILD = fs.existsSync(CLIENT_INDEX_FILE);
const REGION = "europe";
const PLATFORM = "euw1";
const ADMIN_TOKEN = String(process.env.ADMIN_TOKEN || "").trim();
const LADDER_CACHE_TTL_MS = Number(process.env.LADDER_CACHE_TTL_MS) || 2 * 60 * 1000;
const MATCH_SYNC_TTL_MS = Number(process.env.MATCH_SYNC_TTL_MS) || 2 * 60 * 1000;
const RATE_LIMIT_FALLBACK_MS = Number(process.env.RATE_LIMIT_FALLBACK_MS) || 60 * 1000;
const FRIENDS_PER_REFRESH = Math.max(1, Number(process.env.FRIENDS_PER_REFRESH) || 2);
const MAX_RANKED_MATCH_CACHE_PER_PLAYER = Math.max(10, Number(process.env.MAX_RANKED_MATCH_CACHE_PER_PLAYER) || 20);
const MAX_NEW_MATCH_DETAILS_PER_REFRESH = Math.max(1, Number(process.env.MAX_NEW_MATCH_DETAILS_PER_REFRESH) || 1);
const DUO_SOLOQ_RECENT_GAMES = 10;
const FULL_REFRESH_EVERY_CYCLE = String(process.env.FULL_REFRESH_EVERY_CYCLE || "true").toLowerCase() !== "false";
const ACCOUNT_REFRESH_TTL_MS = Number(process.env.ACCOUNT_REFRESH_TTL_MS) || 24 * 60 * 60 * 1000;
const SUMMONER_REFRESH_TTL_MS = Number(process.env.SUMMONER_REFRESH_TTL_MS) || 6 * 60 * 60 * 1000;
const ACTIVE_GAME_STATUS_TTL_MS = Number(process.env.ACTIVE_GAME_STATUS_TTL_MS) || 30 * 1000;
const LP_STEP_ANOMALY_WINDOW_MS = Number(process.env.LP_STEP_ANOMALY_WINDOW_MS) || 30 * 60 * 1000;
const LP_STEP_ANOMALY_THRESHOLD = Number(process.env.LP_STEP_ANOMALY_THRESHOLD) || 350;
const ACTIVITY_FEED_HISTORY_LIMIT = Math.max(5, Number(process.env.ACTIVITY_FEED_HISTORY_LIMIT) || 20);
const ACTIVITY_FEED_SCHEMA_VERSION = 3;
const DELTA_TRACKING_VERSION = 3;
const MAX_VISIT_METRICS_EVENTS = Math.max(200, Number(process.env.MAX_VISIT_METRICS_EVENTS) || 3000);

// Riot personal key hard limits: 20 req/1 s, 100 req/2 min.
// We budget to 18/1 s and 90/2 min for a safety margin.
const RATE_WINDOW_LIMITS = [
  { count: 18, windowMs: 1_000 },
  { count: 90, windowMs: 120_000 },
];
const requestTimestamps = []; // sorted epoch-ms of every dispatched Riot request
let totalRiotRequests = 0;
let todayRiotRequests = 0;
let riotRateLimitedUntil = 0; // set reactively when a 429 is received
let lastApiStatsPersistAt = 0;

const visitMetrics = {
  totalPageViews: 0,
  totalConsentedPageViews: 0,
  lastUpdatedAt: null,
  events: [],
};

function loadVisitMetricsFromFile() {
  try {
    if (!fs.existsSync(METRICS_FILE)) return;
    const parsed = JSON.parse(fs.readFileSync(METRICS_FILE, "utf8"));
    const events = Array.isArray(parsed?.events) ? parsed.events : [];

    visitMetrics.totalPageViews = Number(parsed?.totalPageViews) || events.length;
    visitMetrics.totalConsentedPageViews = Number(parsed?.totalConsentedPageViews) || events.filter((ev) => Boolean(ev?.consentAccepted)).length;
    visitMetrics.lastUpdatedAt = parsed?.lastUpdatedAt || null;
    visitMetrics.events = events.slice(-MAX_VISIT_METRICS_EVENTS);
  } catch (err) {
    console.warn("Could not load visit metrics from file:", err.message);
  }
}

function saveVisitMetricsToFile() {
  try {
    fs.writeFileSync(
      METRICS_FILE,
      JSON.stringify({
        totalPageViews: visitMetrics.totalPageViews,
        totalConsentedPageViews: visitMetrics.totalConsentedPageViews,
        lastUpdatedAt: visitMetrics.lastUpdatedAt,
        events: visitMetrics.events.slice(-MAX_VISIT_METRICS_EVENTS),
      }, null, 2)
    );
  } catch (err) {
    console.warn("Could not save visit metrics to file:", err.message);
  }
}

function getClientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const realIp = String(req.headers["x-real-ip"] || "").trim();
  const remoteAddress = String(req.socket?.remoteAddress || "").trim();
  return forwarded || realIp || remoteAddress || "unknown";
}

function anonymizeIp(rawIp) {
  const ip = String(rawIp || "").trim();
  if (!ip || ip === "unknown") return "unknown";

  // IPv6 mapped IPv4 (e.g. ::ffff:1.2.3.4)
  const mapped = ip.includes("::ffff:") ? ip.split("::ffff:").pop() : ip;

  if (/^\d+\.\d+\.\d+\.\d+$/.test(mapped)) {
    const parts = mapped.split(".");
    parts[3] = "0";
    return parts.join(".");
  }

  if (mapped.includes(":")) {
    const parts = mapped.split(":").filter((p) => p.length > 0);
    if (parts.length <= 2) return `${parts.join(":")}:0000`;
    return `${parts.slice(0, 2).join(":")}:0000:0000:0000:0000:0000:0000`;
  }

  return "unknown";
}

function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) {
    return res.status(503).json({
      error: "El panel admin no esta configurado. Define ADMIN_TOKEN en server/.env",
    });
  }

  const rawHeader = String(req.headers["x-admin-token"] || "").trim();
  const authHeader = String(req.headers.authorization || "").trim();
  const bearerToken = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  const candidate = rawHeader || bearerToken;

  if (!candidate || candidate !== ADMIN_TOKEN) {
    return res.status(401).json({ error: "No autorizado" });
  }

  return next();
}

function getDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isAnomalousLpStep(stepDelta, lastSeenIso, nowIso) {
  const absStep = Math.abs(Number(stepDelta) || 0);
  if (absStep <= LP_STEP_ANOMALY_THRESHOLD) return false;

  const lastSeenTs = Date.parse(String(lastSeenIso || ""));
  const nowTs = Date.parse(String(nowIso || ""));
  if (!Number.isFinite(lastSeenTs) || !Number.isFinite(nowTs)) return true;

  // Large LP jumps in a short time are usually stale-seed artifacts.
  return (nowTs - lastSeenTs) <= LP_STEP_ANOMALY_WINDOW_MS;
}

function loadApiStatsFromFile() {
  try {
    if (!fs.existsSync(API_STATS_FILE)) return;
    const parsed = JSON.parse(fs.readFileSync(API_STATS_FILE, "utf8"));
    const persistedTotal = Number(parsed?.totalRiotRequests);
    if (Number.isFinite(persistedTotal) && persistedTotal >= 0) {
      totalRiotRequests = persistedTotal;
    }

    const todayKey = getDateKey();
    const perDay = parsed?.perDay || {};
    const persistedToday = Number(perDay[todayKey]);
    if (Number.isFinite(persistedToday) && persistedToday >= 0) {
      todayRiotRequests = persistedToday;
    }
  } catch (err) {
    console.warn("Could not load API stats from file:", err.message);
  }
}

function saveApiStatsToFile(force = false) {
  const now = Date.now();
  if (!force && now - lastApiStatsPersistAt < 5000) return;
  try {
    let parsed = {};
    if (fs.existsSync(API_STATS_FILE)) {
      try {
        parsed = JSON.parse(fs.readFileSync(API_STATS_FILE, "utf8"));
      } catch {
        parsed = {};
      }
    }

    const todayKey = getDateKey();
    const nextPerDay = { ...(parsed.perDay || {}), [todayKey]: todayRiotRequests };
    const keepDays = Object.keys(nextPerDay).sort().slice(-31);
    const compactPerDay = {};
    for (const day of keepDays) compactPerDay[day] = Number(nextPerDay[day]) || 0;

    fs.writeFileSync(
      API_STATS_FILE,
      JSON.stringify({
        totalRiotRequests,
        perDay: compactPerDay,
        updatedAt: new Date().toISOString(),
      }, null, 2)
    );
    lastApiStatsPersistAt = now;
  } catch (err) {
    console.warn("Could not save API stats to file:", err.message);
  }
}

let DDRAGON_VERSION = "14.24.1";
let championIdNameMap = null;

async function fetchDDragonVersion() {
  try {
    const res = await fetch("https://ddragon.leagueoflegends.com/api/versions.json");
    const versions = await res.json();
    if (Array.isArray(versions) && versions.length > 0) {
      DDRAGON_VERSION = versions[0];
      console.log("DDragon version:", DDRAGON_VERSION);
    }
  } catch (e) {
    console.warn("Could not fetch DDragon version, using fallback:", e.message);
  }
}

async function getChampionIdNameMap() {
  if (championIdNameMap) return championIdNameMap;

  try {
    const res = await fetch(
      `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/data/en_US/champion.json`
    );
    const json = await res.json();
    const data = json?.data || {};
    const map = new Map();

    for (const champion of Object.values(data)) {
      if (!champion?.key || !champion?.id) continue;
      map.set(String(champion.key), champion.id);
    }

    championIdNameMap = map;
    return championIdNameMap;
  } catch (err) {
    console.warn("Could not fetch champion map for mastery fallback:", err.message);
    return new Map();
  }
}

async function fetchTopMasteryChampions(puuid) {
  try {
    const masteryRows = await riotFetch(
      `https://${PLATFORM}.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/${encodeURIComponent(puuid)}/top?count=3`
    );

    if (!Array.isArray(masteryRows) || masteryRows.length === 0) return [];

    const idNameMap = await getChampionIdNameMap();
    return masteryRows
      .map((row) => idNameMap.get(String(row?.championId)))
      .filter(Boolean)
      .slice(0, 3);
  } catch (err) {
    console.warn("Champion mastery fallback failed:", err.message);
    return [];
  }
}

function buildChampionRoleSummary(matches) {
  const champCount = {};
  const roleCount = {};
  const safeMatches = Array.isArray(matches) ? matches : [];

  for (const match of safeMatches) {
    if (match?.championName) champCount[match.championName] = (champCount[match.championName] || 0) + 1;
    if (match?.teamPosition) roleCount[match.teamPosition] = (roleCount[match.teamPosition] || 0) + 1;
  }

  const topChampions = Object.entries(champCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name);

  const mainRole =
    Object.entries(roleCount).length > 0
      ? Object.entries(roleCount).sort((a, b) => b[1] - a[1])[0][0]
      : null;

  return { topChampions, mainRole };
}

async function fetchRecentChampionsAndRole(puuid) {
  try {
    const cachedEntry = ladderCache.rankedMatchesByPuuid[puuid] || { matches: [], lastSyncAt: null };
    const existingMatches = Array.isArray(cachedEntry.matches) ? cachedEntry.matches : [];
    const lastSyncMs = cachedEntry.lastSyncAt ? Date.parse(cachedEntry.lastSyncAt) : NaN;
    const isRecentSync = Number.isFinite(lastSyncMs) && (Date.now() - lastSyncMs) < MATCH_SYNC_TTL_MS;

    if (existingMatches.length > 0 && isRecentSync) {
      let { topChampions, mainRole } = buildChampionRoleSummary(existingMatches.slice(0, MAX_RANKED_MATCH_CACHE_PER_PLAYER));
      if (topChampions.length === 0) {
        topChampions = await fetchTopMasteryChampions(puuid);
      }

      return {
        topChampions,
        mainRole,
        recentRankedMatchIds: existingMatches.slice(0, MAX_RANKED_MATCH_CACHE_PER_PLAYER).map((m) => m.id),
        recentSoloqMatchIds: existingMatches
          .filter((m) => m?.queueId === 420)
          .sort((a, b) => Number(b?.gameEndTimestamp || 0) - Number(a?.gameEndTimestamp || 0))
          .slice(0, DUO_SOLOQ_RECENT_GAMES)
          .map((m) => m.id),
      };
    }

    const hasBootstrapData = existingMatches.length >= MAX_RANKED_MATCH_CACHE_PER_PLAYER;

    const soloFetchCount = hasBootstrapData ? 4 : 5;

    const soloMatchIds = await riotFetch(
      `https://${REGION}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=420&count=${soloFetchCount}`
    ).catch(() => []);

    let incomingIds = Array.from(new Set([...(soloMatchIds || [])]));

    if (incomingIds.length === 0 && !hasBootstrapData) {
      incomingIds = await riotFetch(
        `https://${REGION}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?count=5`
      ).catch(() => []);
    }

    const existingById = new Map(existingMatches.map((m) => [m.id, m]));
    const idsToFetch = incomingIds.filter((id) => !existingById.has(id)).slice(0, MAX_NEW_MATCH_DETAILS_PER_REFRESH);

    const fetchedMatches = [];
    for (const id of idsToFetch) {
      try {
        const match = await riotFetch(`https://${REGION}.api.riotgames.com/lol/match/v5/matches/${id}`);
        if (!match?.info?.participants) continue;
        const p = match.info.participants.find((pl) => pl.puuid === puuid);
        if (!p) continue;
        fetchedMatches.push({
          id,
          championName: p.championName || null,
          teamPosition: p.teamPosition || null,
          kills: Number.isFinite(Number(p.kills)) ? Number(p.kills) : null,
          deaths: Number.isFinite(Number(p.deaths)) ? Number(p.deaths) : null,
          assists: Number.isFinite(Number(p.assists)) ? Number(p.assists) : null,
          win: typeof p.win === "boolean" ? p.win : null,
          queueId: match.info.queueId || null,
          gameEndTimestamp: match.info.gameEndTimestamp || match.info.gameStartTimestamp || null,
        });
      } catch {
        // Ignore single-match errors to preserve partial progress.
      }
    }

    const fetchedById = new Map(fetchedMatches.map((m) => [m.id, m]));
    const merged = [];

    // Keep newest ordering from incoming IDs first.
    for (const id of incomingIds) {
      const next = fetchedById.get(id) || existingById.get(id);
      if (next) merged.push(next);
    }

    // Preserve older cached matches after newly seen ones.
    for (const oldMatch of existingMatches) {
      if (!merged.some((m) => m.id === oldMatch.id)) merged.push(oldMatch);
    }

    const finalMatches = merged.slice(0, MAX_RANKED_MATCH_CACHE_PER_PLAYER);
    ladderCache.rankedMatchesByPuuid[puuid] = {
      matches: finalMatches,
      lastSyncAt: new Date().toISOString(),
    };

    let { topChampions, mainRole } = buildChampionRoleSummary(finalMatches);

    if (topChampions.length === 0) {
      topChampions = await fetchTopMasteryChampions(puuid);
    }

    return {
      topChampions,
      mainRole,
      recentRankedMatchIds: finalMatches.map((m) => m.id),
      recentSoloqMatchIds: finalMatches
        .filter((m) => m?.queueId === 420)
        .sort((a, b) => Number(b?.gameEndTimestamp || 0) - Number(a?.gameEndTimestamp || 0))
        .slice(0, DUO_SOLOQ_RECENT_GAMES)
        .map((m) => m.id),
    };
  } catch (err) {
    console.warn(`fetchRecentChampionsAndRole failed:`, err.message);
    const fallback = ladderCache.rankedMatchesByPuuid[puuid]?.matches || [];
    let { topChampions, mainRole } = buildChampionRoleSummary(fallback);

    if (topChampions.length === 0) {
      topChampions = await fetchTopMasteryChampions(puuid);
    }
    return {
      topChampions,
      mainRole,
      recentRankedMatchIds: fallback.slice(0, MAX_RANKED_MATCH_CACHE_PER_PLAYER).map((m) => m.id),
      recentSoloqMatchIds: fallback
        .filter((m) => m?.queueId === 420)
        .sort((a, b) => Number(b?.gameEndTimestamp || 0) - Number(a?.gameEndTimestamp || 0))
        .slice(0, DUO_SOLOQ_RECENT_GAMES)
        .map((m) => m.id),
    };
  }
}

function pruneRankedMatchesCacheForActivePuuids(activePuuids = []) {
  const activeSet = new Set((activePuuids || []).filter(Boolean));
  for (const puuid of Object.keys(ladderCache.rankedMatchesByPuuid || {})) {
    if (!activeSet.has(puuid)) {
      delete ladderCache.rankedMatchesByPuuid[puuid];
      continue;
    }

    const entry = ladderCache.rankedMatchesByPuuid[puuid];
    const matches = Array.isArray(entry?.matches) ? entry.matches : [];
    if (matches.length > MAX_RANKED_MATCH_CACHE_PER_PLAYER) {
      ladderCache.rankedMatchesByPuuid[puuid] = {
        ...entry,
        matches: matches.slice(0, MAX_RANKED_MATCH_CACHE_PER_PLAYER),
      };
    }
  }
}

const ladderCache = {
  players: [],
  rankedMatchesByPuuid: {},
  playerSnapshotByKey: {},
  // Raw per-puuid API data — persistent fallback for every step of the fetch pipeline.
  rawDataByPuuid: {},
  dailyLpByDate: {},
  dailySoloqDeltaByDate: {},
  lpSnapshotByPlayer: {},
  activityFeedHistory: [],
  activityFeedSchemaVersion: ACTIVITY_FEED_SCHEMA_VERSION,
  refreshCursor: 0,
  lastUpdatedAt: null,
  lastError: null,
  refreshPromise: null,
};

function getDailyPlayerKey(player) {
  if (player?.puuid) return `puuid:${player.puuid}`;
  if (player?.riotId) return `riot:${String(player.riotId).toLowerCase()}`;
  return null;
}

function updateDailyLpTracker(players) {
  const todayKey = getDateKey();
  const dailyMap = ladderCache.dailyLpByDate[todayKey] || (ladderCache.dailyLpByDate[todayKey] = {});
  const snapshotByPlayer = ladderCache.lpSnapshotByPlayer || (ladderCache.lpSnapshotByPlayer = {});
  const nowIso = new Date().toISOString();
  let migratedLegacyRows = false;

  for (const player of players || []) {
    if (!player || player.error) continue;
    const key = getDailyPlayerKey(player);
    if (!key) continue;

    const soloLp = Number(player?.soloq?.leaguePoints);
    const flexLp = Number(player?.flex?.leaguePoints);
    const soloTier = String(player?.soloq?.tier || "").toUpperCase() || null;
    const soloRank = String(player?.soloq?.rank || "").toUpperCase() || null;
    const flexTier = String(player?.flex?.tier || "").toUpperCase() || null;
    const flexRank = String(player?.flex?.rank || "").toUpperCase() || null;
    const soloScore = Number.isFinite(soloLp) ? getQueueStandingScore(soloTier, soloRank, soloLp) : null;
    const flexScore = Number.isFinite(flexLp) ? getQueueStandingScore(flexTier, flexRank, flexLp) : null;

    const entry = dailyMap[key] || {
      puuid: player.puuid || null,
      riotId: player.riotId || "Unknown",
      soloqStartLp: Number.isFinite(soloLp) ? soloLp : null,
      soloqCurrentLp: Number.isFinite(soloLp) ? soloLp : null,
      soloqStartScore: Number.isFinite(soloScore) ? soloScore : null,
      soloqCurrentScore: Number.isFinite(soloScore) ? soloScore : null,
      soloqDeltaLp: 0,
      soloqLastDeltaLp: 0,
      soloqBestSingleGainLp: 0,
      soloqTier: soloTier,
      soloqRank: soloRank,
      flexStartLp: Number.isFinite(flexLp) ? flexLp : null,
      flexCurrentLp: Number.isFinite(flexLp) ? flexLp : null,
      flexStartScore: Number.isFinite(flexScore) ? flexScore : null,
      flexCurrentScore: Number.isFinite(flexScore) ? flexScore : null,
      flexDeltaLp: 0,
      flexTier,
      flexRank,
      deltaTrackingVersion: DELTA_TRACKING_VERSION,
      firstSeenAt: nowIso,
      lastSeenAt: nowIso,
    };

    const playerSnapshot = snapshotByPlayer[key] || {
      soloqLp: null,
      soloqScore: null,
      flexLp: null,
      flexScore: null,
      lastDateKey: null,
      lastSeenAt: null,
    };

    entry.riotId = player.riotId || entry.riotId;
    entry.puuid = player.puuid || entry.puuid;
    entry.soloqTier = soloTier || entry.soloqTier || null;
    entry.soloqRank = soloRank || entry.soloqRank || null;
    entry.flexTier = flexTier || entry.flexTier || null;
    entry.flexRank = flexRank || entry.flexRank || null;

    if (Number(entry.deltaTrackingVersion || 0) < DELTA_TRACKING_VERSION) {
      migratedLegacyRows = true;
      if (Number.isFinite(soloScore)) {
        const knownSoloDelta = Number(entry.soloqDeltaLp);
        const reconstructedSoloDelta = Number.isFinite(knownSoloDelta) ? knownSoloDelta : 0;
        entry.soloqCurrentLp = Number.isFinite(soloLp) ? soloLp : entry.soloqCurrentLp;
        entry.soloqStartScore = soloScore - reconstructedSoloDelta;
        entry.soloqCurrentScore = soloScore;
        entry.soloqDeltaLp = reconstructedSoloDelta;
        entry.soloqLastDeltaLp = Number.isFinite(Number(entry.soloqLastDeltaLp)) ? Number(entry.soloqLastDeltaLp) : 0;
        entry.soloqBestSingleGainLp = Number.isFinite(Number(entry.soloqBestSingleGainLp)) ? Number(entry.soloqBestSingleGainLp) : 0;
        playerSnapshot.soloqScore = soloScore;
      }
      if (Number.isFinite(flexScore)) {
        const knownFlexDelta = Number(entry.flexDeltaLp);
        const reconstructedFlexDelta = Number.isFinite(knownFlexDelta) ? knownFlexDelta : 0;
        entry.flexCurrentLp = Number.isFinite(flexLp) ? flexLp : entry.flexCurrentLp;
        entry.flexStartScore = flexScore - reconstructedFlexDelta;
        entry.flexCurrentScore = flexScore;
        entry.flexDeltaLp = reconstructedFlexDelta;
        playerSnapshot.flexScore = flexScore;
      }
      entry.deltaTrackingVersion = DELTA_TRACKING_VERSION;
    }

    if (!Number.isFinite(Number(entry.soloqStartScore)) && Number.isFinite(soloScore)) {
      entry.soloqCurrentLp = Number.isFinite(soloLp) ? soloLp : entry.soloqCurrentLp;
      const knownSoloDelta = Number(entry.soloqDeltaLp);
      entry.soloqStartScore = soloScore - (Number.isFinite(knownSoloDelta) ? knownSoloDelta : 0);
      entry.soloqCurrentScore = soloScore;
    }
    if (!Number.isFinite(Number(entry.soloqCurrentScore)) && Number.isFinite(Number(entry.soloqCurrentLp))) {
      const derived = getQueueStandingScore(entry.soloqTier, entry.soloqRank, Number(entry.soloqCurrentLp));
      entry.soloqCurrentScore = Number.isFinite(derived) ? derived : null;
    }
    if (!Number.isFinite(Number(entry.flexStartScore)) && Number.isFinite(flexScore)) {
      entry.flexCurrentLp = Number.isFinite(flexLp) ? flexLp : entry.flexCurrentLp;
      const knownFlexDelta = Number(entry.flexDeltaLp);
      entry.flexStartScore = flexScore - (Number.isFinite(knownFlexDelta) ? knownFlexDelta : 0);
      entry.flexCurrentScore = flexScore;
    }
    if (!Number.isFinite(Number(entry.flexCurrentScore)) && Number.isFinite(Number(entry.flexCurrentLp))) {
      const derived = getQueueStandingScore(entry.flexTier, entry.flexRank, Number(entry.flexCurrentLp));
      entry.flexCurrentScore = Number.isFinite(derived) ? derived : null;
    }

    if (Number.isFinite(soloLp) && Number.isFinite(soloScore)) {
      if (entry.soloqStartLp === null) entry.soloqStartLp = soloLp;
      if (!Number.isFinite(Number(entry.soloqStartScore))) entry.soloqStartScore = soloScore;
      if (!Number.isFinite(Number(playerSnapshot.soloqScore))) playerSnapshot.soloqScore = soloScore;
      const prevSolo = Number(playerSnapshot.soloqScore);
      let stepSoloDelta = 0;
      if (Number.isFinite(prevSolo) && playerSnapshot.lastDateKey === todayKey) {
        const rawStepSoloDelta = soloScore - prevSolo;
        if (isAnomalousLpStep(rawStepSoloDelta, playerSnapshot.lastSeenAt, nowIso)) {
          // Rebase when the delta is implausibly large for the elapsed time.
          entry.soloqStartLp = soloLp;
          entry.soloqCurrentLp = soloLp;
          entry.soloqStartScore = soloScore;
          entry.soloqCurrentScore = soloScore;
          entry.soloqLastDeltaLp = 0;
          entry.soloqBestSingleGainLp = 0;
        } else {
          stepSoloDelta = rawStepSoloDelta;
        }
      }
      entry.soloqLastDeltaLp = stepSoloDelta;
      if (stepSoloDelta > Number(entry.soloqBestSingleGainLp || 0)) {
        entry.soloqBestSingleGainLp = stepSoloDelta;
      }
      entry.soloqCurrentLp = soloLp;
      entry.soloqCurrentScore = soloScore;
      entry.soloqDeltaLp = Number.isFinite(Number(entry.soloqStartScore))
        ? (soloScore - Number(entry.soloqStartScore))
        : 0;
      playerSnapshot.soloqLp = soloLp;
      playerSnapshot.soloqScore = soloScore;
    }

    if (Number.isFinite(flexLp) && Number.isFinite(flexScore)) {
      if (entry.flexStartLp === null) entry.flexStartLp = flexLp;
      if (!Number.isFinite(Number(entry.flexStartScore))) entry.flexStartScore = flexScore;
      if (!Number.isFinite(Number(playerSnapshot.flexScore))) playerSnapshot.flexScore = flexScore;
      const prevFlex = Number(playerSnapshot.flexScore);
      if (Number.isFinite(prevFlex) && playerSnapshot.lastDateKey === todayKey) {
        const rawStepFlexDelta = flexScore - prevFlex;
        if (isAnomalousLpStep(rawStepFlexDelta, playerSnapshot.lastSeenAt, nowIso)) {
          entry.flexStartLp = flexLp;
          entry.flexCurrentLp = flexLp;
          entry.flexStartScore = flexScore;
          entry.flexCurrentScore = flexScore;
        }
      }
      entry.flexCurrentLp = flexLp;
      entry.flexCurrentScore = flexScore;
      entry.flexDeltaLp = Number.isFinite(Number(entry.flexStartScore))
        ? (flexScore - Number(entry.flexStartScore))
        : 0;
      playerSnapshot.flexLp = flexLp;
      playerSnapshot.flexScore = flexScore;
    }

    entry.lastSeenAt = nowIso;
    playerSnapshot.lastDateKey = todayKey;
    playerSnapshot.lastSeenAt = nowIso;
    dailyMap[key] = entry;
    snapshotByPlayer[key] = playerSnapshot;
  }

  // Keep only the last 14 days to avoid unbounded growth.
  const days = Object.keys(ladderCache.dailyLpByDate).sort();
  while (days.length > 14) {
    const oldest = days.shift();
    delete ladderCache.dailyLpByDate[oldest];
    delete ladderCache.dailySoloqDeltaByDate[oldest];
  }

  if (migratedLegacyRows) {
    ladderCache.activityFeedSchemaVersion = ACTIVITY_FEED_SCHEMA_VERSION;
  }
}

function updateDailySoloqDeltaCache(riotId, delta, dateKey = getDateKey()) {
  const playerKey = String(riotId || "").trim().toLowerCase();
  const safeDelta = Number(delta);
  if (!playerKey || !Number.isFinite(safeDelta) || safeDelta === 0) return;

  const byDate = ladderCache.dailySoloqDeltaByDate || (ladderCache.dailySoloqDeltaByDate = {});
  const dayMap = byDate[dateKey] || (byDate[dateKey] = {});
  const prev = Number(dayMap[playerKey]?.delta || 0);
  dayMap[playerKey] = {
    riotId,
    delta: prev + safeDelta,
    updatedAt: new Date().toISOString(),
  };
}

const QUEUE_TIER_ORDER = [
  "IRON",
  "BRONZE",
  "SILVER",
  "GOLD",
  "PLATINUM",
  "EMERALD",
  "DIAMOND",
  "MASTER",
  "GRANDMASTER",
  "CHALLENGER",
];

const QUEUE_DIVISION_INDEX = { IV: 0, III: 1, II: 2, I: 3 };

function getQueueStandingScore(tier, rank, lp) {
  const safeTier = String(tier || "").toUpperCase();
  const safeRank = String(rank || "").toUpperCase();
  const safeLp = Number(lp);
  if (!safeTier || !Number.isFinite(safeLp)) return -1;
  const tierIdx = QUEUE_TIER_ORDER.indexOf(safeTier);
  if (tierIdx < 0) return -1;

  const isApexTier = ["MASTER", "GRANDMASTER", "CHALLENGER"].includes(safeTier);
  const divisionIdx = isApexTier ? 3 : (QUEUE_DIVISION_INDEX[safeRank] ?? 0);

  // Unified ladder metric: each division step is exactly 100 points.
  // Example: Plat II 90 -> Emerald III 90 = +300.
  return ((tierIdx * 4) + divisionIdx) * 100 + safeLp;
}

function pickStandingWinner(currentBest, candidate, preferHigher) {
  if (!currentBest) return candidate;
  if (candidate.deltaLp !== currentBest.deltaLp) {
    return preferHigher
      ? (candidate.deltaLp > currentBest.deltaLp ? candidate : currentBest)
      : (candidate.deltaLp < currentBest.deltaLp ? candidate : currentBest);
  }

  if (candidate.queueScore !== currentBest.queueScore) {
    return preferHigher
      ? (candidate.queueScore > currentBest.queueScore ? candidate : currentBest)
      : (candidate.queueScore < currentBest.queueScore ? candidate : currentBest);
  }

  return candidate.currentLp > currentBest.currentLp ? candidate : currentBest;
}

function buildDailyHighlights() {
  const todayKey = getDateKey();
  const dailyMap = ladderCache.dailyLpByDate[todayKey] || {};
  const entries = Object.entries(dailyMap);
  const activityDeltaByPlayer = new Map();
  const persistedDailyDeltas = ladderCache.dailySoloqDeltaByDate?.[todayKey] || {};
  for (const [playerKey, payload] of Object.entries(persistedDailyDeltas)) {
    const safeDelta = Number(payload?.delta);
    if (!Number.isFinite(safeDelta)) continue;
    activityDeltaByPlayer.set(String(playerKey || "").toLowerCase(), safeDelta);
  }
  for (const entry of ladderCache.activityFeedHistory || []) {
    const entryDate = getDateKey(new Date(Number(entry?.gameEndTimestamp || Date.parse(String(entry?.updatedAt || "")) || Date.now())));
    if (entryDate !== todayKey) continue;
    const playerKey = String(entry?.player || "").toLowerCase();
    if (!playerKey) continue;
    const delta = Number(entry?.lpDelta);
    if (!Number.isFinite(delta)) continue;
    activityDeltaByPlayer.set(playerKey, (activityDeltaByPlayer.get(playerKey) || 0) + delta);
  }
  const activeSoloqPlayers = new Set(
    (ladderCache.activityFeedHistory || [])
      .filter((entry) => Number(entry?.lpDelta) !== 0)
      .map((entry) => String(entry?.player || "").toLowerCase())
      .filter(Boolean)
  );
  const playersByDailyKey = new Map(
    (ladderCache.players || [])
      .map((player) => [getDailyPlayerKey(player), player])
      .filter(([key]) => Boolean(key))
  );

  let bestSoloqGain = null;
  let bestFlexGain = null;
  let worstSoloqLoss = null;
  let bestOverallGain = null;
  let worstOverallLoss = null;

  for (const [dailyKey, row] of entries) {
    const playerFallback = playersByDailyKey.get(dailyKey) || null;
    let hasAnyQueue = false;
    let hasAnyDeltaActivity = false;
    let totalDelta = 0;
    let standingScore = -1;

    if (Number.isFinite(Number(row.soloqDeltaLp)) && Number.isFinite(row.soloqCurrentLp)) {
      const playerActivityDelta = activityDeltaByPlayer.get(String(row.riotId || "").toLowerCase());
      const netDelta = (Number(row.soloqDeltaLp) === 0 && Number.isFinite(playerActivityDelta))
        ? Number(playerActivityDelta)
        : Number(row.soloqDeltaLp);
      const soloTier = row.soloqTier || playerFallback?.soloq?.tier || null;
      const soloRank = row.soloqRank || playerFallback?.soloq?.rank || null;
      const soloScore = getQueueStandingScore(soloTier, soloRank, row.soloqCurrentLp);
      const hasSoloqActivity = Number(netDelta) !== 0
        || Number(row.soloqBestSingleGainLp || 0) > 0
        || activeSoloqPlayers.has(String(row.riotId || "").toLowerCase());
      hasAnyQueue = true;
      if (Number(netDelta) !== 0) hasAnyDeltaActivity = true;
      totalDelta += netDelta;
      if (soloScore > standingScore) standingScore = soloScore;

      if (hasSoloqActivity) {
        bestSoloqGain = pickStandingWinner(bestSoloqGain, {
          player: row.riotId,
          deltaLp: netDelta,
          currentLp: row.soloqCurrentLp,
          queueScore: soloScore,
        }, true);
        worstSoloqLoss = pickStandingWinner(worstSoloqLoss, {
          player: row.riotId,
          deltaLp: netDelta,
          currentLp: row.soloqCurrentLp,
          queueScore: soloScore,
        }, false);
      }
    }

    if (Number.isFinite(Number(row.flexDeltaLp)) && Number.isFinite(row.flexCurrentLp)) {
      const delta = Number(row.flexDeltaLp);
      const flexTier = row.flexTier || playerFallback?.flex?.tier || null;
      const flexRank = row.flexRank || playerFallback?.flex?.rank || null;
      const flexScore = getQueueStandingScore(flexTier, flexRank, row.flexCurrentLp);
      hasAnyQueue = true;
      if (Number(delta) !== 0) hasAnyDeltaActivity = true;
      totalDelta += delta;
      if (flexScore > standingScore) standingScore = flexScore;
      bestFlexGain = pickStandingWinner(bestFlexGain, {
        player: row.riotId,
        deltaLp: delta,
        currentLp: row.flexCurrentLp,
        queueScore: flexScore,
      }, true);
    }

    if (hasAnyQueue && hasAnyDeltaActivity) {
      bestOverallGain = pickStandingWinner(bestOverallGain, {
        player: row.riotId,
        deltaLp: totalDelta,
        currentLp: Math.max(Number(row.soloqCurrentLp) || 0, Number(row.flexCurrentLp) || 0),
        queueScore: standingScore,
      }, true);
      worstOverallLoss = pickStandingWinner(worstOverallLoss, {
        player: row.riotId,
        deltaLp: totalDelta,
        currentLp: Math.max(Number(row.soloqCurrentLp) || 0, Number(row.flexCurrentLp) || 0),
        queueScore: standingScore,
      }, false);
    }
  }

  // Business rule: winners must represent actual gains (> 0), never losses.
  if (bestSoloqGain && Number(bestSoloqGain.deltaLp) <= 0) bestSoloqGain = null;
  if (bestFlexGain && Number(bestFlexGain.deltaLp) <= 0) bestFlexGain = null;
  if (bestOverallGain && Number(bestOverallGain.deltaLp) <= 0) bestOverallGain = null;

  // Symmetric rule: losers must represent actual losses (< 0), never neutral/positive.
  if (worstSoloqLoss && Number(worstSoloqLoss.deltaLp) >= 0) worstSoloqLoss = null;
  if (worstOverallLoss && Number(worstOverallLoss.deltaLp) >= 0) worstOverallLoss = null;

  return {
    date: todayKey,
    bestSoloqGain,
    bestFlexGain,
    worstSoloqLoss,
    bestOverallGain,
    worstOverallLoss,
  };
}

function getDisplayNameFromRiotId(riotId) {
  const safe = String(riotId || "").trim();
  if (!safe) return "Jugador";
  const [name] = safe.split("#");
  return name || safe;
}

function buildActivityHistoryBootstrap(players = []) {
  const bootstrap = [];
  for (const player of players || []) {
    const puuid = player?.puuid;
    if (!puuid) continue;

    const recentSoloq = (ladderCache.rankedMatchesByPuuid[puuid]?.matches || [])
      .filter((m) => Number(m?.queueId) === 420)
      .sort((a, b) => Number(b?.gameEndTimestamp || 0) - Number(a?.gameEndTimestamp || 0))
      .slice(0, 3);

    for (const match of recentSoloq) {
      const hasKda = Number.isFinite(Number(match?.kills))
        && Number.isFinite(Number(match?.deaths))
        && Number.isFinite(Number(match?.assists));
      const kda = hasKda
        ? `${Math.trunc(Number(match.kills))}/${Math.trunc(Number(match.deaths))}/${Math.trunc(Number(match.assists))}`
        : "s/d";
      const playerName = getDisplayNameFromRiotId(player?.riotId);
      const championName = match?.championName || "campeon";

      bootstrap.push({
        key: `${puuid}:${match?.id || match?.gameEndTimestamp || Date.now()}:0`,
        player: player?.riotId || playerName,
        puuid,
        matchId: match?.id || null,
        lpDelta: 0,
        championName,
        kda,
        gameEndTimestamp: Number(match?.gameEndTimestamp || 0) || 0,
        text: `${playerName} jugo con ${championName} quedando ${kda}`,
        updatedAt: new Date(Number(match?.gameEndTimestamp || Date.now())).toISOString(),
      });
    }
  }

  return bootstrap
    .sort((a, b) => Number(b?.gameEndTimestamp || 0) - Number(a?.gameEndTimestamp || 0))
    .slice(0, ACTIVITY_FEED_HISTORY_LIMIT);
}

function appendActivityHistory(entries = []) {
  const existing = Array.isArray(ladderCache.activityFeedHistory)
    ? ladderCache.activityFeedHistory
    : [];
  const byKey = new Map(existing.map((e) => [String(e?.key || ""), e]));

  for (const next of entries) {
    const key = String(next?.key || "").trim();
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, next);
  }

  ladderCache.activityFeedHistory = Array.from(byKey.values())
    .sort((a, b) => Number(b?.gameEndTimestamp || 0) - Number(a?.gameEndTimestamp || 0))
    .slice(0, ACTIVITY_FEED_HISTORY_LIMIT);
}

function refreshActivityFeedHistory(players = []) {
  const todayKey = getDateKey();
  const dailyMap = ladderCache.dailyLpByDate[todayKey] || {};
  const incoming = [];

  for (const player of players || []) {
    const key = getDailyPlayerKey(player);
    if (!key) continue;
    const row = dailyMap[key];
    if (!row) continue;

    const stepDelta = Number(row?.soloqLastDeltaLp);
    if (!Number.isFinite(stepDelta) || stepDelta === 0) continue;

    const puuid = player?.puuid || row?.puuid || null;
    const recentMatches = puuid ? (ladderCache.rankedMatchesByPuuid[puuid]?.matches || []) : [];
    const latestSoloqMatch = recentMatches
      .filter((m) => Number(m?.queueId) === 420)
      .sort((a, b) => Number(b?.gameEndTimestamp || 0) - Number(a?.gameEndTimestamp || 0))[0] || null;

    const playerName = getDisplayNameFromRiotId(row?.riotId || player?.riotId);
    const championName = latestSoloqMatch?.championName || "campeon";
    const hasKda = Number.isFinite(Number(latestSoloqMatch?.kills))
      && Number.isFinite(Number(latestSoloqMatch?.deaths))
      && Number.isFinite(Number(latestSoloqMatch?.assists));
    const kda = hasKda
      ? `${Math.trunc(Number(latestSoloqMatch.kills))}/${Math.trunc(Number(latestSoloqMatch.deaths))}/${Math.trunc(Number(latestSoloqMatch.assists))}`
      : "s/d";
    const lpAbs = Math.abs(Math.trunc(stepDelta));
    const action = stepDelta < 0 ? "perdio" : "gano";
    const matchId = latestSoloqMatch?.id || null;
    const gameEndTimestamp = Number(latestSoloqMatch?.gameEndTimestamp || Date.parse(String(row?.lastSeenAt || "")) || Date.now());
    const uniqueKey = `${puuid || key}:${matchId || gameEndTimestamp}:${stepDelta}`;

    incoming.push({
      key: uniqueKey,
      player: row?.riotId || player?.riotId || playerName,
      puuid,
      matchId,
      lpDelta: stepDelta,
      championName,
      kda,
      gameEndTimestamp,
      text: `${playerName} ${action} ${lpAbs}lp con ${championName} quedando ${kda}`,
      updatedAt: row?.lastSeenAt || new Date().toISOString(),
    });

    updateDailySoloqDeltaCache(row?.riotId || player?.riotId || playerName, stepDelta, todayKey);
  }

  if (incoming.length > 0) {
    appendActivityHistory(incoming);
    return;
  }

  if (!Array.isArray(ladderCache.activityFeedHistory) || ladderCache.activityFeedHistory.length === 0) {
    ladderCache.activityFeedHistory = buildActivityHistoryBootstrap(players);
  }
}

function buildDetailedActivityFeed() {
  const feed = Array.isArray(ladderCache.activityFeedHistory)
    ? ladderCache.activityFeedHistory
    : [];
  return feed
    .slice()
    .sort((a, b) => Number(b?.gameEndTimestamp || 0) - Number(a?.gameEndTimestamp || 0))
    .slice(0, ACTIVITY_FEED_HISTORY_LIMIT);
}

function patchLegacyActivityEntry(entry) {
  const patched = { ...entry };
  const text = String(patched?.text || "").replace(/\s+/g, " ").trim().replace(/\s*p\.j\.$/i, "").trim();
  patched.text = text;

  const parsedDelta = /\b(gano|perdio)\s+(\d+)\s*lp\b/i.exec(text || "");
  if (parsedDelta) {
    const action = String(parsedDelta[1] || "").toLowerCase();
    const amount = Number(parsedDelta[2]);
    if (Number.isFinite(amount)) {
      patched.lpDelta = action === "perdio" ? -amount : amount;
    }
  } else if (!Number.isFinite(Number(patched.lpDelta))) {
    patched.lpDelta = 0;
  }

  return patched;
}

function patchLegacyActivityFeedHistory(history = []) {
  const safeHistory = Array.isArray(history) ? history : [];
  return safeHistory
    .map((entry) => patchLegacyActivityEntry(entry))
    .slice(0, ACTIVITY_FEED_HISTORY_LIMIT);
}

function getFriendCacheKey(friend) {
  if (!friend || typeof friend !== "object") return null;
  if (friend.puuid) return `puuid:${friend.puuid}`;
  const riotId = normalizeRiotId(friend.gameName, friend.tagLine);
  return riotId ? `riot:${riotId}` : null;
}

function buildFriendKeys(friend, resolvedPlayer) {
  const keys = new Set();
  const friendKey = getFriendCacheKey(friend);
  if (friendKey) keys.add(friendKey);

  if (resolvedPlayer?.puuid) keys.add(`puuid:${resolvedPlayer.puuid}`);
  const resolvedRiotId = normalizeRiotId(resolvedPlayer?.gameName, resolvedPlayer?.tagLine);
  if (resolvedRiotId) keys.add(`riot:${resolvedRiotId}`);

  return Array.from(keys);
}

function saveCacheToFile() {
  try {
    fs.writeFileSync(
      CACHE_FILE,
      JSON.stringify({
        players: ladderCache.players,
        rankedMatchesByPuuid: ladderCache.rankedMatchesByPuuid,
        playerSnapshotByKey: ladderCache.playerSnapshotByKey,
        rawDataByPuuid: ladderCache.rawDataByPuuid,
        dailyLpByDate: ladderCache.dailyLpByDate,
        dailySoloqDeltaByDate: ladderCache.dailySoloqDeltaByDate,
        lpSnapshotByPlayer: ladderCache.lpSnapshotByPlayer,
        activityFeedHistory: ladderCache.activityFeedHistory,
        activityFeedSchemaVersion: ladderCache.activityFeedSchemaVersion,
        refreshCursor: ladderCache.refreshCursor,
        lastUpdatedAt: ladderCache.lastUpdatedAt,
        lastError: ladderCache.lastError,
      }, null, 2)
    );
  } catch (err) {
    console.warn("Could not save cache to file:", err.message);
  }
}

function loadCacheFromFile() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const cached = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
      ladderCache.players = cached.players || [];
      ladderCache.rankedMatchesByPuuid = cached.rankedMatchesByPuuid || {};
      ladderCache.playerSnapshotByKey = cached.playerSnapshotByKey || {};
      ladderCache.rawDataByPuuid = cached.rawDataByPuuid || {};
      ladderCache.dailyLpByDate = cached.dailyLpByDate || {};
      ladderCache.dailySoloqDeltaByDate = cached.dailySoloqDeltaByDate || {};
      ladderCache.lpSnapshotByPlayer = cached.lpSnapshotByPlayer || {};
      ladderCache.activityFeedSchemaVersion = Number(cached.activityFeedSchemaVersion || 1);
      ladderCache.activityFeedHistory = Array.isArray(cached.activityFeedHistory)
        ? cached.activityFeedHistory.slice(0, ACTIVITY_FEED_HISTORY_LIMIT)
        : [];

      // Keep only the last 14 days in-memory and on-disk.
      const validDays = Object.keys(ladderCache.dailyLpByDate || {}).sort().slice(-14);
      const compactDaily = {};
      const compactDailySoloqDelta = {};
      for (const day of validDays) {
        compactDaily[day] = ladderCache.dailyLpByDate[day];
        compactDailySoloqDelta[day] = ladderCache.dailySoloqDeltaByDate?.[day] || {};
      }
      ladderCache.dailyLpByDate = compactDaily;
      ladderCache.dailySoloqDeltaByDate = compactDailySoloqDelta;
      if (ladderCache.activityFeedSchemaVersion < ACTIVITY_FEED_SCHEMA_VERSION) {
        ladderCache.activityFeedHistory = patchLegacyActivityFeedHistory(ladderCache.activityFeedHistory);
        if (ladderCache.activityFeedHistory.length === 0) {
          ladderCache.activityFeedHistory = buildActivityHistoryBootstrap(ladderCache.players);
        }
        ladderCache.activityFeedSchemaVersion = ACTIVITY_FEED_SCHEMA_VERSION;
      } else if (ladderCache.activityFeedHistory.length === 0) {
        ladderCache.activityFeedHistory = buildActivityHistoryBootstrap(ladderCache.players);
      }

      // Rehydrate persistent daily delta cache from existing activity history if needed.
      for (const entry of ladderCache.activityFeedHistory || []) {
        const delta = Number(entry?.lpDelta);
        if (!Number.isFinite(delta) || delta === 0) continue;
        const day = getDateKey(new Date(Number(entry?.gameEndTimestamp || Date.parse(String(entry?.updatedAt || "")) || Date.now())));
        updateDailySoloqDeltaCache(entry?.player, delta, day);
      }

      ladderCache.refreshCursor = Number(cached.refreshCursor) || 0;
      ladderCache.lastUpdatedAt = cached.lastUpdatedAt || null;
      ladderCache.lastError = cached.lastError || null;
      const rawCount = Object.keys(ladderCache.rawDataByPuuid).length;
      console.log(`Loaded ladder cache from file: ${ladderCache.players.length} players, ${rawCount} raw-data entries`);
      return true;
    }
  } catch (err) {
    console.warn("Could not load cache from file:", err.message);
  }
  return false;
}

// Proactive sliding-window rate limiter.
// Waits the minimum time needed so neither budget window is exceeded.
async function waitForRateLimit() {
  // Prune timestamps older than the widest window (2 min).
  const horizon = Date.now() - 120_000;
  while (requestTimestamps.length > 0 && requestTimestamps[0] < horizon) requestTimestamps.shift();

  let waitUntil = Date.now();
  for (const { count, windowMs } of RATE_WINDOW_LIMITS) {
    if (requestTimestamps.length >= count) {
      // The oldest timestamp that would still be inside the window after this call.
      const blockingTs = requestTimestamps[requestTimestamps.length - count];
      const unlockAt = blockingTs + windowMs + 60; // +60 ms safety buffer
      if (unlockAt > waitUntil) waitUntil = unlockAt;
    }
  }

  const delay = waitUntil - Date.now();
  if (delay > 0) {
    console.log(
      `[RATE] Throttling ${delay} ms — window: ${requestTimestamps.length} req in last 2 min`
    );
    await new Promise((r) => setTimeout(r, delay));
  }

  requestTimestamps.push(Date.now());
  totalRiotRequests += 1;
  todayRiotRequests += 1;
  saveApiStatsToFile(false);
}

async function riotFetch(baseUrl) {
  // Reactive: hard block when a 429 was received.
  if (Date.now() < riotRateLimitedUntil) {
    const waitSeconds = Math.ceil((riotRateLimitedUntil - Date.now()) / 1000);
    const err = new Error(`Rate limit activo, reintentando en ${waitSeconds}s`);
    err.code = "RATE_LIMITED";
    throw err;
  }

  // Proactive: sliding-window throttle — never exceeds 18/1 s or 90/2 min.
  await waitForRateLimit();

  const response = await fetch(baseUrl, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-Riot-Token": RIOT_API_KEY,
    },
  });
  const text = await response.text();

  if (response.status === 429) {
    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfterSeconds = Number(retryAfterHeader);
    const retryMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? retryAfterSeconds * 1000
      : RATE_LIMIT_FALLBACK_MS;
    riotRateLimitedUntil = Date.now() + retryMs;

    const err = new Error("Riot API rate limit exceeded");
    err.code = "RATE_LIMITED";
    err.retryAfterMs = retryMs;
    throw err;
  }

  if (!response.ok) {
    throw new Error(`Riot API ${response.status}: ${text || response.statusText}`);
  }
  return text ? JSON.parse(text) : null;
}

function getPreviousPlayerFallback(friend, previousByPuuid, previousByRiotId) {
  if (!friend || typeof friend !== "object") return null;

  if (friend.puuid && previousByPuuid.has(friend.puuid)) {
    return previousByPuuid.get(friend.puuid);
  }

  const normalizedFriendRiotId = normalizeRiotId(friend.gameName, friend.tagLine);
  if (normalizedFriendRiotId && previousByRiotId.has(normalizedFriendRiotId)) {
    return previousByRiotId.get(normalizedFriendRiotId);
  }

  return null;
}

function getSnapshotFallback(friend) {
  const key = getFriendCacheKey(friend);
  if (!key) return null;
  return ladderCache.playerSnapshotByKey[key] || null;
}

function isCacheFresh(lastIso, ttlMs) {
  if (!lastIso || !Number.isFinite(ttlMs) || ttlMs <= 0) return false;
  const lastMs = Date.parse(lastIso);
  if (!Number.isFinite(lastMs)) return false;
  return (Date.now() - lastMs) < ttlMs;
}

// ── Per-step cached fetch helpers ───────────────────────────────────────────
// Each helper tries the live API first, persists the result, and falls back to
// the cached copy so a mid-flight 429 never loses previously good data.

async function fetchSummonerWithCache(puuid) {
  const cachedRaw = ladderCache.rawDataByPuuid[puuid];
  const cachedSummoner = cachedRaw?.summoner;
  if (cachedSummoner && isCacheFresh(cachedRaw?.lastSummonerAt, SUMMONER_REFRESH_TTL_MS)) {
    return cachedSummoner;
  }

  try {
    const summoner = await riotFetch(
      `https://${PLATFORM}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(puuid)}`
    );
    const raw = ladderCache.rawDataByPuuid[puuid] || (ladderCache.rawDataByPuuid[puuid] = {});
    raw.summoner = {
      id: summoner.id || null,
      profileIconId: summoner.profileIconId,
      summonerLevel: summoner.summonerLevel,
    };
    raw.lastSummonerAt = new Date().toISOString();
    return summoner;
  } catch (err) {
    const cached = ladderCache.rawDataByPuuid[puuid]?.summoner;
    if (cached) {
      console.log(`[CACHE] summoner fallback for ${puuid.slice(0, 8)}…`);
      return cached;
    }
    throw err;
  }
}

function isRiot404Error(err) {
  const msg = String(err?.message || "");
  return msg.includes("Riot API 404");
}

async function fetchActiveGameStatusWithCache(puuid, encryptedSummonerId) {
  const raw = ladderCache.rawDataByPuuid[puuid] || (ladderCache.rawDataByPuuid[puuid] = {});
  const cached = raw.activeGameStatus;

  if (cached && isCacheFresh(cached.lastCheckedAt, ACTIVE_GAME_STATUS_TTL_MS)) {
    return cached;
  }

  if (!encryptedSummonerId) {
    const fallback = cached || {
      inGame: false,
      gameId: null,
      gameMode: null,
      gameQueueConfigId: null,
      gameStartTime: null,
      lastCheckedAt: new Date().toISOString(),
    };
    raw.activeGameStatus = fallback;
    return fallback;
  }

  try {
    const activeGame = await riotFetch(
      `https://${PLATFORM}.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/${encodeURIComponent(encryptedSummonerId)}`
    );

    const next = {
      inGame: Boolean(activeGame?.gameId),
      gameId: activeGame?.gameId || null,
      gameMode: activeGame?.gameMode || null,
      gameQueueConfigId: Number.isFinite(Number(activeGame?.gameQueueConfigId))
        ? Number(activeGame.gameQueueConfigId)
        : null,
      gameStartTime: Number.isFinite(Number(activeGame?.gameStartTime))
        ? Number(activeGame.gameStartTime)
        : null,
      lastCheckedAt: new Date().toISOString(),
    };

    raw.activeGameStatus = next;
    return next;
  } catch (err) {
    if (isRiot404Error(err)) {
      const next = {
        inGame: false,
        gameId: null,
        gameMode: null,
        gameQueueConfigId: null,
        gameStartTime: null,
        lastCheckedAt: new Date().toISOString(),
      };
      raw.activeGameStatus = next;
      return next;
    }

    if (cached) {
      console.log(`[CACHE] active game fallback for ${puuid.slice(0, 8)}…`);
      return cached;
    }

    return {
      inGame: false,
      gameId: null,
      gameMode: null,
      gameQueueConfigId: null,
      gameStartTime: null,
      lastCheckedAt: new Date().toISOString(),
    };
  }
}

async function fetchLeagueEntriesWithCache(puuid) {
  try {
    const entries = await riotFetch(
      `https://${PLATFORM}.api.riotgames.com/lol/league/v4/entries/by-puuid/${encodeURIComponent(puuid)}`
    );
    const raw = ladderCache.rawDataByPuuid[puuid] || (ladderCache.rawDataByPuuid[puuid] = {});
    raw.leagueEntries = entries;
    raw.lastLeagueAt = new Date().toISOString();
    return entries;
  } catch (err) {
    const cached = ladderCache.rawDataByPuuid[puuid]?.leagueEntries;
    if (cached) {
      console.log(`[CACHE] league entries fallback for ${puuid.slice(0, 8)}…`);
      return cached;
    }
    throw err;
  }
}

async function fetchAccountByPuuidWithCache(puuid) {
  const cachedRaw = ladderCache.rawDataByPuuid[puuid];
  const cachedAccount = cachedRaw?.account;
  if (cachedAccount && isCacheFresh(cachedRaw?.lastAccountAt, ACCOUNT_REFRESH_TTL_MS)) {
    return cachedAccount;
  }

  try {
    const account = await riotFetch(
      `https://${REGION}.api.riotgames.com/riot/account/v1/accounts/by-puuid/${encodeURIComponent(puuid)}`
    );
    const raw = ladderCache.rawDataByPuuid[puuid] || (ladderCache.rawDataByPuuid[puuid] = {});
    raw.account = { gameName: account.gameName, tagLine: account.tagLine, puuid: account.puuid };
    raw.lastAccountAt = new Date().toISOString();
    return account;
  } catch (err) {
    const cached = ladderCache.rawDataByPuuid[puuid]?.account;
    if (cached) {
      console.log(`[CACHE] account fallback for ${puuid.slice(0, 8)}…`);
      return cached;
    }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

async function fetchPlayerDataFromAccount(account, fallback = {}) {
  const summoner = await fetchSummonerWithCache(account.puuid);
  const entries  = await fetchLeagueEntriesWithCache(account.puuid);
  const activeGameStatus = await fetchActiveGameStatusWithCache(account.puuid, summoner?.id || null);

  const soloq = entries.find((e) => e.queueType === "RANKED_SOLO_5x5") || null;
  const flex  = entries.find((e) => e.queueType === "RANKED_FLEX_SR")  || null;
  const { topChampions, mainRole, recentRankedMatchIds, recentSoloqMatchIds } = await fetchRecentChampionsAndRole(account.puuid);

  // Always persist a fresh snapshot of raw data
  const raw = ladderCache.rawDataByPuuid[account.puuid] || (ladderCache.rawDataByPuuid[account.puuid] = {});
  raw.account = { gameName: account.gameName || fallback.gameName, tagLine: account.tagLine || fallback.tagLine, puuid: account.puuid };

  return {
    riotId: `${account.gameName || fallback.gameName || "Unknown"}#${account.tagLine || fallback.tagLine || "TAG"}`,
    gameName: account.gameName || fallback.gameName || "Unknown",
    tagLine: account.tagLine || fallback.tagLine || "TAG",
    puuid: account.puuid,
    profileIconId: summoner.profileIconId,
    summonerLevel: summoner.summonerLevel,
    soloq,
    flex,
    inGame: Boolean(activeGameStatus?.inGame),
    activeGameStatus,
    topChampions,
    mainRole,
    recentRankedMatchIds,
    recentSoloqMatchIds,
  };
}

function annotateDuoPartners(players) {
  const safePlayers = Array.isArray(players) ? players : [];
  const keyed = safePlayers.filter((p) => p && !p.error && Array.isArray(p.recentSoloqMatchIds));
  const byPlayer = keyed.map((p) => {
    const set = new Set((p.recentSoloqMatchIds || []).filter(Boolean));
    return { player: p, matchSet: set };
  });

  const duoInfoByPuuid = new Map();

  for (let i = 0; i < byPlayer.length; i += 1) {
    const a = byPlayer[i];
    if (!a.player?.puuid || a.matchSet.size === 0) continue;

    let bestPartner = null;
    let bestCount = 0;

    for (let j = 0; j < byPlayer.length; j += 1) {
      if (i === j) continue;
      const b = byPlayer[j];
      if (!b.player?.puuid || b.matchSet.size === 0) continue;

      let overlap = 0;
      for (const id of a.matchSet) {
        if (b.matchSet.has(id)) overlap += 1;
      }

      if (overlap > bestCount) {
        bestCount = overlap;
        bestPartner = b.player;
      }
    }

    if (bestPartner && bestCount >= 2) {
      duoInfoByPuuid.set(a.player.puuid, {
        duoPartner: bestPartner.riotId,
        duoGamesTogetherRecent: bestCount,
      });
    }
  }

  return safePlayers.map((p) => {
    if (!p?.puuid) return p;
    const duo = duoInfoByPuuid.get(p.puuid);
    if (!duo) {
      return {
        ...p,
        duoPartner: null,
        duoGamesTogetherRecent: 0,
      };
    }

    return {
      ...p,
      duoPartner: duo.duoPartner,
      duoGamesTogetherRecent: duo.duoGamesTogetherRecent,
      lastDuoWith: duo.duoPartner,
    };
  });
}

async function fetchPlayerData(gameName, tagLine) {
  const account = await riotFetch(
    `https://${REGION}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`
  );
  if (account?.puuid) {
    const raw = ladderCache.rawDataByPuuid[account.puuid] || (ladderCache.rawDataByPuuid[account.puuid] = {});
    raw.account = { gameName: account.gameName, tagLine: account.tagLine, puuid: account.puuid };
    raw.lastAccountAt = new Date().toISOString();
  }
  return fetchPlayerDataFromAccount(account, { gameName, tagLine });
}

async function fetchPlayerDataByPuuid(puuid) {
  const account = await fetchAccountByPuuidWithCache(puuid);
  return fetchPlayerDataFromAccount(account);
}

const TIER_ORDER = [
  "CHALLENGER", "GRANDMASTER", "MASTER",
  "DIAMOND", "EMERALD", "PLATINUM",
  "GOLD", "SILVER", "BRONZE", "IRON",
];
const RANK_ORDER = ["I", "II", "III", "IV"];

function rankScore(player) {
  if (!player.soloq) return -1;
  const tierIdx = TIER_ORDER.indexOf(player.soloq.tier);
  const rankIdx = RANK_ORDER.indexOf(player.soloq.rank);
  const lp = player.soloq.leaguePoints || 0;
  return (TIER_ORDER.length - tierIdx) * 10000 + (RANK_ORDER.length - rankIdx) * 100 + lp;
}

function readFriends() {
  return JSON.parse(fs.readFileSync(FRIENDS_FILE, "utf8"));
}

function getFriendEmote(friend) {
  if (!friend || typeof friend !== "object") return null;
  if (typeof friend.mote === "string" && friend.mote.trim()) return friend.mote.trim();
  if (typeof friend.emote === "string" && friend.emote.trim()) return friend.emote.trim();
  return null;
}

function normalizeRiotId(gameName, tagLine) {
  if (!gameName || !tagLine) return null;
  return `${String(gameName).trim()}#${String(tagLine).trim()}`.toLowerCase();
}

function buildFriendEmoteMaps(friends) {
  const byPuuid = new Map();
  const byRiotId = new Map();

  for (const friend of friends || []) {
    const emote = getFriendEmote(friend);
    if (!emote) continue;

    if (friend?.puuid) byPuuid.set(friend.puuid, emote);

    const friendRiotId = normalizeRiotId(friend?.gameName, friend?.tagLine);
    if (friendRiotId) byRiotId.set(friendRiotId, emote);
  }

  return { byPuuid, byRiotId };
}

function applyFriendEmotesToPlayers(players, friends) {
  if (!Array.isArray(players) || players.length === 0) return players;
  const { byPuuid, byRiotId } = buildFriendEmoteMaps(friends);

  return players.map((player) => {
    const existingEmote = getFriendEmote(player);
    const byPuuidEmote = player?.puuid ? byPuuid.get(player.puuid) : null;

    const playerRiotId = player?.riotId
      ? String(player.riotId).trim().toLowerCase()
      : normalizeRiotId(player?.gameName, player?.tagLine);
    const byRiotIdEmote = playerRiotId ? byRiotId.get(playerRiotId) : null;

    const resolvedEmote = existingEmote || byPuuidEmote || byRiotIdEmote || null;
    if (resolvedEmote === player?.emote) return player;
    return { ...player, emote: resolvedEmote };
  });
}

async function buildLadderSnapshot(friends, previousPlayers = [], friendIndexesToRefresh = null) {
  const previousByPuuid = new Map();
  const previousByRiotId = new Map();
  for (const player of previousPlayers || []) {
    if (player?.puuid) previousByPuuid.set(player.puuid, player);
    const normalizedPlayerId = normalizeRiotId(player?.gameName, player?.tagLine);
    if (normalizedPlayerId) previousByRiotId.set(normalizedPlayerId, player);
  }

  const shouldRefreshIndex = friendIndexesToRefresh instanceof Set
    ? (idx) => friendIndexesToRefresh.has(idx)
    : () => true;

  const results = [];
  for (let index = 0; index < friends.length; index += 1) {
    const friend = friends[index] || {};

    if (!shouldRefreshIndex(index)) {
      results.push({ status: "skipped" });
      continue;
    }

    try {
      const value = friend?.puuid
        ? await fetchPlayerDataByPuuid(friend.puuid)
        : await fetchPlayerData(friend.gameName, friend.tagLine);
      results.push({ status: "fulfilled", value });
    } catch (reason) {
      results.push({ status: "rejected", reason });
    }
  }

  const players = results
    .map((result, index) => {
      const friend = friends[index] || {};
      const friendEmote = getFriendEmote(friend);

      if (result.status === "skipped") {
        const snapshotFallback = getSnapshotFallback(friend);
        if (snapshotFallback) {
          return {
            ...snapshotFallback,
            emote: friendEmote || snapshotFallback.emote || null,
            staleFromCache: true,
            error: null,
          };
        }

        const previous = getPreviousPlayerFallback(friend, previousByPuuid, previousByRiotId);
        if (previous) {
          return {
            ...previous,
            emote: friendEmote || previous.emote || null,
            staleFromCache: true,
            error: null,
          };
        }

        return {
          riotId:
            friend.gameName && friend.tagLine
              ? `${friend.gameName}#${friend.tagLine}`
              : (friend.puuid || "Unknown#TAG"),
          gameName: friend.gameName || "Unknown",
          tagLine: friend.tagLine || "TAG",
          puuid: friend.puuid || null,
          emote: friendEmote,
          error: "Pendiente de actualizar",
          soloq: null,
        };
      }

      if (result.status === "fulfilled") {
        const snapshot = {
          ...result.value,
          emote: friendEmote,
        };
        const keys = buildFriendKeys(friend, snapshot);
        for (const key of keys) {
          ladderCache.playerSnapshotByKey[key] = snapshot;
        }
        return {
          ...snapshot,
        };
      }

      const snapshotFallback = getSnapshotFallback(friend);
      if (snapshotFallback) {
        const snapshot = {
          ...snapshotFallback,
          emote: friendEmote || snapshotFallback.emote || null,
          staleFromCache: true,
          error: null,
        };
        const keys = buildFriendKeys(friend, snapshot);
        for (const key of keys) {
          ladderCache.playerSnapshotByKey[key] = snapshot;
        }
        return snapshot;
      }

      const previous = getPreviousPlayerFallback(friend, previousByPuuid, previousByRiotId);
      if (previous) {
        const snapshot = {
          ...previous,
          emote: friendEmote || previous.emote || null,
          staleFromCache: true,
          error: null,
        };
        const keys = buildFriendKeys(friend, snapshot);
        for (const key of keys) {
          ladderCache.playerSnapshotByKey[key] = snapshot;
        }
        return snapshot;
      }

      const isRateLimited = result.reason?.code === "RATE_LIMITED";
      return {
        riotId:
          friend.gameName && friend.tagLine
            ? `${friend.gameName}#${friend.tagLine}`
            : (friend.puuid || "Unknown#TAG"),
        gameName: friend.gameName || "Unknown",
        tagLine: friend.tagLine || "TAG",
        puuid: friend.puuid || null,
        emote: friendEmote,
        error: isRateLimited
          ? "Riot en rate limit, reintentando con cache"
          : (result.reason?.message || "Error"),
        soloq: null,
      };
    })
    .sort((a, b) => rankScore(b) - rankScore(a));

  const playersWithEmotes = applyFriendEmotesToPlayers(players, friends);
  const playersWithDuoSignals = annotateDuoPartners(playersWithEmotes);

  // Persist current Riot ID + puuid mapping so name/tag changes are tracked automatically.
  const nextFriends = results.map((result, index) => {
    const friend = friends[index] || {};
    if (result.status !== "fulfilled") return friend;
    const p = result.value;
    const next = {
      gameName: p.gameName,
      tagLine: p.tagLine,
      puuid: p.puuid,
    };
    const friendEmote = getFriendEmote(friend);
    if (friendEmote) next.mote = friendEmote;
    return next;
  });

  return { players: playersWithDuoSignals, nextFriends };
}

async function refreshLadderCache(forceFull = false) {
  if (ladderCache.refreshPromise) {
    return ladderCache.refreshPromise;
  }

  ladderCache.refreshPromise = (async () => {
    const friends = readFriends();
    const previousPlayers = Array.isArray(ladderCache.players) ? ladderCache.players : [];
    const shouldRunFullRefresh = forceFull || FULL_REFRESH_EVERY_CYCLE;

    let friendIndexesToRefresh = null;
    if (!shouldRunFullRefresh) {
      friendIndexesToRefresh = new Set();
      if (friends.length > 0) {
        const batchSize = Math.min(FRIENDS_PER_REFRESH, friends.length);
        const start = ladderCache.refreshCursor % friends.length;
        for (let i = 0; i < batchSize; i += 1) {
          friendIndexesToRefresh.add((start + i) % friends.length);
        }
        ladderCache.refreshCursor = (start + batchSize) % friends.length;
      }
    } else if (friends.length > 0) {
      ladderCache.refreshCursor = 0;
    }

    const { players, nextFriends } = await buildLadderSnapshot(friends, previousPlayers, friendIndexesToRefresh);
    ladderCache.players = players;
    pruneRankedMatchesCacheForActivePuuids(players.map((p) => p?.puuid).filter(Boolean));
    updateDailyLpTracker(players);
    refreshActivityFeedHistory(players);
    ladderCache.lastUpdatedAt = new Date().toISOString();
    ladderCache.lastError = null;
    try {
      fs.writeFileSync(FRIENDS_FILE, JSON.stringify(nextFriends, null, 2));
    } catch (err) {
      console.warn("Could not update friends.json with puuid mapping:", err.message);
    }
    saveCacheToFile();
    return players;
  })();

  try {
    return await ladderCache.refreshPromise;
  } catch (error) {
    ladderCache.lastError = error.message;
    throw error;
  } finally {
    ladderCache.refreshPromise = null;
  }
}

function scheduleLadderRefresh() {
  setInterval(async () => {
    try {
      if (!RIOT_API_KEY) return;
      await refreshLadderCache(true);
    } catch (error) {
      console.error("ERROR refreshing ladder cache:", error.message);
    }
  }, LADDER_CACHE_TTL_MS);
}

app.get("/", (req, res) => {
  if (HAS_CLIENT_BUILD) {
    return res.sendFile(CLIENT_INDEX_FILE);
  }
  res.json({ ok: true, message: "SoloQ Ladder API running" });
});

// GET /api/player?gameName=Azpy&tagLine=1337
app.get("/api/player", async (req, res) => {
  if (!RIOT_API_KEY) {
    return res.status(500).json({ error: "Falta RIOT_API_KEY en server/.env" });
  }
  const { gameName = "Azpy", tagLine = "1337" } = req.query;
  try {
    const data = await fetchPlayerData(gameName, tagLine);
    res.json(data);
  } catch (err) {
    console.error("ERROR /api/player:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ladder  — devuelve todos los amigos ordenados por rank
app.get("/api/ladder", async (req, res) => {
  if (!RIOT_API_KEY) {
    return res.status(500).json({ error: "Falta RIOT_API_KEY en server/.env" });
  }

  try {
    let friendsForEmotes = [];
    try {
      friendsForEmotes = readFriends();
    } catch {
      friendsForEmotes = [];
    }

    if (ladderCache.refreshPromise) {
      await ladderCache.refreshPromise;
    } else if (!ladderCache.lastUpdatedAt) {
      await refreshLadderCache();
    }

    const playersWithEmotes = applyFriendEmotesToPlayers(ladderCache.players, friendsForEmotes);
    res.json({
      players: playersWithEmotes,
      cachedAt: ladderCache.lastUpdatedAt,
      cacheTtlMs: LADDER_CACHE_TTL_MS,
      stale: Boolean(ladderCache.lastError),
      lastError: ladderCache.lastError,
      ddragonVersion: DDRAGON_VERSION,
    });
  } catch (err) {
    let friendsForEmotes = [];
    try {
      friendsForEmotes = readFriends();
    } catch {
      friendsForEmotes = [];
    }

    if (ladderCache.players.length > 0) {
      const playersWithEmotes = applyFriendEmotesToPlayers(ladderCache.players, friendsForEmotes);
      return res.json({
        players: playersWithEmotes,
        cachedAt: ladderCache.lastUpdatedAt,
        cacheTtlMs: LADDER_CACHE_TTL_MS,
        stale: true,
        lastError: err.message,
        ddragonVersion: DDRAGON_VERSION,
      });
    }
    res.status(500).json({ error: err.code === "ENOENT" ? "No se pudo leer friends.json" : err.message });
  }
});

// GET /api/friends  — lista de amigos guardados
app.get("/api/friends", (req, res) => {
  try {
    const friends = readFriends();
    res.json(friends);
  } catch {
    res.status(500).json({ error: "No se pudo leer friends.json" });
  }
});

// POST /api/friends  — añadir amigo { gameName, tagLine }
app.post("/api/friends", requireAdmin, async (req, res) => {
  const { gameName, tagLine, emote, mote } = req.body;
  if (!gameName || !tagLine) {
    return res.status(400).json({ error: "gameName y tagLine son obligatorios" });
  }
  let friends;
  try {
    friends = JSON.parse(fs.readFileSync(FRIENDS_FILE, "utf8"));
  } catch {
    friends = [];
  }
  const exists = friends.some(
    (f) => f.gameName.toLowerCase() === gameName.toLowerCase() &&
           f.tagLine.toLowerCase() === tagLine.toLowerCase()
  );
  if (exists) {
    return res.status(409).json({ error: "Ese jugador ya está en la lista" });
  }
  const friend = { gameName, tagLine };
  const friendEmote =
    (typeof emote === "string" && emote.trim())
      ? emote.trim()
      : (typeof mote === "string" && mote.trim() ? mote.trim() : null);
  if (friendEmote) friend.mote = friendEmote;
  friends.push(friend);
  fs.writeFileSync(FRIENDS_FILE, JSON.stringify(friends, null, 2));

  try {
    if (RIOT_API_KEY) {
      await refreshLadderCache();
    }
  } catch (error) {
    console.error("ERROR refreshing ladder cache after add:", error.message);
  }

  res.status(201).json({ ok: true });
});

// DELETE /api/friends/:gameName/:tagLine
app.delete("/api/friends/:gameName/:tagLine", requireAdmin, async (req, res) => {
  const { gameName, tagLine } = req.params;
  let friends;
  try {
    friends = readFriends();
  } catch {
    return res.status(500).json({ error: "No se pudo leer friends.json" });
  }
  const before = friends.length;
  friends = friends.filter(
    (f) => !(f.gameName.toLowerCase() === gameName.toLowerCase() &&
             f.tagLine.toLowerCase() === tagLine.toLowerCase())
  );
  if (friends.length === before) {
    return res.status(404).json({ error: "Jugador no encontrado" });
  }
  fs.writeFileSync(FRIENDS_FILE, JSON.stringify(friends, null, 2));

  try {
    if (RIOT_API_KEY) {
      await refreshLadderCache();
    }
  } catch (error) {
    console.error("ERROR refreshing ladder cache after delete:", error.message);
  }

  res.json({ ok: true });
});

// POST /api/metrics/page-view — registra visita anonima tras consentimiento
app.post("/api/metrics/page-view", (req, res) => {
  const consentAccepted = Boolean(req.body?.consentAccepted);
  if (!consentAccepted) {
    return res.status(202).json({ ok: true, stored: false, reason: "consent-not-accepted" });
  }

  const pagePath = String(req.body?.pagePath || req.originalUrl || "/").slice(0, 200);
  const country = String(
    req.headers["cf-ipcountry"]
    || req.headers["x-vercel-ip-country"]
    || req.headers["x-country-code"]
    || req.body?.country
    || "unknown"
  ).slice(0, 80);
  const city = String(req.headers["x-vercel-ip-city"] || req.body?.city || "unknown").slice(0, 120);
  const source = String(req.body?.source || req.headers.referer || "direct").slice(0, 220);
  const language = String(req.body?.language || req.headers["accept-language"] || "unknown").slice(0, 80);
  const timezone = String(req.body?.timezone || "unknown").slice(0, 80);
  const screen = String(req.body?.screen || "unknown").slice(0, 40);

  const event = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: "page_view",
    at: new Date().toISOString(),
    pagePath,
    source,
    country,
    city,
    language,
    timezone,
    screen,
    userAgent: String(req.headers["user-agent"] || "unknown").slice(0, 300),
    anonymizedIp: anonymizeIp(getClientIp(req)),
    consentAccepted: true,
  };

  visitMetrics.totalPageViews += 1;
  visitMetrics.totalConsentedPageViews += 1;
  visitMetrics.lastUpdatedAt = event.at;
  visitMetrics.events.push(event);
  if (visitMetrics.events.length > MAX_VISIT_METRICS_EVENTS) {
    visitMetrics.events = visitMetrics.events.slice(-MAX_VISIT_METRICS_EVENTS);
  }
  saveVisitMetricsToFile();

  return res.status(201).json({ ok: true, stored: true });
});

// GET /api/admin/metrics — resumen y detalle de visitas anonimas
app.get("/api/admin/metrics", requireAdmin, (req, res) => {
  const days = {};
  const byCountry = {};
  const byPath = {};

  for (const event of visitMetrics.events) {
    const day = String(event?.at || "").slice(0, 10) || "unknown";
    const country = String(event?.country || "unknown").toUpperCase();
    const pathValue = String(event?.pagePath || "/");

    days[day] = (days[day] || 0) + 1;
    byCountry[country] = (byCountry[country] || 0) + 1;
    byPath[pathValue] = (byPath[pathValue] || 0) + 1;
  }

  const topCountries = Object.entries(byCountry)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([country, views]) => ({ country, views }));

  const topPaths = Object.entries(byPath)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([pathValue, views]) => ({ path: pathValue, views }));

  return res.json({
    ok: true,
    totals: {
      pageViews: visitMetrics.totalPageViews,
      consentedPageViews: visitMetrics.totalConsentedPageViews,
    },
    lastUpdatedAt: visitMetrics.lastUpdatedAt,
    viewsByDay: days,
    topCountries,
    topPaths,
    recentEvents: visitMetrics.events.slice(-120).reverse(),
  });
});

// GET /api/status — expone estado del rate limit y cache para debug
app.get("/api/status", (req, res) => {
  // Daily activity is computed from live refreshes only.

  const now = Date.now();
  const rateLimitSecondsLeft = riotRateLimitedUntil > now
    ? Math.ceil((riotRateLimitedUntil - now) / 1000) : 0;
  const horizon1s = now - 1_000;
  const horizon2min = now - 120_000;
  const req1s = requestTimestamps.filter(t => t > horizon1s).length;
  const req2min = requestTimestamps.filter(t => t > horizon2min).length;
  res.json({
    ok: true,
    riotRateLimited: riotRateLimitedUntil > now,
    riotRateLimitedUntil,
    rateLimitSecondsLeft,
    recentRequests1s: req1s,
    recentRequests2min: req2min,
    totalRequests: totalRiotRequests,
    todayRequests: todayRiotRequests,
    budgetRemaining1s: Math.max(0, 18 - req1s),
    budgetRemaining2min: Math.max(0, 90 - req2min),
    refreshCursor: ladderCache.refreshCursor,
    playersCached: Object.keys(ladderCache.playerSnapshotByKey).length,
    rawDataCached: Object.keys(ladderCache.rawDataByPuuid).length,
    dailyHighlights: buildDailyHighlights(),
    isRefreshing: Boolean(ladderCache.refreshPromise),
    lastUpdatedAt: ladderCache.lastUpdatedAt,
    lastError: ladderCache.lastError,
    timestamp: new Date().toISOString(),
  });
});

// GET /api/activity-feed — actividad diaria en formato textual desglosado
app.get("/api/activity-feed", async (req, res) => {
  if (!RIOT_API_KEY) {
    return res.status(500).json({ error: "Falta RIOT_API_KEY en server/.env" });
  }

  try {
    if (ladderCache.refreshPromise) {
      await ladderCache.refreshPromise;
    } else if (!ladderCache.lastUpdatedAt) {
      await refreshLadderCache();
    }

    const entries = buildDetailedActivityFeed();
    return res.json({
      date: getDateKey(),
      updatedAt: ladderCache.lastUpdatedAt,
      entries,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/force-refresh — fuerza refresco inmediato de todos los jugadores
app.post("/api/force-refresh", requireAdmin, async (req, res) => {
  if (!RIOT_API_KEY) return res.status(500).json({ error: "Sin RIOT_API_KEY" });
  if (ladderCache.refreshPromise) {
    await ladderCache.refreshPromise.catch(() => {});
    return res.json({ ok: true, message: "Ya había un refresh en curso, completado", playersCount: ladderCache.players.length });
  }
  try {
    await refreshLadderCache(true);
    res.json({ ok: true, message: "Refresh completado", playersCount: ladderCache.players.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

if (HAS_CLIENT_BUILD) {
  app.use(express.static(CLIENT_DIST_DIR));

  // SPA fallback for non-API, non-asset GET routes.
  app.get(/^(?!\/api\/|\/assets\/).*/, (req, res, next) => {
    if (req.method !== "GET") return next();
    return res.sendFile(CLIENT_INDEX_FILE);
  });
}

app.use((req, res) => {
  res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.originalUrl}` });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

fetchDDragonVersion().catch(console.error);

loadApiStatsFromFile();
loadVisitMetricsFromFile();

// Load cache from file on startup — NO API calls
const cacheLoadedFromDisk = loadCacheFromFile();
if (!cacheLoadedFromDisk) {
  console.log("No cache file found. Ladder will be empty until first refresh.");
}

// Schedule periodic refresh; skip forced full refresh on startup when cache exists.
if (RIOT_API_KEY) {
  if (!cacheLoadedFromDisk) {
    refreshLadderCache().catch((error) => {
      console.error("ERROR on first refresh:", error.message);
    });
  } else {
    console.log("Using cached ladder snapshot from disk. Triggering startup background refresh.");
    refreshLadderCache().catch((error) => {
      console.error("ERROR on startup background refresh:", error.message);
    });
  }
}

scheduleLadderRefresh();

process.on("SIGINT", () => {
  saveApiStatsToFile(true);
  saveVisitMetricsToFile();
  process.exit(0);
});

process.on("SIGTERM", () => {
  saveApiStatsToFile(true);
  saveVisitMetricsToFile();
  process.exit(0);
});

process.on("exit", () => {
  saveApiStatsToFile(true);
  saveVisitMetricsToFile();
});

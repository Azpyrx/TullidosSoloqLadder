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
const REGION = "europe";
const PLATFORM = "euw1";
const LADDER_CACHE_TTL_MS = Number(process.env.LADDER_CACHE_TTL_MS) || 60 * 1000;
const MATCH_SYNC_TTL_MS = Number(process.env.MATCH_SYNC_TTL_MS) || 30 * 60 * 1000;
const RATE_LIMIT_FALLBACK_MS = Number(process.env.RATE_LIMIT_FALLBACK_MS) || 60 * 1000;
const FRIENDS_PER_REFRESH = Math.max(1, Number(process.env.FRIENDS_PER_REFRESH) || 2);

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

function getDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
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
      let { topChampions, mainRole } = buildChampionRoleSummary(existingMatches.slice(0, 20));
      if (topChampions.length === 0) {
        topChampions = await fetchTopMasteryChampions(puuid);
      }

      return {
        topChampions,
        mainRole,
        recentRankedMatchIds: existingMatches.slice(0, 20).map((m) => m.id),
      };
    }

    const hasBootstrapData = existingMatches.length >= 20;

    const soloFetchCount = hasBootstrapData ? 4 : 5;
    const flexFetchCount = hasBootstrapData ? 4 : 5;

    const soloMatchIds = await riotFetch(
      `https://${REGION}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=420&count=${soloFetchCount}`
    ).catch(() => []);

    const flexMatchIds = await riotFetch(
      `https://${REGION}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=440&count=${flexFetchCount}`
    ).catch(() => []);

    let incomingIds = Array.from(new Set([...(soloMatchIds || []), ...(flexMatchIds || [])]));

    if (incomingIds.length === 0 && !hasBootstrapData) {
      incomingIds = await riotFetch(
        `https://${REGION}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?count=5`
      ).catch(() => []);
    }

    const existingById = new Map(existingMatches.map((m) => [m.id, m]));
    const idsToFetch = incomingIds.filter((id) => !existingById.has(id)).slice(0, 4);

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

    const finalMatches = merged.slice(0, 20);
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
      recentRankedMatchIds: fallback.slice(0, 20).map((m) => m.id),
    };
  }
}

const ladderCache = {
  players: [],
  rankedMatchesByPuuid: {},
  playerSnapshotByKey: {},
  // Raw per-puuid API data — persistent fallback for every step of the fetch pipeline.
  rawDataByPuuid: {},
  dailyLpByDate: {},
  lpSnapshotByPlayer: {},
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

  for (const player of players || []) {
    if (!player || player.error) continue;
    const key = getDailyPlayerKey(player);
    if (!key) continue;

    const soloLp = Number(player?.soloq?.leaguePoints);
    const flexLp = Number(player?.flex?.leaguePoints);

    const entry = dailyMap[key] || {
      puuid: player.puuid || null,
      riotId: player.riotId || "Unknown",
      soloqStartLp: Number.isFinite(soloLp) ? soloLp : null,
      soloqCurrentLp: Number.isFinite(soloLp) ? soloLp : null,
      soloqDeltaLp: 0,
      flexStartLp: Number.isFinite(flexLp) ? flexLp : null,
      flexCurrentLp: Number.isFinite(flexLp) ? flexLp : null,
      flexDeltaLp: 0,
      firstSeenAt: nowIso,
      lastSeenAt: nowIso,
    };

    const playerSnapshot = snapshotByPlayer[key] || {
      soloqLp: null,
      flexLp: null,
      lastDateKey: null,
      lastSeenAt: null,
    };

    entry.riotId = player.riotId || entry.riotId;
    entry.puuid = player.puuid || entry.puuid;

    if (Number.isFinite(soloLp)) {
      if (entry.soloqStartLp === null) entry.soloqStartLp = soloLp;
      const prevSolo = Number(playerSnapshot.soloqLp);
      if (Number.isFinite(prevSolo) && playerSnapshot.lastDateKey === todayKey) {
        entry.soloqDeltaLp = Number(entry.soloqDeltaLp || 0) + (soloLp - prevSolo);
      }
      entry.soloqCurrentLp = soloLp;
      playerSnapshot.soloqLp = soloLp;
    }

    if (Number.isFinite(flexLp)) {
      if (entry.flexStartLp === null) entry.flexStartLp = flexLp;
      const prevFlex = Number(playerSnapshot.flexLp);
      if (Number.isFinite(prevFlex) && playerSnapshot.lastDateKey === todayKey) {
        entry.flexDeltaLp = Number(entry.flexDeltaLp || 0) + (flexLp - prevFlex);
      }
      entry.flexCurrentLp = flexLp;
      playerSnapshot.flexLp = flexLp;
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
  }
}

function buildDailyHighlights() {
  const todayKey = getDateKey();
  const dailyMap = ladderCache.dailyLpByDate[todayKey] || {};
  const entries = Object.values(dailyMap);

  let bestSoloqGain = null;
  let bestFlexGain = null;
  let worstSoloqLoss = null;
  let bestOverallGain = null;
  let worstOverallLoss = null;

  for (const row of entries) {
    let hasAnyQueue = false;
    let totalDelta = 0;

    if (Number.isFinite(row.soloqStartLp) && Number.isFinite(row.soloqCurrentLp)) {
      const delta = Number.isFinite(Number(row.soloqDeltaLp))
        ? Number(row.soloqDeltaLp)
        : (row.soloqCurrentLp - row.soloqStartLp);
      hasAnyQueue = true;
      totalDelta += delta;
      if (!bestSoloqGain || delta > bestSoloqGain.deltaLp) {
        bestSoloqGain = { player: row.riotId, deltaLp: delta, currentLp: row.soloqCurrentLp };
      }
      if (!worstSoloqLoss || delta < worstSoloqLoss.deltaLp) {
        worstSoloqLoss = { player: row.riotId, deltaLp: delta, currentLp: row.soloqCurrentLp };
      }
    }

    if (Number.isFinite(row.flexStartLp) && Number.isFinite(row.flexCurrentLp)) {
      const delta = Number.isFinite(Number(row.flexDeltaLp))
        ? Number(row.flexDeltaLp)
        : (row.flexCurrentLp - row.flexStartLp);
      hasAnyQueue = true;
      totalDelta += delta;
      if (!bestFlexGain || delta > bestFlexGain.deltaLp) {
        bestFlexGain = { player: row.riotId, deltaLp: delta, currentLp: row.flexCurrentLp };
      }
    }

    if (hasAnyQueue) {
      if (!bestOverallGain || totalDelta > bestOverallGain.deltaLp) {
        bestOverallGain = { player: row.riotId, deltaLp: totalDelta };
      }
      if (!worstOverallLoss || totalDelta < worstOverallLoss.deltaLp) {
        worstOverallLoss = { player: row.riotId, deltaLp: totalDelta };
      }
    }
  }

  // Fallback: if daily tracker is empty (or has only unranked rows),
  // derive a neutral snapshot from current cached players so UI cards
  // never render as fully empty.
  if (!bestSoloqGain || !worstSoloqLoss || !bestFlexGain) {
    const rankedSolo = (ladderCache.players || [])
      .filter((p) => p && !p.error && p.soloq)
      .sort((a, b) => rankScore(b) - rankScore(a));

    const rankedFlex = (ladderCache.players || [])
      .filter((p) => p && !p.error && p.flex)
      .sort((a, b) => {
        const aTier = TIER_ORDER.indexOf(a.flex.tier);
        const bTier = TIER_ORDER.indexOf(b.flex.tier);
        const aRank = RANK_ORDER.indexOf(a.flex.rank);
        const bRank = RANK_ORDER.indexOf(b.flex.rank);
        const aLp = Number(a.flex.leaguePoints) || 0;
        const bLp = Number(b.flex.leaguePoints) || 0;
        return ((TIER_ORDER.length - bTier) * 10000 + (RANK_ORDER.length - bRank) * 100 + bLp)
          - ((TIER_ORDER.length - aTier) * 10000 + (RANK_ORDER.length - aRank) * 100 + aLp);
      });

    if (!bestSoloqGain && rankedSolo.length > 0) {
      const p = rankedSolo[0];
      bestSoloqGain = {
        player: p.riotId,
        deltaLp: 0,
        currentLp: Number(p?.soloq?.leaguePoints) || 0,
      };
    }

    if (!worstSoloqLoss && rankedSolo.length > 0) {
      const p = rankedSolo[rankedSolo.length - 1];
      worstSoloqLoss = {
        player: p.riotId,
        deltaLp: 0,
        currentLp: Number(p?.soloq?.leaguePoints) || 0,
      };
    }

    if (!bestFlexGain && rankedFlex.length > 0) {
      const p = rankedFlex[0];
      bestFlexGain = {
        player: p.riotId,
        deltaLp: 0,
        currentLp: Number(p?.flex?.leaguePoints) || 0,
      };
    }

    if (!bestOverallGain && rankedSolo.length > 0) {
      const p = rankedSolo[0];
      bestOverallGain = {
        player: p.riotId,
        deltaLp: 0,
      };
    }

    if (!worstOverallLoss && rankedSolo.length > 0) {
      const p = rankedSolo[rankedSolo.length - 1];
      worstOverallLoss = {
        player: p.riotId,
        deltaLp: 0,
      };
    }
  }

  return {
    date: todayKey,
    bestSoloqGain,
    bestFlexGain,
    worstSoloqLoss,
    bestOverallGain,
    worstOverallLoss,
  };
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
        lpSnapshotByPlayer: ladderCache.lpSnapshotByPlayer,
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
      ladderCache.lpSnapshotByPlayer = cached.lpSnapshotByPlayer || {};
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

// ── Per-step cached fetch helpers ───────────────────────────────────────────
// Each helper tries the live API first, persists the result, and falls back to
// the cached copy so a mid-flight 429 never loses previously good data.

async function fetchSummonerWithCache(puuid) {
  try {
    const summoner = await riotFetch(
      `https://${PLATFORM}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(puuid)}`
    );
    const raw = ladderCache.rawDataByPuuid[puuid] || (ladderCache.rawDataByPuuid[puuid] = {});
    raw.summoner = { profileIconId: summoner.profileIconId, summonerLevel: summoner.summonerLevel };
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

  const soloq = entries.find((e) => e.queueType === "RANKED_SOLO_5x5") || null;
  const flex  = entries.find((e) => e.queueType === "RANKED_FLEX_SR")  || null;
  const { topChampions, mainRole } = await fetchRecentChampionsAndRole(account.puuid);

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
    topChampions,
    mainRole,
  };
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

  return { players: playersWithEmotes, nextFriends };
}

async function refreshLadderCache(forceFull = false) {
  if (ladderCache.refreshPromise) {
    return ladderCache.refreshPromise;
  }

  ladderCache.refreshPromise = (async () => {
    const friends = readFriends();
    const previousPlayers = Array.isArray(ladderCache.players) ? ladderCache.players : [];

    let friendIndexesToRefresh = null;
    if (!forceFull) {
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
    updateDailyLpTracker(players);
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
      await refreshLadderCache();
    } catch (error) {
      console.error("ERROR refreshing ladder cache:", error.message);
    }
  }, LADDER_CACHE_TTL_MS);
}

app.get("/", (req, res) => {
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
app.post("/api/friends", async (req, res) => {
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
app.delete("/api/friends/:gameName/:tagLine", async (req, res) => {
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

// GET /api/status — expone estado del rate limit y cache para debug
app.get("/api/status", (req, res) => {
  const todayKey = getDateKey();
  const hasTodayDailyMap = Boolean(ladderCache.dailyLpByDate[todayKey])
    && Object.keys(ladderCache.dailyLpByDate[todayKey]).length > 0;

  if (!hasTodayDailyMap && Array.isArray(ladderCache.players) && ladderCache.players.length > 0) {
    updateDailyLpTracker(ladderCache.players);
    saveCacheToFile();
  }

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

// POST /api/force-refresh — fuerza refresco inmediato de todos los jugadores
app.post("/api/force-refresh", async (req, res) => {
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

app.use((req, res) => {
  res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.originalUrl}` });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

fetchDDragonVersion().catch(console.error);

loadApiStatsFromFile();

// Load cache from file on startup — NO API calls
const cacheLoadedFromDisk = loadCacheFromFile();
if (!cacheLoadedFromDisk) {
  console.log("No cache file found. Ladder will be empty until first refresh.");
} else if (Array.isArray(ladderCache.players) && ladderCache.players.length > 0) {
  // Seed today's LP baseline from cached snapshot so daily highlights are available immediately.
  updateDailyLpTracker(ladderCache.players);
  saveCacheToFile();
}

// Schedule periodic refresh; skip forced full refresh on startup when cache exists.
if (RIOT_API_KEY) {
  if (!cacheLoadedFromDisk) {
    refreshLadderCache().catch((error) => {
      console.error("ERROR on first refresh:", error.message);
    });
  } else {
    console.log("Using cached ladder snapshot from disk. Background refresh will run on schedule.");
  }
}

scheduleLadderRefresh();

process.on("SIGINT", () => {
  saveApiStatsToFile(true);
  process.exit(0);
});

process.on("SIGTERM", () => {
  saveApiStatsToFile(true);
  process.exit(0);
});

process.on("exit", () => {
  saveApiStatsToFile(true);
});

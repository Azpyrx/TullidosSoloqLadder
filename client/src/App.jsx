import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import "./index.css";
import AppLayout from "./components/AppLayout.jsx";
import Masonry from "react-masonry-css";
import AdminPanel from "./components/AdminPanel.jsx";
import PrivacyPage from "./components/PrivacyPage.jsx";

const RAW_API_ENV = String(import.meta.env.VITE_API_URL || "").trim();
const IS_LOCAL_API_URL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(RAW_API_ENV);
const SHOULD_IGNORE_LOCAL_API_IN_PROD = !import.meta.env.DEV && IS_LOCAL_API_URL;
const API_BASE = SHOULD_IGNORE_LOCAL_API_IN_PROD
  ? window.location.origin
  : (RAW_API_ENV || (import.meta.env.DEV ? "http://localhost:3001" : window.location.origin));
const API = API_BASE;
const CONSENT_STORAGE_KEY = "tsl-analytics-consent";
const PROFILE_PLATFORM_STORAGE_KEY = "tsl-favorite-platform";
const PROFILE_PLATFORM_OPTIONS = [
  {
    key: "dpm",
    label: "dpm.lol",
    icon: "https://www.google.com/s2/favicons?domain=dpm.lol&sz=64",
    buildUrl: buildDpmLolUrlFromRiotId,
  },
  {
    key: "opgg",
    label: "OP.GG",
    icon: "https://www.google.com/s2/favicons?domain=op.gg&sz=64",
    buildUrl: buildOpggUrlFromRiotId,
  },
  {
    key: "deeplol",
    label: "deeplol.gg",
    icon: "https://www.google.com/s2/favicons?domain=deeplol.gg&sz=64",
    buildUrl: buildDeeplolUrlFromRiotId,
  },
  {
    key: "log",
    label: "League of Graphs",
    icon: "https://www.google.com/s2/favicons?domain=leagueofgraphs.com&sz=64",
    buildUrl: buildLeagueOfGraphsUrlFromRiotId,
  },
];

function tabFromPathname(pathname) {
  const normalized = String(pathname || "").toLowerCase();
  if (normalized === "/admin") return "admin";
  if (normalized === "/privacidad") return "privacy";
  if (normalized === "/actividad") return "activity";
  if (normalized === "/usuarios") return "users";
  if (normalized === "/info") return "info";
  return "ranking";
}

function pathFromTab(tabId) {
  if (tabId === "admin") return "/admin";
  if (tabId === "privacy") return "/privacidad";
  if (tabId === "activity") return "/actividad";
  if (tabId === "users") return "/usuarios";
  if (tabId === "info") return "/info";
  return "/";
}

const TIER_COLORS = {
  CHALLENGER: "#f0e68c",
  GRANDMASTER: "#ff6b6b",
  MASTER: "#c084fc",
  DIAMOND: "#60a5fa",
  EMERALD: "#34d399",
  PLATINUM: "#2dd4bf",
  GOLD: "#d4af37",
  SILVER: "#94a3b8",
  BRONZE: "#b87333",
  IRON: "#9ca3af",
};

const RANK_ICONS = {
  CHALLENGER: `${API_BASE}/assets/icons/rank/challenger.png`,
  GRANDMASTER: `${API_BASE}/assets/icons/rank/grandmaster.png`,
  MASTER: `${API_BASE}/assets/icons/rank/master.png`,
  DIAMOND: `${API_BASE}/assets/icons/rank/diamond.png`,
  EMERALD: `${API_BASE}/assets/icons/rank/emerald.png`,
  PLATINUM: `${API_BASE}/assets/icons/rank/platinum.png`,
  GOLD: `${API_BASE}/assets/icons/rank/gold.png`,
  SILVER: `${API_BASE}/assets/icons/rank/silver.png`,
  BRONZE: `${API_BASE}/assets/icons/rank/bronze.png`,
  IRON: `${API_BASE}/assets/icons/rank/iron.png`,
};

const TIER_LABELS = {
  CHALLENGER: "Aspirante",
  GRANDMASTER: "Gran Maestro",
  MASTER: "Maestro",
  DIAMOND: "Diamante",
  EMERALD: "Esmeralda",
  PLATINUM: "Platino",
  GOLD: "Oro",
  SILVER: "Plata",
  BRONZE: "Bronce",
  IRON: "Hierro",
};

function RankBadge({ rankData, queueLabel }) {
  const isRanked = Boolean(rankData);
  const color = isRanked ? (TIER_COLORS[rankData.tier] || "#94a3b8") : "#9fb2cf";
  const iconUrl = isRanked ? (RANK_ICONS[rankData.tier] || "") : "";
  const tierLabel = isRanked ? (TIER_LABELS[rankData.tier] || rankData.tier) : "Sin rank";
  const title = isRanked
    ? `${queueLabel}: ${rankData.tier} ${rankData.rank} · ${rankData.leaguePoints} LP`
    : `${queueLabel}: Sin rank`;

  return (
    <div className={`rank-badge-compact ${isRanked ? "" : "is-unranked"}`} title={title}>
      <span className="queue-label">{queueLabel}</span>
      <span className="rank-icon-slot" aria-hidden="true">
        {iconUrl && (
          <img src={iconUrl} alt={rankData.tier} className="rank-icon" onError={(e) => { e.target.style.display = "none"; }} />
        )}
      </span>
      <div className="rank-info">
        <span className="rank-text">{tierLabel}</span>
        {isRanked && <span className="rank-division">{rankData.rank}</span>}
        <span className="rank-lp" style={{ color }}>{isRanked ? `${rankData.leaguePoints} LP` : "---"}</span>
      </div>
    </div>
  );
}

function WinRate({ wins, losses, label }) {
  const total = wins + losses;
  if (!total) return null;
  const wr = (wins / total) * 100;
  const wrText = wr.toFixed(1);
  let color = "#9fb2cf";
  if (wr >= 55) color = "#1fbf75";
  else if (wr >= 52) color = "#76d8a8";
  else if (wr >= 49) color = "#b7c5dd";
  else if (wr >= 46) color = "#ffb1b1";
  else color = "#ff6b6b";
  return (
    <span style={{ color, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {label && <strong style={{ color: '#8aa4c8', fontSize: '10px', fontWeight: 800, letterSpacing: '0.06em' }}>{label}</strong>}
      {wins}W/{losses}L · {wrText}%
    </span>
  );
}

const ROLE_LABELS = {
  TOP: "Top",
  JUNGLE: "Jungla",
  MID: "Mid",
  MIDDLE: "Mid",
  BOTTOM: "ADC",
  UTILITY: "Support",
};

const ROLE_ICONS = {
  TOP: `${API_BASE}/assets/icons/position/top.png`,
  JUNGLE: `${API_BASE}/assets/icons/position/jungle.png`,
  MID: `${API_BASE}/assets/icons/position/mid.png`,
  MIDDLE: `${API_BASE}/assets/icons/position/mid.png`,
  BOTTOM: `${API_BASE}/assets/icons/position/adc.png`,
  UTILITY: `${API_BASE}/assets/icons/position/support.png`,
};

const TIER_ORDER = [
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

const DIVISION_INDEX = { IV: 0, III: 1, II: 2, I: 3 };

const PLAYER_OWNER_ALIASES = {
  "hachitas#norge": "Hachitas",
  "adxking1#111": "Hachitas",
  "trago amargo#tired": "Hachitas",
  "benzina#bnz": "Hachitas",
  "azpy#1337": "Azpy",
  "newjeans hanni#1975": "Azpy",
  "shambles#125": "Azpy",
  "leruno#gzzz": "leruno",
  "marlboro#fumas": "leruno",
  "slayer psycho#euw": "Guantes",
  "łm not perfect#euw": "Guantes",
  "xryt360#ifd": "Ryt",
  "xryt360#euw": "Ryt",
  "xryt#ifd": "Ryt",
  "xryt#euw": "Ryt",
};

function normalizeRole(role) {
  if (!role) return null;
  if (role === "MIDDLE") return "MID";
  if (role === "BOT") return "BOTTOM";
  if (role === "SUPPORT") return "UTILITY";
  return role;
}

function getSoloqScore(player) {
  if (!player?.soloq) return -1;
  const safeTier = String(player?.soloq?.tier || "").toUpperCase();
  const safeRank = String(player?.soloq?.rank || "").toUpperCase();
  const safeLp = Number(player?.soloq?.leaguePoints);
  if (!Number.isFinite(safeLp)) return -1;

  const tierIdx = TIER_ORDER.indexOf(safeTier);
  if (tierIdx < 0) return -1;
  const isApexTier = ["MASTER", "GRANDMASTER", "CHALLENGER"].includes(safeTier);
  const divisionIdx = isApexTier ? 3 : (DIVISION_INDEX[safeRank] ?? 0);

  return ((tierIdx * 4) + divisionIdx) * 100 + safeLp;
}

function getFlexScore(player) {
  if (!player?.flex) return -1;
  const safeTier = String(player?.flex?.tier || "").toUpperCase();
  const safeRank = String(player?.flex?.rank || "").toUpperCase();
  const safeLp = Number(player?.flex?.leaguePoints);
  if (!Number.isFinite(safeLp)) return -1;

  const tierIdx = TIER_ORDER.indexOf(safeTier);
  if (tierIdx < 0) return -1;
  const isApexTier = ["MASTER", "GRANDMASTER", "CHALLENGER"].includes(safeTier);
  const divisionIdx = isApexTier ? 3 : (DIVISION_INDEX[safeRank] ?? 0);

  return ((tierIdx * 4) + divisionIdx) * 100 + safeLp;
}

function getQueueScore(player, queueType) {
  return queueType === "flex" ? getFlexScore(player) : getSoloqScore(player);
}

function buildOpggUrlFromRiotId(riotId) {
  const raw = String(riotId || "").trim();
  if (!raw || !raw.includes("#")) return null;
  const [gameNameRaw, tagLineRaw] = raw.split("#");
  const gameName = String(gameNameRaw || "").trim();
  const tagLine = String(tagLineRaw || "").trim();
  if (!gameName || !tagLine) return null;

  const slug = `${encodeURIComponent(gameName)}-${encodeURIComponent(tagLine)}`;
  return `https://www.op.gg/summoners/euw/${slug}`;
}

function buildLeagueOfGraphsUrlFromRiotId(riotId) {
  const raw = String(riotId || "").trim();
  if (!raw || !raw.includes("#")) return null;
  const [gameNameRaw, tagLineRaw] = raw.split("#");
  const gameName = String(gameNameRaw || "").trim();
  const tagLine = String(tagLineRaw || "").trim();
  if (!gameName || !tagLine) return null;
  return `https://www.leagueofgraphs.com/summoner/euw/${encodeURIComponent(gameName)}-${encodeURIComponent(tagLine)}`;
}

function buildLeagueOfGraphsLiveUrlFromRiotId(riotId) {
  const raw = String(riotId || "").trim();
  if (!raw || !raw.includes("#")) return null;
  const [gameNameRaw, tagLineRaw] = raw.split("#");
  const gameName = String(gameNameRaw || "").trim();
  const tagLine = String(tagLineRaw || "").trim();
  if (!gameName || !tagLine) return null;
  return `https://www.leagueofgraphs.com/summoner/euw/${encodeURIComponent(gameName)}-${encodeURIComponent(tagLine)}/live-game`;
}

function buildDeeplolUrlFromRiotId(riotId) {
  const raw = String(riotId || "").trim();
  if (!raw || !raw.includes("#")) return null;
  const [gameNameRaw, tagLineRaw] = raw.split("#");
  const gameName = String(gameNameRaw || "").trim();
  const tagLine = String(tagLineRaw || "").trim();
  if (!gameName || !tagLine) return null;
  return `https://www.deeplol.gg/summoner/euw/${encodeURIComponent(gameName)}-${encodeURIComponent(tagLine)}`;
}

function buildDpmLolUrlFromRiotId(riotId) {
  const raw = String(riotId || "").trim();
  if (!raw || !raw.includes("#")) return null;
  const [gameNameRaw, tagLineRaw] = raw.split("#");
  const gameName = String(gameNameRaw || "").trim();
  const tagLine = String(tagLineRaw || "").trim();
  if (!gameName || !tagLine) return null;
  return `https://dpm.lol/${encodeURIComponent(gameName)}-${encodeURIComponent(tagLine)}`;
}

function getProfilePlatformLinks(riotId) {
  return PROFILE_PLATFORM_OPTIONS
    .map((platform) => ({
      key: platform.key,
      label: platform.label,
      icon: platform.icon,
      url: platform.buildUrl(riotId),
    }))
    .filter((item) => Boolean(item.url));
}

function getPreferredPlatformUrl(riotId, preferredPlatformKey) {
  const preferred = PROFILE_PLATFORM_OPTIONS.find((platform) => platform.key === preferredPlatformKey);
  const fallback = PROFILE_PLATFORM_OPTIONS.find((platform) => platform.key === "opgg");
  const preferredUrl = preferred?.buildUrl?.(riotId) || null;
  if (preferredUrl) return preferredUrl;
  return fallback?.buildUrl?.(riotId) || null;
}

function buildOpggMatchUrlFromEntry(entry) {
  const matchId = String(entry?.matchId || "").trim();
  if (!matchId) return null;
  const normalizedGameId = matchId.includes("_") ? matchId.split("_").pop() : matchId;
  if (!normalizedGameId) return null;
  return `https://www.leagueofgraphs.com/match/euw/${encodeURIComponent(normalizedGameId)}`;
}

function formatActivityText(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.replace(/\s*p\.j\.$/i, "").trim();
}

function playActivityPopupSound(delta) {
  if (typeof window === "undefined") return;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;

  const safeDelta = Number(delta);
  const nowSeconds = 0;

  try {
    const ctx = new AudioCtx();
    const base = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = 0.0001;
    master.connect(ctx.destination);

    const sequence = safeDelta > 0
      ? [523.25, 659.25, 783.99]
      : [392.0, 329.63, 261.63];

    sequence.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = safeDelta > 0 ? "triangle" : "sawtooth";
      osc.frequency.setValueAtTime(freq, base + nowSeconds + (idx * 0.09));

      gain.gain.setValueAtTime(0.0001, base + nowSeconds + (idx * 0.09));
      gain.gain.exponentialRampToValueAtTime(0.09, base + nowSeconds + (idx * 0.09) + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, base + nowSeconds + (idx * 0.09) + 0.12);

      osc.connect(gain);
      gain.connect(master);
      osc.start(base + nowSeconds + (idx * 0.09));
      osc.stop(base + nowSeconds + (idx * 0.09) + 0.14);
    });

    master.gain.setValueAtTime(0.0001, base);
    master.gain.exponentialRampToValueAtTime(0.18, base + 0.02);
    master.gain.exponentialRampToValueAtTime(0.0001, base + 0.5);

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 650);
  } catch {
    // Some browsers block autoplay audio until user interaction.
  }
}

const CHAMPION_ASSET_ALIASES = {
  fiddlesticks: "Fiddlesticks",
  fiddlestick: "Fiddlesticks",
  monkeyking: "MonkeyKing",
  nunuandwillump: "Nunu",
  khazix: "Khazix",
  kogmaw: "KogMaw",
  chogath: "Chogath",
  reksai: "RekSai",
  belveth: "Belveth",
  drmundo: "DrMundo",
  jarvaniv: "JarvanIV",
  leesin: "LeeSin",
  masteryi: "MasterYi",
  missfortune: "MissFortune",
  tahmkench: "TahmKench",
  twistedfate: "TwistedFate",
  xinzhao: "XinZhao",
  aurelionsol: "AurelionSol",
  renataglasc: "Renata",
};

function getChampionAssetName(name) {
  const raw = String(name || "").trim();
  if (!raw) return "";
  const compact = raw.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  return CHAMPION_ASSET_ALIASES[compact] || raw;
}

function hasPromosInTier(tier) {
  const safeTier = String(tier || "").toUpperCase();
  return !["MASTER", "GRANDMASTER", "CHALLENGER"].includes(safeTier);
}

function getPromoWinsNeeded(lp) {
  const safeLp = Number(lp);
  if (!Number.isFinite(safeLp)) return 2;
  // Aproximacion simple con +25 LP por victoria para estimar proximidad a promo.
  return Math.max(1, Math.ceil((100 - safeLp) / 25));
}

function getMainRoleFromAccounts(accounts) {
  const roleCount = new Map();
  for (const account of accounts) {
    const normalizedRole = normalizeRole(account?.mainRole);
    if (!normalizedRole) continue;
    roleCount.set(normalizedRole, (roleCount.get(normalizedRole) || 0) + 1);
  }
  let bestRole = null;
  let bestCount = -1;
  for (const [role, count] of roleCount.entries()) {
    if (count > bestCount) {
      bestRole = role;
      bestCount = count;
    }
  }
  return bestRole;
}

function getRankedActivityWeight(account) {
  const soloGames = (Number(account?.soloq?.wins) || 0) + (Number(account?.soloq?.losses) || 0);
  const flexGames = (Number(account?.flex?.wins) || 0) + (Number(account?.flex?.losses) || 0);
  const totalRankedGames = soloGames + flexGames;
  return Math.max(1, totalRankedGames);
}

function getTopChampionsFromAccounts(accounts) {
  const champScore = new Map();
  for (const account of accounts || []) {
    const champs = Array.isArray(account?.topChampions) ? account.topChampions.slice(0, 3) : [];
    if (champs.length === 0) continue;

    const activityWeight = getRankedActivityWeight(account);
    champs.forEach((champ, idx) => {
      if (!champ) return;
      // Primer pick pesa mas que segundo/tercero, y se pondera por actividad ranked.
      const rankWeight = Math.max(1, 3 - idx);
      const score = rankWeight * activityWeight;
      champScore.set(champ, (champScore.get(champ) || 0) + score);
    });
  }

  return Array.from(champScore.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([champ]) => champ);
}

function hashSignalSeed(value) {
  const text = String(value || "");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function pickSignalText(options, seedText) {
  if (!Array.isArray(options) || options.length === 0) return "";
  const idx = hashSignalSeed(seedText) % options.length;
  return options[idx];
}

function buildPlayerWarnings(player) {
  // Ranking list warnings: keep the previous short style.
  const notes = [];
  if (!player?.soloq) return notes;

  const wins = player.soloq.wins || 0;
  const losses = player.soloq.losses || 0;
  const total = wins + losses;
  const winRate = total > 0 ? (wins / total) * 100 : 0;
  const champs = player.topChampions || [];

  if (winRate >= 58) notes.push("En racha de 3+");
  else if (winRate <= 45) notes.push("Tilt mode");

  const explicitDuoMate = player.duoPartner || player.lastDuoWith || null;
  const duoGamesRecent = Number(player.duoGamesTogetherRecent) || 0;
  if (explicitDuoMate) {
    if (winRate >= 50) {
      notes.push(duoGamesRecent >= 2
        ? `Hace duo con ${explicitDuoMate} (${duoGamesRecent} soloq)`
        : `Hace duo con ${explicitDuoMate}`);
    }
    else notes.push("Hace duo y pierde");
  }

  if (champs.length > 0) {
    const mainChamp = champs[0].toLowerCase();
    if (mainChamp === "kaisa") notes.push("Kaisa abuser");
    else if (mainChamp === "draven" || mainChamp === "riven" || mainChamp === "yasuo") {
      notes.push(`${champs[0]} OTP vibes`);
    } else {
      notes.push(`Spam ${champs[0]}`);
    }
  }

  const currentLp = Number(player?.soloq?.leaguePoints) || 0;
  if (hasPromosInTier(player.soloq.tier) && currentLp >= 70) {
    const winsToPromo = getPromoWinsNeeded(currentLp);
    notes.push(`A ${winsToPromo} win${winsToPromo === 1 ? "" : "s"} de promo`);
  }

  return notes
    .map((n) => String(n || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 3);
}

function buildActivityWarnings(player) {
  const notes = [];
  if (!player?.soloq) return notes;

  const wins = player.soloq.wins || 0;
  const losses = player.soloq.losses || 0;
  const total = wins + losses;
  const winRate = total > 0 ? (wins / total) * 100 : 0;
  const champs = player.topChampions || [];
  const playerId = String(player.riotId || "unknown");
  const mainRole = normalizeRole(player.mainRole);
  const roleLabel = ROLE_LABELS[mainRole] || mainRole;

  if (champs.length > 0) {
    const mainChamp = champs[0];
    const champTemplates = [
      `Ha jugado mucho con ${mainChamp} ultimamente`,
      `${mainChamp} parece su pick de confianza`,
      `Viene spameando ${mainChamp} en soloq`,
      `${mainChamp} esta siendo su arma principal`,
    ];
    notes.push(pickSignalText(champTemplates, `${playerId}-champ-${mainChamp}`));
  }

  if (total >= 180) {
    notes.push(pickSignalText([
      `Tiene muchisimo volumen: ${total} partidas rankeds`,
      `Esta en modo grind duro con ${total} games`,
      `No para de jugar: ya suma ${total} partidas`,
    ], `${playerId}-volume-high-${total}`));
  } else if (total >= 90) {
    notes.push(pickSignalText([
      `Va metiendo muchas rankeds: ${total} partidas`,
      `Ritmo alto de juego: ${total} games totales`,
      `Actividad constante: ${total} partidas acumuladas`,
    ], `${playerId}-volume-mid-${total}`));
  }

  if (winRate >= 58) {
    notes.push(pickSignalText([
      `Winrate encendido (${winRate.toFixed(1)}%), viene en racha`,
      `Momento dulce: ${winRate.toFixed(1)}% de winrate`,
      `Esta sacando muchas victorias (${winRate.toFixed(1)}%)`,
    ], `${playerId}-wr-hot-${winRate.toFixed(1)}`));
  } else if (winRate <= 45) {
    notes.push(pickSignalText([
      `Racha complicada: ${winRate.toFixed(1)}% de winrate`,
      `Le esta costando cerrar partidas (${winRate.toFixed(1)}%)`,
      `Dia duro en ranked: winrate en ${winRate.toFixed(1)}%`,
    ], `${playerId}-wr-cold-${winRate.toFixed(1)}`));
  }

  // Duo notes should only come from explicit duo data, never from alt-account grouping.
  const explicitDuoMate = player.duoPartner || player.lastDuoWith || null;
  const duoGamesRecent = Number(player.duoGamesTogetherRecent) || 0;
  if (explicitDuoMate) {
    notes.push(pickSignalText([
      duoGamesRecent >= 2
        ? `Suele jugar duo con ${explicitDuoMate} (${duoGamesRecent} soloq)`
        : `Suele jugar duo con ${explicitDuoMate}`,
      duoGamesRecent >= 2
        ? `Ultimamente aparece en duo con ${explicitDuoMate} (${duoGamesRecent} soloq)`
        : `Ultimamente aparece en duo con ${explicitDuoMate}`,
      duoGamesRecent >= 2
        ? `Se le ve bastante en premade con ${explicitDuoMate} (${duoGamesRecent} soloq)`
        : `Se le ve bastante en premade con ${explicitDuoMate}`,
    ], `${playerId}-duo-${explicitDuoMate}`));
  }

  if (roleLabel) {
    notes.push(pickSignalText([
      `Se esta viendo muy comodo en ${roleLabel}`,
      `Su rol dominante ahora mismo es ${roleLabel}`,
      `${roleLabel} esta siendo su carril principal`,
    ], `${playerId}-role-${roleLabel}`));
  }

  const currentLp = Number(player.soloq.leaguePoints) || 0;
  if (hasPromosInTier(player.soloq.tier) && currentLp >= 75) {
    notes.push(pickSignalText([
      `Esta a nada de subir: ${currentLp} LP`,
      `Muy cerca del ascenso con ${currentLp} LP`,
      `Huele a promo, ya va por ${currentLp} LP`,
    ], `${playerId}-promo-close-${currentLp}`));
  } else if (currentLp <= 10) {
    notes.push(pickSignalText([
      `Zona peligrosa: ${currentLp} LP`,
      `En riesgo de bajar con ${currentLp} LP`,
      `Necesita reaccionar, se quedo en ${currentLp} LP`,
    ], `${playerId}-demotion-risk-${currentLp}`));
  }

  return notes
    .map((n) => String(n || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((note, idx, arr) => arr.indexOf(note) === idx)
    .slice(0, 4);
}

function getTierClass(tier) {
  if (!tier) return "unranked";
  return tier.toLowerCase();
}

function formatLpDelta(delta) {
  if (typeof delta !== "number" || Number.isNaN(delta)) return "—";
  if (delta > 0) return `+${delta} LP`;
  if (delta < 0) return `${delta} LP`;
  return "0 LP";
}

function formatSignedLps(delta) {
  const safe = Number(delta);
  if (!Number.isFinite(safe)) return "0 LPs";
  const abs = Math.abs(Math.trunc(safe));
  const sign = safe >= 0 ? "+" : "-";
  return `${sign}${abs} LPs`;
}

function formatLossLps(delta) {
  const safe = Number(delta);
  if (!Number.isFinite(safe)) return "0 LPs";
  return `-${Math.abs(Math.trunc(safe))} LPs`;
}

function getActivityEntryKey(entry, idx) {
  if (entry?.key) return String(entry.key);
  const player = String(entry?.player || "player");
  const updatedAt = String(entry?.updatedAt || idx);
  const delta = Number.isFinite(Number(entry?.lpDelta)) ? Number(entry.lpDelta) : 0;
  return `${player}:${updatedAt}:${delta}`;
}

function formatQueueSummary(queue) {
  if (!queue) return null;
  const wins = Number(queue.wins) || 0;
  const losses = Number(queue.losses) || 0;
  const games = wins + losses;
  if (!games) return null;
  const wr = ((wins / games) * 100).toFixed(1);
  return `${wr}% · ${games}G (${wins}W/${losses}L)`;
}

function formatMoteDisplay(mote) {
  const clean = String(mote || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function shouldRenderRiotId(mote, riotId) {
  const cleanMote = String(mote || "").replace(/\s+/g, " ").trim().toLowerCase();
  const cleanId = String(riotId || "").replace(/\s+/g, " ").trim().toLowerCase();
  const cleanIdNameOnly = cleanId.split("#")[0];
  if (!cleanMote) return true;
  return cleanMote !== cleanId && cleanMote !== cleanIdNameOnly;
}

function RoleIcon({ role }) {
  const normalizedRole = normalizeRole(role);
  if (!normalizedRole) return <span className="no-role">—</span>;
  const iconUrl = ROLE_ICONS[normalizedRole];
  const label = ROLE_LABELS[normalizedRole] || normalizedRole;
  return (
    <img
      src={iconUrl}
      alt={label}
      className="role-icon"
      title={label}
      onError={(e) => { e.target.style.display = "none"; }}
    />
  );
}

function ChampIcons({ champions, version }) {
  const safeChamps = Array.isArray(champions) ? champions.filter(Boolean).slice(0, 3) : [];
  const slots = [...safeChamps];
  while (slots.length < 3) slots.push(null);
  return (
    <div className="champ-icons">
      {slots.map((name, idx) => (
        name ? (
          <img
            key={`${name}-${idx}`}
            className="champ-icon"
            src={`https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${getChampionAssetName(name)}.png`}
            alt={name}
            title={name}
            onError={(e) => { e.target.style.display = "none"; }}
          />
        ) : (
          <span key={`empty-${idx}`} className="champ-icon champ-icon--empty" aria-hidden="true">—</span>
        )
      ))}
    </div>
  );
}

function ActivityTicker({ groupedPlayers }) {
  const signals = useMemo(() => {
    const list = [];
    for (const p of groupedPlayers) {
      if (p.error) continue;
      const warnings = buildActivityWarnings(p);
      for (const w of warnings) {
        list.push({
          player: String(p.riotId || "").replace(/\s+/g, " ").trim(),
          warn: String(w || "").replace(/\s+/g, " ").trim(),
        });
      }
    }

    // Shuffle signals so activity warnings rotate in a less predictable order.
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }

    return list;
  }, [groupedPlayers]);

  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState("in");
  const seenRef = useRef(new Set());

  useEffect(() => {
    if (signals.length === 0) return;
    const id = setInterval(() => {
      setPhase("out");
      setTimeout(() => {
        setIdx((prev) => {
          const next = (prev + 1) % signals.length;
          if (seenRef.current.size >= signals.length) seenRef.current.clear();
          seenRef.current.add(next);
          return next;
        });
        setPhase("in");
      }, 380);
    }, 4000);
    return () => clearInterval(id);
  }, [signals.length]);

  if (signals.length === 0) {
    return (
      <div className="at">
        <span className="at__empty">Sin señales activas</span>
      </div>
    );
  }

  const current = signals[idx % signals.length];
  return (
    <div className="at" data-phase={phase}>
      <span className="at__counter">{idx + 1} / {signals.length}</span>
      <div className="at__line">
        <span className="at__player">{current.player}</span>
        <span className="at__sep"> · </span>
        <span className="at__warn">{current.warn}</span>
      </div>
      <div className="at__dots">
        {signals.map((_, i) => (
          <span key={i} className={`at__dot${i === idx ? " at__dot--active" : ""}`} />
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState(() => tabFromPathname(window.location.pathname));
  const [consentChoice, setConsentChoice] = useState(() => localStorage.getItem(CONSENT_STORAGE_KEY) || "pending");
  const [players, setPlayers] = useState([]);
  const [activityFeed, setActivityFeed] = useState([]);
  const [activityFeedMeta, setActivityFeedMeta] = useState({
    date: null,
    updatedAt: null,
  });
  const [activityFeedLoading, setActivityFeedLoading] = useState(false);
  const [rankingActivityQueue, setRankingActivityQueue] = useState([]);
  const [rankingActivityPopup, setRankingActivityPopup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterRole, setFilterRole] = useState("ALL");
  const [rankingMode, setRankingMode] = useState("combined");
  const [rankingQueueSort, setRankingQueueSort] = useState("soloq");
  const [preferredPlatform, setPreferredPlatform] = useState(() => {
    const saved = String(localStorage.getItem(PROFILE_PLATFORM_STORAGE_KEY) || "").trim();
    return PROFILE_PLATFORM_OPTIONS.some((platform) => platform.key === saved) ? saved : "opgg";
  });
  const [cacheMeta, setCacheMeta] = useState({
    cachedAt: null,
    cacheTtlMs: null,
    stale: false,
    lastError: null,
    ddragonVersion: "14.24.1",
  });
  const [apiStatus, setApiStatus] = useState(null);
  const statusSignatureRef = useRef("");
  const activityFeedSeenKeysRef = useRef(new Set());
  const activityFeedSeededRef = useRef(false);
  const sentMetricPathsRef = useRef(new Set());

  const loadLadder = useCallback(async (background = false) => {
    if (!background) setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API}/api/ladder`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPlayers(Array.isArray(data) ? data : data.players || []);
      if (!Array.isArray(data)) {
        setCacheMeta({
          cachedAt: data.cachedAt || null,
          cacheTtlMs: data.cacheTtlMs || null,
          stale: Boolean(data.stale),
          lastError: data.lastError || null,
          ddragonVersion: data.ddragonVersion || "14.24.1",
        });
      }
    } catch (err) {
      setError(err.message || "Error cargando la ladder");
    } finally {
      if (!background) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLadder();
  }, [loadLadder]);

  useEffect(() => {
    const onPopState = () => {
      setActiveTab(tabFromPathname(window.location.pathname));
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const targetPath = pathFromTab(activeTab);
    if (window.location.pathname !== targetPath) {
      window.history.pushState({}, "", targetPath);
    }
  }, [activeTab]);

  useEffect(() => {
    localStorage.setItem(PROFILE_PLATFORM_STORAGE_KEY, preferredPlatform);
  }, [preferredPlatform]);

  const sendPageViewMetric = useCallback(async (targetPath) => {
    if (consentChoice !== "accepted") return;
    if (sentMetricPathsRef.current.has(targetPath)) return;

    try {
      await fetch(`${API}/api/metrics/page-view`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          consentAccepted: true,
          pagePath: targetPath,
          source: document.referrer || "direct",
          language: navigator.language || "unknown",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown",
          screen: `${window.screen?.width || 0}x${window.screen?.height || 0}`,
        }),
      });
      sentMetricPathsRef.current.add(targetPath);
    } catch {
      // Silent: metrics must never break UX.
    }
  }, [consentChoice]);

  useEffect(() => {
    sendPageViewMetric(pathFromTab(activeTab));
  }, [activeTab, sendPageViewMetric]);

  const handleConsentDecision = useCallback((value) => {
    const safeValue = value === "accepted" ? "accepted" : "rejected";
    setConsentChoice(safeValue);
    localStorage.setItem(CONSENT_STORAGE_KEY, safeValue);
    if (safeValue === "accepted") {
      sendPageViewMetric(pathFromTab(activeTab));
    }
  }, [activeTab, sendPageViewMetric]);

  const queueIncomingActivityPopups = useCallback((entries) => {
    const safeEntries = Array.isArray(entries) ? entries : [];
    if (safeEntries.length === 0) return;

    const seenKeys = activityFeedSeenKeysRef.current;

    if (!activityFeedSeededRef.current) {
      safeEntries.forEach((entry, idx) => {
        seenKeys.add(getActivityEntryKey(entry, idx));
      });
      activityFeedSeededRef.current = true;
      return;
    }

    const incoming = [];
    safeEntries.forEach((entry, idx) => {
      const entryKey = getActivityEntryKey(entry, idx);
      if (seenKeys.has(entryKey)) return;
      seenKeys.add(entryKey);

      // Popups should focus on newly finished games with LP movement.
      if (Number(entry?.lpDelta) === 0) return;
      incoming.push({
        ...entry,
        key: entryKey,
      });
    });

    if (incoming.length > 0) {
      setRankingActivityQueue((prev) => [...prev, ...incoming.slice(0, 5)]);
    }
  }, []);

  const loadActivityFeed = useCallback(async (background = false, options = {}) => {
    if (!background) setActivityFeedLoading(true);
    try {
      const res = await fetch(`${API}/api/activity-feed`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const entries = Array.isArray(data?.entries) ? data.entries : [];
      setActivityFeed(entries);
      setActivityFeedMeta({
        date: data?.date || null,
        updatedAt: data?.updatedAt || null,
      });

      if (options.showPopupOnNew) {
        queueIncomingActivityPopups(entries);
      } else if (!activityFeedSeededRef.current) {
        queueIncomingActivityPopups(entries);
      }
    } catch {
      // Keep previous data when the feed endpoint fails temporarily.
    } finally {
      if (!background) setActivityFeedLoading(false);
    }
  }, [queueIncomingActivityPopups]);

  useEffect(() => {
    loadActivityFeed();
  }, [loadActivityFeed]);

  useEffect(() => {
    if (activeTab !== "ranking") return;
    const timer = setInterval(() => {
      loadLadder(true);
    }, 120 * 1000);
    return () => clearInterval(timer);
  }, [activeTab, loadLadder]);

  useEffect(() => {
    if (activeTab !== "activity") return;
    const timer = setInterval(() => {
      loadActivityFeed(true);
    }, 45 * 1000);
    return () => clearInterval(timer);
  }, [activeTab, loadActivityFeed]);

  useEffect(() => {
    if (activeTab !== "ranking") return;
    const timer = setInterval(() => {
      loadActivityFeed(true, { showPopupOnNew: true });
    }, 20 * 1000);
    return () => clearInterval(timer);
  }, [activeTab, loadActivityFeed]);

  useEffect(() => {
    if (rankingActivityPopup || rankingActivityQueue.length === 0) return;
    const [nextPopup, ...rest] = rankingActivityQueue;
    setRankingActivityQueue(rest);
    setRankingActivityPopup(nextPopup);
  }, [rankingActivityPopup, rankingActivityQueue]);

  useEffect(() => {
    if (!rankingActivityPopup) return;
    playActivityPopupSound(rankingActivityPopup.lpDelta);
    const timer = setTimeout(() => {
      setRankingActivityPopup(null);
    }, 4200);
    return () => clearTimeout(timer);
  }, [rankingActivityPopup]);

  useEffect(() => {
    if (activeTab !== "ranking") return;

    const pollStatus = async () => {
      try {
        const res = await fetch(`${API}/api/status`);
        if (!res.ok) return;
        const s = await res.json();
        const signature = JSON.stringify({
          t: s.totalRequests,
          h: s.todayRequests,
          r: s.riotRateLimited,
          u: s.lastUpdatedAt,
          d: s.dailyHighlights,
        });

        if (statusSignatureRef.current !== signature) {
          statusSignatureRef.current = signature;
          setApiStatus(s);
        }

        if (s.riotRateLimited) {
          console.warn(`🔴 [429] Rate limit activo — faltan ${s.rateLimitSecondsLeft}s`);
        }
      } catch {
        // silencioso
      }
    };

    pollStatus();
    const id = setInterval(pollStatus, 15000);
    return () => clearInterval(id);
  }, [activeTab]);

  const ddragonVersion = cacheMeta.ddragonVersion || "14.24.1";

  const groupedPlayers = useMemo(() => {
    const groups = new Map();
    for (const player of players) {
      if (!player?.riotId) continue;
      const normalizedId = player.riotId.toLowerCase();
      const owner = PLAYER_OWNER_ALIASES[normalizedId] || player.riotId;
      if (!groups.has(owner)) groups.set(owner, []);
      groups.get(owner).push(player);
    }

    return Array.from(groups.entries()).map(([owner, accounts]) => {
      const sortedByScore = [...accounts].sort((a, b) => getSoloqScore(b) - getSoloqScore(a));
      const bestSoloqAccount = sortedByScore[0] || null;
      const inGameAccount = sortedByScore.find((a) => Boolean(a?.inGame)) || null;
      const primaryRiotId = bestSoloqAccount?.riotId || null;
      const mergedTopChampions = getTopChampionsFromAccounts(accounts);

      return {
        ...bestSoloqAccount,
        groupKey: owner,
        riotId: accounts.length === 1
          ? (bestSoloqAccount?.riotId || owner)
          : owner,
        mainAccountRiotId: bestSoloqAccount?.riotId || null,
        emote: accounts.find((a) => a.emote)?.emote || bestSoloqAccount?.emote || null,
        mainRole: normalizeRole(bestSoloqAccount?.mainRole) || getMainRoleFromAccounts(accounts) || null,
        topChampions: mergedTopChampions.length > 0
          ? mergedTopChampions
          : (bestSoloqAccount?.topChampions || []).slice(0, 3),
        altAccounts: sortedByScore
          .map((a) => a.riotId)
          .filter((id) => id && id !== primaryRiotId)
          .slice(0, 2),
        altAccountsHiddenCount: Math.max(0, accounts.length - 1 - 2),
        accountCount: accounts.length,
        inGame: accounts.some((a) => Boolean(a?.inGame)),
        inGameRiotId: inGameAccount?.riotId || null,
        soloq: bestSoloqAccount?.soloq ? { ...bestSoloqAccount.soloq } : null,
      };
    });
  }, [players]);

  const rankingSourcePlayers = useMemo(() => {
    const queueScore = (player) => getQueueScore(player, rankingQueueSort);
    if (rankingMode === "combined") {
      return groupedPlayers
        .map((grouped) => {
          const accounts = Array.isArray(grouped?.allAccounts) && grouped.allAccounts.length > 0
            ? grouped.allAccounts
            : [grouped];
          const sortedByQueue = [...accounts].sort((a, b) => queueScore(b) - queueScore(a));
          const bestQueueAccount = sortedByQueue[0] || grouped;
          return {
            ...grouped,
            profileIconId: bestQueueAccount?.profileIconId || grouped?.profileIconId,
            // Keep SOLOQ-best account for external profile links in combined mode.
            mainAccountRiotId: grouped?.mainAccountRiotId || grouped?.riotId || null,
            soloq: bestQueueAccount?.soloq ? { ...bestQueueAccount.soloq } : grouped?.soloq || null,
            flex: bestQueueAccount?.flex ? { ...bestQueueAccount.flex } : grouped?.flex || null,
          };
        })
        .sort((a, b) => queueScore(b) - queueScore(a));
    }
    return [...players]
      .filter((player) => Boolean(player?.riotId))
      .sort((a, b) => queueScore(b) - queueScore(a))
      .map((player) => {
        const playerRiotId = String(player?.riotId || "").trim();
        const ownerRiotId = PLAYER_OWNER_ALIASES[playerRiotId.toLowerCase()] || playerRiotId;
        return {
          ...player,
          groupKey: player?.puuid || player?.riotId,
          mainAccountRiotId: player?.riotId || null,
          ownerRiotId,
          altAccounts: [],
          altAccountsHiddenCount: 0,
          accountCount: 1,
          inGame: Boolean(player?.inGame),
          inGameRiotId: player?.riotId || null,
          topChampions: Array.isArray(player?.topChampions) ? player.topChampions.slice(0, 3) : [],
        };
      });
  }, [groupedPlayers, players, rankingMode, rankingQueueSort]);

  const filteredPlayers = rankingSourcePlayers
    .map((p, idx) => ({ ...p, _rank: idx + 1 }))
    .filter((p) => {
      const matchesSearch =
        !searchQuery ||
        p.riotId.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.altAccounts?.some((alt) => alt.toLowerCase().includes(searchQuery.toLowerCase())) ||
        String(p.ownerRiotId || "").toLowerCase().includes(searchQuery.toLowerCase());
      const matchesRole = filterRole === "ALL" || normalizeRole(p.mainRole) === filterRole;
      return matchesSearch && matchesRole;
    });

  const rankedPlayers = rankingSourcePlayers.filter((player) => !player.error);
  const latestActivityEntry = useMemo(() => {
    if (!Array.isArray(activityFeed) || activityFeed.length === 0) return null;
    return [...activityFeed].sort((a, b) => {
      const aTs = Number(a?.gameEndTimestamp || Date.parse(String(a?.updatedAt || "")) || 0);
      const bTs = Number(b?.gameEndTimestamp || Date.parse(String(b?.updatedAt || "")) || 0);
      return bTs - aTs;
    })[0] || null;
  }, [activityFeed]);

  const duelConfig = ["Hachitas", "Ryt"];
  const duelNicknames = {
    hachitas: "YEREMIAS",
    ryt: "X RYT GIRO COMPLETO",
  };
  const groupedPlayersByOwner = useMemo(() => {
    const map = new Map();
    for (const player of groupedPlayers) {
      if (!player?.riotId) continue;
      const key = player.riotId.toLowerCase();
      if (!map.has(key)) map.set(key, player);
    }
    return map;
  }, [groupedPlayers]);
  const openOpggForPlayer = useCallback((player) => {
    const targetRiotId = player?.mainAccountRiotId || player?.riotId || null;
    const profileUrl = getPreferredPlatformUrl(targetRiotId, preferredPlatform);
    if (!profileUrl) return;
    window.open(profileUrl, "_blank", "noopener,noreferrer");
  }, [preferredPlatform]);

  const openOpggUrl = useCallback((url) => {
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  const handleOpenOpggKeyDown = useCallback((event, player) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openOpggForPlayer(player);
  }, [openOpggForPlayer]);
  const handleOpenActivityEntryKeyDown = useCallback((event, entry) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openOpggUrl(buildOpggMatchUrlFromEntry(entry));
  }, [openOpggUrl]);
  const handleShowSampleRankingPopup = useCallback(() => {
    if (!latestActivityEntry) return;
    const previewEntry = {
      ...latestActivityEntry,
      key: `sample-${getActivityEntryKey(latestActivityEntry, Date.now())}`,
    };
    setRankingActivityPopup(previewEntry);
  }, [latestActivityEntry]);
  const preferredPlatformLabel = PROFILE_PLATFORM_OPTIONS.find((platform) => platform.key === preferredPlatform)?.label || "OP.GG";
  const duelPlayers = duelConfig.map((owner) => groupedPlayersByOwner.get(owner.toLowerCase()) || null);
  const duelLpA = duelPlayers[0]?.soloq?.leaguePoints ?? null;
  const duelLpB = duelPlayers[1]?.soloq?.leaguePoints ?? null;
  const duelLpTextA = duelLpA !== null ? `${duelLpA} LP` : "—";
  const duelLpTextB = duelLpB !== null ? `${duelLpB} LP` : "—";
  const duelRankTextA = duelPlayers[0]?.soloq ? `${duelPlayers[0].soloq.tier} ${duelPlayers[0].soloq.rank}` : "Sin rank";
  const duelRankTextB = duelPlayers[1]?.soloq ? `${duelPlayers[1].soloq.tier} ${duelPlayers[1].soloq.rank}` : "Sin rank";
  const duelRankClassA = getTierClass(duelPlayers[0]?.soloq?.tier);
  const duelRankClassB = getTierClass(duelPlayers[1]?.soloq?.tier);
  const duelRankIconA = duelPlayers[0]?.soloq?.tier ? RANK_ICONS[duelPlayers[0].soloq.tier] : null;
  const duelRankIconB = duelPlayers[1]?.soloq?.tier ? RANK_ICONS[duelPlayers[1].soloq.tier] : null;
  const duelScoreA = getSoloqScore(duelPlayers[0]);
  const duelScoreB = getSoloqScore(duelPlayers[1]);
  const duelHasBoth = duelScoreA >= 0 && duelScoreB >= 0;
  const duelWinnerIndex = duelHasBoth ? (duelScoreA === duelScoreB ? -1 : duelScoreA > duelScoreB ? 0 : 1) : -1;
  const duelWinnerName =
    duelHasBoth && duelWinnerIndex !== -1
      ? duelNicknames[duelConfig[duelWinnerIndex].toLowerCase()] || duelPlayers[duelWinnerIndex]?.riotId
      : null;

  const usersMasonryPlayers = useMemo(() => {
    const dedupedMap = new Map();
    for (const player of players) {
      if (!player) continue;
      const dedupeKey = player.puuid || String(player.riotId || "").toLowerCase();
      if (!dedupeKey) continue;

      const existing = dedupedMap.get(dedupeKey);
      if (!existing) {
        dedupedMap.set(dedupeKey, player);
        continue;
      }

      // Prefer the richer snapshot when duplicates exist.
      const existingScore =
        (existing.profileIconId ? 2 : 0)
        + (existing.soloq ? 1 : 0)
        + (existing.flex ? 1 : 0);
      const candidateScore =
        (player.profileIconId ? 2 : 0)
        + (player.soloq ? 1 : 0)
        + (player.flex ? 1 : 0);
      if (candidateScore > existingScore) {
        dedupedMap.set(dedupeKey, player);
      }
    }

    const uniquePlayers = Array.from(dedupedMap.values());
    const withIcons = uniquePlayers.filter((p) => p?.profileIconId);
    const withoutIcons = uniquePlayers.filter((p) => !p?.profileIconId);
    // Keep players without icon visible (e.g., newly added or API-missing icon data).
    const source = [...withIcons, ...withoutIcons];
    const shuffled = [...source];

    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const heights = [300, 360, 420, 520, 440, 340];

    return shuffled.map((player, index) => ({
      ...player,
      tileHeight: heights[index % heights.length],
    }));
  }, [players]);

  const masonryBreakpoints = {
    default: 5,
    1800: 4,
    1300: 3,
    900: 2,
    560: 1,
  };

  const usersContent = (
    <>
      <section className="panel-section panel-section--masonry">
        <div className="section-heading">
          <div>
            <p className="section-kicker">Roster wall</p>
          </div>
          <span className="stat-pill">{players.length} total</span>
        </div>
        {usersMasonryPlayers.length === 0 ? (
          <div className="empty">No hay usuarios guardados todavia.</div>
        ) : (
          <Masonry
            breakpointCols={masonryBreakpoints}
            className="users-masonry-grid"
            columnClassName="users-masonry-grid__column"
          >
            {usersMasonryPlayers.map((player) => (
              (() => {
                const tileProfileUrl = getPreferredPlatformUrl(player?.riotId, preferredPlatform);
                return (
                  <article
                    key={`${player.riotId}-${player.puuid || "no-puuid"}`}
                    className={`summoner-tile ${tileProfileUrl ? "summoner-tile--clickable" : ""}`}
                    style={{ minHeight: `${player.tileHeight}px` }}
                    role={tileProfileUrl ? "button" : undefined}
                    tabIndex={tileProfileUrl ? 0 : undefined}
                    onClick={tileProfileUrl ? () => openOpggUrl(tileProfileUrl) : undefined}
                    onKeyDown={tileProfileUrl ? (event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      openOpggUrl(tileProfileUrl);
                    } : undefined}
                    title={tileProfileUrl ? `Abrir ${preferredPlatformLabel}: ${player.riotId}` : undefined}
                  >
                {player.profileIconId ? (
                  <img
                    src={`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/profileicon/${player.profileIconId}.png`}
                    alt={player.riotId || "Invocador"}
                    className="summoner-tile__img"
                    loading="lazy"
                  />
                ) : (
                  <div className="summoner-tile__img summoner-tile__img--placeholder">?</div>
                )}

                <div className="summoner-tile__overlay">
                  <span className="summoner-tile__name">{player.riotId || "Sin Riot ID"}</span>
                  <span className="summoner-tile__rank">
                    {player.soloq
                      ? `${player.soloq.tier} ${player.soloq.rank} · ${player.soloq.leaguePoints} LP`
                      : (player.error || "Sin rank")}
                  </span>
                </div>
                  </article>
                );
              })()
            ))}
          </Masonry>
        )}
      </section>
    </>
  );

  const dailyHighlights = apiStatus?.dailyHighlights || null;
  const bestSoloToday = dailyHighlights?.bestSoloqGain || null;
  const bestFlexToday = dailyHighlights?.bestFlexGain || null;
  const worstSoloToday = dailyHighlights?.worstSoloqLoss || null;
  const worstOverallToday = dailyHighlights?.worstOverallLoss || null;
  const worstToday = worstOverallToday || worstSoloToday;
  const apiTodayRequests = Number(apiStatus?.todayRequests) || 0;
  const currentHour = new Date().getHours();
  const elapsedHoursToday = Math.max(1, currentHour + 1);
  const apiRequestsPerHour = Math.round(apiTodayRequests / elapsedHoursToday);
  const rankingPopupMatchUrl = rankingActivityPopup ? buildOpggMatchUrlFromEntry(rankingActivityPopup) : null;

  const rankingContent = (
    <>
      {rankingActivityPopup && (
        <div className="rank-activity-popup-layer" aria-live="polite" aria-atomic="true">
          <article
            className={`rank-activity-popup ${rankingPopupMatchUrl ? "rank-activity-popup--clickable" : ""}`}
            key={rankingActivityPopup.key || rankingActivityPopup.updatedAt || rankingActivityPopup.player}
            role={rankingPopupMatchUrl ? "button" : undefined}
            tabIndex={rankingPopupMatchUrl ? 0 : undefined}
            onClick={rankingPopupMatchUrl ? () => openOpggUrl(rankingPopupMatchUrl) : undefined}
            onKeyDown={rankingPopupMatchUrl ? (event) => handleOpenActivityEntryKeyDown(event, rankingActivityPopup) : undefined}
            title={rankingPopupMatchUrl ? "Abrir partida en League of Graphs" : undefined}
          >
            <span className="rank-activity-popup__kicker">Actividad en directo</span>
            <div className="rank-activity-popup__head">
              {rankingActivityPopup.championName ? (
                <img
                  className="rank-activity-popup__champ"
                  src={`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/champion/${getChampionAssetName(rankingActivityPopup.championName)}.png`}
                  alt={rankingActivityPopup.championName}
                  onError={(e) => { e.target.style.display = "none"; }}
                />
              ) : null}
              <strong className="rank-activity-popup__player">{rankingActivityPopup.player || "Jugador"}</strong>
              <span className={`rank-activity-popup__delta ${Number(rankingActivityPopup.lpDelta) < 0 ? "is-down" : "is-up"}`}>
                {Number(rankingActivityPopup.lpDelta) > 0 ? `+${rankingActivityPopup.lpDelta}` : rankingActivityPopup.lpDelta} LP
              </span>
            </div>
            <p className="rank-activity-popup__text">{formatActivityText(rankingActivityPopup.text) || "Acaba de terminar partida"}</p>
            {rankingActivityPopup.kda && <span className="rank-activity-popup__kda">KDA: {rankingActivityPopup.kda}</span>}
          </article>
        </div>
      )}

      <section className="duel-card">
        <div className="duel-head">
          <p className="duel-kicker">Apuesta</p>
          <h3>Duelo de los 100 EUR</h3>
          <span className="duel-subtitle">Cara a cara: quien saca mas elo</span>
        </div>

        <div className="duel-board">
          {duelConfig.map((owner, idx) => {
            const player = duelPlayers[idx];
            const isWinner = duelWinnerIndex === idx;
            const iconId = player?.profileIconId;
            return (
              <div
                key={owner}
                className={`duel-slot ${idx === 0 ? "duel-slot--left" : "duel-slot--right"} ${isWinner ? "is-winner" : ""}`}
              >
                {iconId ? (
                  <img
                    className="duel-icon"
                    src={`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/profileicon/${iconId}.png`}
                    alt={player?.riotId || owner}
                  />
                ) : (
                  <div className="duel-icon duel-icon--placeholder">?</div>
                )}
                <div className="duel-meta">
                  <span className="duel-label">{idx === 0 ? "Jugador 1" : "Jugador 2"}</span>
                  <strong className="duel-name">{duelNicknames[owner.toLowerCase()] || player?.riotId || owner}</strong>
                  <span className="duel-tier">{player?.altAccounts?.[0] || player?.riotId || owner}</span>
                  <span className="duel-tier">{player?.soloq ? `${player.soloq.tier} ${player.soloq.rank}` : "Sin rank"}</span>
                </div>
              </div>
            );
          })}

          <div className="duel-center-elo">
            <div className="duel-center-side">
              <span className={`duel-center-lp ${duelWinnerIndex === 0 ? "is-winner" : ""}`}>{duelLpTextA}</span>
              <span className={`duel-center-rank tier-${duelRankClassA}`}>
                {duelRankIconA && <img className="duel-center-rank-icon" src={duelRankIconA} alt={duelRankTextA} />}
                {duelRankTextA}
              </span>
            </div>
            <div className="duel-vs">VS</div>
            <div className="duel-center-side">
              <span className={`duel-center-lp ${duelWinnerIndex === 1 ? "is-winner" : ""}`}>{duelLpTextB}</span>
              <span className={`duel-center-rank tier-${duelRankClassB}`}>
                {duelRankIconB && <img className="duel-center-rank-icon" src={duelRankIconB} alt={duelRankTextB} />}
                {duelRankTextB}
              </span>
            </div>
          </div>
        </div>

        <div className={`duel-result ${duelHasBoth ? (duelWinnerIndex === -1 ? "is-draw" : "is-live") : ""}`}>
          {duelHasBoth
            ? duelWinnerIndex === -1
              ? "Empate total de LP"
              : `Lider claro: ${duelWinnerName} (ELO superior)`
            : "Esperando datos en ladder cache para ambos jugadores"}
        </div>
      </section>

      <div className="activity-section">
        <div className="activity-section__header">
          <h3 className="activity-title">ACTIVIDAD</h3>
          <div className="activity-meta-pills">
            <span className="activity-meta-pill">👥 {players.length} jugadores</span>
            <span className="activity-meta-pill">🎮 {rankedPlayers.length} rankeados</span>
            <span className="activity-meta-pill">📡 API: /h {apiRequestsPerHour} · dia {apiTodayRequests}</span>
            <button
              type="button"
              className="activity-meta-pill activity-meta-pill--button"
              onClick={handleShowSampleRankingPopup}
              disabled={!latestActivityEntry}
              title={latestActivityEntry ? "Mostrar ejemplo de popup gigante" : "Sin actividad reciente para mostrar"}
            >
              Probar popup enorme
            </button>
          </div>
        </div>

        <div className="activity-grid">
          <div className="activity-card activity-card--winner">
            <span className="activity-label">Ganador LPs hoy (SOLOQ)</span>
            <span className="activity-value">{bestSoloToday?.player || "—"}</span>
            <span className="activity-delta-hero activity-delta-hero--up">{bestSoloToday ? formatSignedLps(bestSoloToday.deltaLp) : "—"}</span>
            <span className="activity-detail">{bestSoloToday ? formatLpDelta(bestSoloToday.deltaLp) : "—"}</span>
          </div>

          <div className="activity-card activity-card--winner">
            <span className="activity-label">Ganador LPs hoy (FLEX)</span>
            <span className="activity-value">{bestFlexToday?.player || "—"}</span>
            <span className="activity-delta-hero activity-delta-hero--up">{bestFlexToday ? formatSignedLps(bestFlexToday.deltaLp) : "—"}</span>
            <span className="activity-detail">{bestFlexToday ? formatLpDelta(bestFlexToday.deltaLp) : "—"}</span>
          </div>

          <div className="activity-card activity-card--signals">
            <span className="activity-label">Señales</span>
            <ActivityTicker groupedPlayers={groupedPlayers} />
          </div>

          <div className="activity-card activity-card--loser">
            <span className="activity-label">Perdedor LPs hoy (global)</span>
            <span className="activity-value">{worstToday?.player || "—"}</span>
            <span className="activity-delta-hero activity-delta-hero--down">{worstToday ? formatLossLps(worstToday.deltaLp) : "—"}</span>
            <span className="activity-detail">{worstToday ? formatLpDelta(worstToday.deltaLp) : "—"}</span>
          </div>
        </div>
      </div>

      <div className="rank-topbar">
        <div className="rank-controls">
          <div className="rank-search">
            <input
              type="text"
              placeholder="Buscar jugador..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="role-pills">
            <button
              type="button"
              className={`rank-mode-switch ${rankingMode === "all" ? "is-all" : "is-combined"}`}
              role="switch"
              aria-checked={rankingMode === "all"}
              aria-label="Cambiar modo de ranking entre Combinado y Todas las cuentas"
              title={rankingMode === "all" ? "Modo actual: Todas las cuentas" : "Modo actual: Combinado"}
              onClick={() => setRankingMode((prev) => (prev === "combined" ? "all" : "combined"))}
            >
              <span className="rank-mode-label">Combinado</span>
              <span className="rank-mode-track" aria-hidden="true">
                <span className="rank-mode-thumb" />
              </span>
              <span className="rank-mode-label">Todas las cuentas</span>
            </button>
            {["ALL", "TOP", "JUNGLE", "MID", "BOTTOM", "UTILITY"].map((role) => (
              <button
                key={role}
                className={`role-pill ${filterRole === role ? "active" : ""}`}
                onClick={() => setFilterRole(role)}
                title={role === "ALL" ? "Todos" : ROLE_LABELS[role]}
              >
                {role === "ALL" ? (
                  "Todos"
                ) : (
                  <img
                    src={ROLE_ICONS[role]}
                    alt={ROLE_LABELS[role]}
                    className="role-pill-icon"
                    onError={(e) => { e.target.style.display = "none"; }}
                  />
                )}
              </button>
            ))}
            <button
              type="button"
              className="rank-users-shortcut"
              onClick={() => setActiveTab("users")}
              title="Ir a usuarios"
            >
              Usuarios
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="loading">Cargando ladder...</div>
      ) : (
        <>
          <div className="rank-col-header">
            <span className="rank-col-header__pos">#</span>
            <span className="rank-col-header__player">JUGADOR</span>
            <span className="rank-col-header__champs">TOP CHAMPS</span>
            <span className="rank-col-header__role">ROL</span>
            <div className="rank-col-header__elo rank-col-header__elo-sort">
              <span>ELO</span>
              <div className="queue-sort-legend" role="group" aria-label="Ordenar ranking por cola">
                <button
                  type="button"
                  className={`queue-sort-pill ${rankingQueueSort === "soloq" ? "active" : ""}`}
                  onClick={() => setRankingQueueSort("soloq")}
                  title="Ordenar por SOLOQ"
                >
                  SOLOQ
                </button>
                <button
                  type="button"
                  className={`queue-sort-pill ${rankingQueueSort === "flex" ? "active" : ""}`}
                  onClick={() => setRankingQueueSort("flex")}
                  title="Ordenar por FLEX"
                >
                  FLEX
                </button>
              </div>
            </div>
            <span className="rank-col-header__warns">SEÑALES</span>
          </div>

          {filteredPlayers.length === 0 ? (
            <div className="empty">
              {players.length === 0
                ? "Añade jugadores con su Riot ID (Nombre#TAG)."
                : "Ningún resultado para esa búsqueda."}
            </div>
          ) : (
            <div className="ladder">
              {filteredPlayers.map((p) => {
                const playerWarnings = buildPlayerWarnings(p);
                const playerProfileUrl = getPreferredPlatformUrl(p.mainAccountRiotId || p.riotId, preferredPlatform);
                const liveGameUrl = buildLeagueOfGraphsLiveUrlFromRiotId(p.inGameRiotId || p.mainAccountRiotId || p.riotId);
                const showInGameChip = Boolean(liveGameUrl) && Boolean(p.inGame);
                const showRiotIdRow = shouldRenderRiotId(p.emote, p.riotId) || showInGameChip;
                const inGameChipTitle = "Abrir live game en LeagueOfGraphs";
                return (
                  <div
                    key={p.groupKey || p.riotId}
                    className={`player-row ${playerProfileUrl ? "player-row--clickable" : ""} ${p.error ? "player-error" : ""} ${p._rank <= 3 ? `player-top player-top-${p._rank}` : "player-regular"}`}
                    style={{ "--tier-color": TIER_COLORS[p.soloq?.tier] || "var(--line)" }}
                    role={playerProfileUrl ? "button" : undefined}
                    tabIndex={playerProfileUrl ? 0 : undefined}
                    onClick={playerProfileUrl ? () => openOpggForPlayer(p) : undefined}
                    onKeyDown={playerProfileUrl ? (event) => handleOpenOpggKeyDown(event, p) : undefined}
                    title={playerProfileUrl ? `Abrir ${preferredPlatformLabel}: ${p.mainAccountRiotId || p.riotId}` : undefined}
                  >
                    <span className="pos">{p._rank}</span>

                    <div className="player-main">
                      {p.profileIconId && (
                        <img
                          className="icon"
                          src={`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/profileicon/${p.profileIconId}.png`}
                          alt=""
                        />
                      )}
                      <div className="player-info">
                        {p.emote && <span className="riot-emote">{formatMoteDisplay(p.emote)}</span>}
                        {showRiotIdRow && (
                          <div className="riot-id-row">
                            <span className="riot-id">{p.riotId}</span>
                            {showInGameChip && (
                              <button
                                type="button"
                                className="live-game-chip live-game-chip--inline"
                                title={inGameChipTitle}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openOpggUrl(liveGameUrl);
                                }}
                                onKeyDown={(event) => {
                                  if (event.key !== "Enter" && event.key !== " ") return;
                                  event.preventDefault();
                                  event.stopPropagation();
                                  openOpggUrl(liveGameUrl);
                                }}
                              >
                                IN GAME
                              </button>
                            )}
                          </div>
                        )}
                        <div className="profile-platforms" aria-label="Perfiles externos">
                          {getProfilePlatformLinks(p.mainAccountRiotId || p.riotId).map((platform) => (
                            <button
                              key={`${p.groupKey || p.riotId}-${platform.key}`}
                              type="button"
                              className="profile-platform-btn"
                              title={`Abrir ${platform.label}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                openOpggUrl(platform.url);
                              }}
                              onKeyDown={(event) => {
                                if (event.key !== "Enter" && event.key !== " ") return;
                                event.preventDefault();
                                event.stopPropagation();
                                openOpggUrl(platform.url);
                              }}
                            >
                              <img src={platform.icon} alt={platform.label} />
                            </button>
                          ))}
                        </div>
                        {p.accountCount > 1 && <span className="riot-alts">Cuenta top: {p.mainAccountRiotId || p.riotId}</span>}
                        {rankingMode === "all" && p.ownerRiotId && String(p.ownerRiotId).toLowerCase() !== String(p.riotId || "").toLowerCase() && (
                          <span className="riot-alts">Dueño: {p.ownerRiotId}</span>
                        )}
                        {p.altAccounts?.length > 0 && (
                          <span className="riot-alts">
                            Smurfs: {p.altAccounts.join(" · ")}
                            {p.altAccountsHiddenCount > 0 ? ` · +${p.altAccountsHiddenCount}` : ""}
                          </span>
                        )}
                        {p.summonerLevel && <span className="level">Nv. {p.summonerLevel}</span>}
                      </div>
                    </div>

                    <ChampIcons champions={p.topChampions} version={ddragonVersion} />

                    <div className="role-cell">
                      <RoleIcon role={p.mainRole} />
                    </div>

                    <div className="player-rank">
                      {p.error ? (
                        <span className="no-rank error-text">{p.error}</span>
                      ) : (
                        <>
                          <div className="player-rank-main">
                            <div className="player-rank-badges">
                              <div className="queue-badge-stack">
                                <RankBadge rankData={p.soloq} queueLabel="SOLOQ" />
                                {p.soloq && <WinRate wins={p.soloq.wins} losses={p.soloq.losses} />}
                              </div>
                              <div className="queue-badge-stack">
                                <RankBadge rankData={p.flex} queueLabel="FLEX" />
                                <span className="queue-understat">{formatQueueSummary(p.flex) || "Sin games"}</span>
                              </div>
                            </div>
                          </div>
                        </>
                      )}
                    </div>

                    <div className="player-warns" title="Senales del jugador">
                      {playerWarnings.length > 0 ? (
                        playerWarnings.map((warn) => (
                          <span key={warn} className="warn-pill" title={warn}>{warn}</span>
                        ))
                      ) : (
                        <span className="warn-pill warn-pill--empty">Sin señales</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </>
  );

  const hachitasContent = (
    <>
      {loading ? (
        <div className="loading">Cargando hachitas...</div>
      ) : (
        <>
          <div className="hachitas-header">
            <h3>Top 10 Jugadores</h3>
            <p className="hachitas-desc">Los mejores jugadores están aquí</p>
          </div>

          <div className="hachitas-list">
            {filteredPlayers.slice(0, 10).length === 0 ? (
              <div className="empty">No hay jugadores en el ranking.</div>
            ) : (
              filteredPlayers.slice(0, 10).map((p) => {
                const playerProfileUrl = getPreferredPlatformUrl(p.mainAccountRiotId || p.riotId, preferredPlatform);
                return (
                  <div
                    key={p.groupKey || p.riotId}
                    className={`hachita-card ${playerProfileUrl ? "hachita-card--clickable" : ""}`}
                    role={playerProfileUrl ? "button" : undefined}
                    tabIndex={playerProfileUrl ? 0 : undefined}
                    onClick={playerProfileUrl ? () => openOpggForPlayer(p) : undefined}
                    onKeyDown={playerProfileUrl ? (event) => handleOpenOpggKeyDown(event, p) : undefined}
                    title={playerProfileUrl ? `Abrir ${preferredPlatformLabel}: ${p.mainAccountRiotId || p.riotId}` : undefined}
                  >
                    <div className="hachita-rank-badge">{p._rank}</div>
                    <div className="hachita-info">
                      <div className="hachita-name">{p.emote ? `${p.emote} · ${p.riotId}` : p.riotId}</div>
                      <div className="hachita-tier">{p.soloq?.tier || "Sin rank"} {p.soloq?.rank || ""}</div>
                      {p.altAccounts?.length > 0 && <div className="hachita-tier">Alts: {p.altAccounts.join(" · ")}</div>}
                    </div>
                    <div className="hachita-lp">{p.soloq?.leaguePoints || 0} LP</div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </>
  );

  const infoContent = (
    <div className="info-grid info-grid--technical">
      <section className="panel-section">
        <div className="section-heading">
          <div>
            <p className="section-kicker">Cache</p>
            <h2>Estado del backend</h2>
          </div>
        </div>
        <div className="info-list">
          <div className="info-item">
            <span className="info-label">Ultima actualizacion</span>
            <strong>{cacheMeta.cachedAt ? new Date(cacheMeta.cachedAt).toLocaleString() : "Pendiente"}</strong>
          </div>
          <div className="info-item">
            <span className="info-label">Intervalo</span>
            <strong>
              {cacheMeta.cacheTtlMs ? `${Math.round(cacheMeta.cacheTtlMs / 1000)} segundos` : "No disponible"}
            </strong>
          </div>
          <div className="info-item">
            <span className="info-label">Estado</span>
            <strong>{cacheMeta.stale ? "Usando cache antigua" : "Cache al dia"}</strong>
          </div>
          <div className="info-item">
            <span className="info-label">Ultimo error</span>
            <strong>{cacheMeta.lastError || "Sin errores"}</strong>
          </div>
        </div>
      </section>

      <section className="panel-section">
        <div className="section-heading">
          <div>
            <p className="section-kicker">Tecnico</p>
            <h2>Info tecnica</h2>
          </div>
        </div>
        <div className="info-list">
          <div className="info-item">
            <span className="info-label">Host actual</span>
            <strong>{window.location.origin}</strong>
          </div>
          <div className="info-item">
            <span className="info-label">Entorno</span>
            <strong>{import.meta.env.DEV ? "development" : "production"}</strong>
          </div>
          <div className="info-item">
            <span className="info-label">VITE_API_URL</span>
            <strong>{RAW_API_ENV || "(no definida)"}</strong>
          </div>
          <div className="info-item">
            <span className="info-label">API efectiva</span>
            <strong>{API}</strong>
          </div>
          <div className="info-item">
            <span className="info-label">Modo conexion API</span>
            <strong>{API === window.location.origin ? "same-origin" : "cross-origin"}</strong>
          </div>
          <div className="info-item">
            <span className="info-label">Guardia anti-localhost</span>
            <strong>{SHOULD_IGNORE_LOCAL_API_IN_PROD ? "activo (localhost ignorado en prod)" : "no aplicada"}</strong>
          </div>
          <div className="info-item">
            <span className="info-label">Rate limit Riot</span>
            <strong>{apiStatus?.riotRateLimited ? `Activo (${apiStatus?.rateLimitSecondsLeft || 0}s)` : "Sin bloqueo"}</strong>
          </div>
          <div className="info-item">
            <span className="info-label">Presupuesto API</span>
            <strong>
              1s: {Number(apiStatus?.budgetRemaining1s) || 0} · 2m: {Number(apiStatus?.budgetRemaining2min) || 0}
            </strong>
          </div>
          <div className="info-item">
            <span className="info-label">Requests Riot</span>
            <strong>
              hoy: {Number(apiStatus?.todayRequests) || 0} · total: {Number(apiStatus?.totalRequests) || 0}
            </strong>
          </div>
          <div className="info-item">
            <span className="info-label">Cache backend</span>
            <strong>
              players: {Number(apiStatus?.playersCached) || players.length} · raw: {Number(apiStatus?.rawDataCached) || 0}
            </strong>
          </div>
          <div className="info-item">
            <span className="info-label">Refresh en curso</span>
            <strong>{apiStatus?.isRefreshing ? "Si" : "No"}</strong>
          </div>
          <div className="info-item">
            <span className="info-label">Version DDragon</span>
            <strong>{cacheMeta.ddragonVersion || "desconocida"}</strong>
          </div>
          <div className="info-item">
            <span className="info-label">Consent analytics</span>
            <strong>{consentChoice}</strong>
          </div>
          <div className="info-item">
            <span className="info-label">Endpoints clave</span>
            <strong>/api/ladder · /api/status · /api/activity-feed · /api/admin/metrics</strong>
          </div>
          <div className="info-item">
            <span className="info-label">Stack</span>
            <strong>React + Vite · Node + Express · Riot API</strong>
          </div>
          <div className="info-item">
            <span className="info-label">lucas gay</span>
            <strong>si</strong>
          </div>
        </div>
      </section>
    </div>
  );

  const activityContent = (
    <section className="activity-feed-page">
      <div className="activity-feed-header">
        <h3>Actividad desglosada</h3>
        <p>
          {activityFeedMeta.updatedAt
            ? `Actualizado: ${new Date(activityFeedMeta.updatedAt).toLocaleString()}`
            : "Actualizando feed..."}
        </p>
      </div>

      {activityFeedLoading && activityFeed.length === 0 ? (
        <div className="loading">Cargando actividad...</div>
      ) : activityFeed.length === 0 ? (
        <div className="empty">No hay cambios de LP hoy todavia.</div>
      ) : (
        <div className="activity-feed-list">
          {activityFeed.map((entry, idx) => (
            <article
              key={`${entry.player || "player"}-${entry.updatedAt || idx}`}
              className={`activity-feed-item ${buildOpggMatchUrlFromEntry(entry) ? "activity-feed-item--clickable" : ""}`}
              role={buildOpggMatchUrlFromEntry(entry) ? "button" : undefined}
              tabIndex={buildOpggMatchUrlFromEntry(entry) ? 0 : undefined}
              onClick={buildOpggMatchUrlFromEntry(entry) ? () => openOpggUrl(buildOpggMatchUrlFromEntry(entry)) : undefined}
              onKeyDown={buildOpggMatchUrlFromEntry(entry) ? (event) => handleOpenActivityEntryKeyDown(event, entry) : undefined}
              title={buildOpggMatchUrlFromEntry(entry) ? "Abrir partida en League of Graphs" : undefined}
            >
              <div className="activity-feed-item__champ-wrap">
                {entry.championName ? (
                  <img
                    className="activity-feed-item__champ"
                    src={`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/champion/${getChampionAssetName(entry.championName)}.png`}
                    alt={entry.championName}
                    title={entry.championName}
                    onError={(e) => { e.target.style.display = "none"; }}
                  />
                ) : (
                  <span className="activity-feed-item__champ activity-feed-item__champ--empty">?</span>
                )}
                <span className="activity-feed-item__kda">{entry.kda || "s/d"}</span>
              </div>
              <div className="activity-feed-item__body">
                <span className={`activity-feed-item__delta ${Number(entry.lpDelta) < 0 ? "is-down" : "is-up"}`}>
                  {Number(entry.lpDelta) > 0 ? `+${entry.lpDelta}` : entry.lpDelta} LP
                </span>
                <p className="activity-feed-item__text">{formatActivityText(entry.text)}</p>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );

  const adminContent = (
    <AdminPanel
      apiBase={API}
      onRosterChanged={async () => {
        await loadLadder(true);
        await loadActivityFeed(true);
      }}
    />
  );

  const privacyContent = <PrivacyPage />;

  const tabContent = {
    ranking: rankingContent,
    activity: activityContent,
    hachitas: hachitasContent,
    users: usersContent,
    admin: adminContent,
    privacy: privacyContent,
    info: infoContent,
  };

  return (
    <AppLayout onTabChange={setActiveTab} activeTab={activeTab}>
      <div className="app">
        <div className="container">
          {error && <div className="error">{error}</div>}
          {tabContent[activeTab]}
        </div>
      </div>

      <div
        className={`rank-platform-picker ${consentChoice === "pending" ? "rank-platform-picker--with-consent" : ""}`}
        role="group"
        aria-label="Elige plataforma favorita"
      >
        <span className="rank-platform-picker__label">Elige plataforma favorita</span>
        <div className="rank-platform-picker__buttons">
          {PROFILE_PLATFORM_OPTIONS.map((platform) => (
            <button
              key={platform.key}
              type="button"
              className={`rank-platform-btn ${preferredPlatform === platform.key ? "is-active" : ""}`}
              onClick={() => setPreferredPlatform(platform.key)}
              title={`Abrir jugador con ${platform.label}`}
              aria-label={`Usar ${platform.label} como plataforma favorita`}
              aria-pressed={preferredPlatform === platform.key}
            >
              <img src={platform.icon} alt={platform.label} loading="lazy" />
            </button>
          ))}
        </div>
      </div>

      {consentChoice === "pending" && (
        <aside className="consent-banner" role="dialog" aria-live="polite" aria-label="Consentimiento de analitica">
          <div className="consent-banner__text">
            <strong>Privacidad y metricas</strong>
            <p>
              Usamos metrica anonima para saber desde donde se visita la web. Solo se registra si aceptas.
              Puedes revisar los detalles en la seccion de Privacidad.
            </p>
          </div>
          <div className="consent-banner__actions">
            <button type="button" className="consent-banner__btn consent-banner__btn--accept" onClick={() => handleConsentDecision("accepted")}>
              Aceptar
            </button>
            <button type="button" className="consent-banner__btn consent-banner__btn--reject" onClick={() => handleConsentDecision("rejected")}>
              Rechazar
            </button>
            <button type="button" className="consent-banner__btn consent-banner__btn--link" onClick={() => setActiveTab("privacy")}>
              Ver privacidad
            </button>
          </div>
        </aside>
      )}
    </AppLayout>
  );
}

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import "./index.css";
import AppLayout from "./components/AppLayout.jsx";
import Masonry from "react-masonry-css";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";
const API = API_BASE;

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
      {iconUrl && (
        <img src={iconUrl} alt={rankData.tier} className="rank-icon" onError={(e) => { e.target.style.display = "none"; }} />
      )}
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

const TIER_POINTS = {
  IRON: 1000,
  BRONZE: 2000,
  SILVER: 3000,
  GOLD: 4000,
  PLATINUM: 5000,
  EMERALD: 6000,
  DIAMOND: 7000,
  MASTER: 8000,
  GRANDMASTER: 9000,
  CHALLENGER: 10000,
};

const DIVISION_POINTS = { IV: 1, III: 2, II: 3, I: 4 };

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
  const tierValue = TIER_POINTS[player.soloq.tier] || 0;
  const divisionValue = DIVISION_POINTS[player.soloq.rank] || 0;
  return tierValue + divisionValue * 100 + (player.soloq.leaguePoints || 0);
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
  if (explicitDuoMate) {
    if (winRate >= 50) notes.push(`Hace duo con ${explicitDuoMate}`);
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

  if ((player.soloq.leaguePoints || 0) >= 70) notes.push("A 2 wins de promo");

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
  if (explicitDuoMate) {
    notes.push(pickSignalText([
      `Suele jugar duo con ${explicitDuoMate}`,
      `Ultimamente aparece en duo con ${explicitDuoMate}`,
      `Se le ve bastante en premade con ${explicitDuoMate}`,
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
  if (currentLp >= 75) {
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
            src={`https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${name}.png`}
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
  const [activeTab, setActiveTab] = useState("ranking");
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterRole, setFilterRole] = useState("ALL");
  const [cacheMeta, setCacheMeta] = useState({
    cachedAt: null,
    cacheTtlMs: null,
    stale: false,
    lastError: null,
    ddragonVersion: "14.24.1",
  });
  const [apiStatus, setApiStatus] = useState(null);
  const statusSignatureRef = useRef("");

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
    if (activeTab !== "ranking") return;
    const timer = setInterval(() => {
      loadLadder(true);
    }, 90 * 1000);
    return () => clearInterval(timer);
  }, [activeTab, loadLadder]);

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
      const primaryRiotId = bestSoloqAccount?.riotId || null;
      const wins = accounts.reduce((sum, p) => sum + (p.soloq?.wins || 0), 0);
      const losses = accounts.reduce((sum, p) => sum + (p.soloq?.losses || 0), 0);
      const mergedChamps = [];
      for (const acc of sortedByScore) {
        for (const champ of acc.topChampions || []) {
          if (!mergedChamps.includes(champ)) mergedChamps.push(champ);
          if (mergedChamps.length === 3) break;
        }
        if (mergedChamps.length === 3) break;
      }

      return {
        ...bestSoloqAccount,
        groupKey: owner,
        riotId: accounts.length === 1
          ? (bestSoloqAccount?.riotId || owner)
          : owner,
        mainAccountRiotId: bestSoloqAccount?.riotId || null,
        emote: accounts.find((a) => a.emote)?.emote || bestSoloqAccount?.emote || null,
        mainRole: getMainRoleFromAccounts(accounts) || normalizeRole(bestSoloqAccount?.mainRole) || null,
        topChampions: mergedChamps,
        altAccounts: sortedByScore
          .map((a) => a.riotId)
          .filter((id) => id && id !== primaryRiotId)
          .slice(0, 2),
        altAccountsHiddenCount: Math.max(0, accounts.length - 1 - 2),
        accountCount: accounts.length,
        soloq: bestSoloqAccount?.soloq
          ? { ...bestSoloqAccount.soloq, wins, losses }
          : null,
      };
    });
  }, [players]);

  const filteredPlayers = groupedPlayers
    .map((p, idx) => ({ ...p, _rank: idx + 1 }))
    .filter((p) => {
      const matchesSearch =
        !searchQuery ||
        p.riotId.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.altAccounts?.some((alt) => alt.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchesRole = filterRole === "ALL" || normalizeRole(p.mainRole) === filterRole;
      return matchesSearch && matchesRole;
    });

  const rankedPlayers = groupedPlayers.filter((player) => !player.error);

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
    const withIcons = players.filter((p) => p?.profileIconId);
    const source = withIcons.length > 0 ? withIcons : players;
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
              <article
                key={`${player.riotId}-${player.puuid || "no-puuid"}`}
                className="summoner-tile"
                style={{ minHeight: `${player.tileHeight}px` }}
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
            ))}
          </Masonry>
        )}
      </section>
    </>
  );

  const getActivityStats = () => {
    const ranked = groupedPlayers.filter((p) => !p.error && p.soloq);
    if (ranked.length === 0) return null;
    
    const topLP = ranked.reduce((max, p) => 
      (!max || p.soloq.leaguePoints > max.soloq.leaguePoints) ? p : max
    );
    
    const tierCounts = ranked.reduce((acc, p) => {
      acc[p.soloq.tier] = (acc[p.soloq.tier] || 0) + 1;
      return acc;
    }, {});
    const mostCommonTier = Object.entries(tierCounts).sort((a, b) => b[1] - a[1])[0];
    
    const roleCounts = ranked.reduce((acc, p) => {
      if (p.mainRole) acc[p.mainRole] = (acc[p.mainRole] || 0) + 1;
      return acc;
    }, {});
    const mostCommonRole = Object.entries(roleCounts).sort((a, b) => b[1] - a[1])[0];
    
    return { topLP, mostCommonTier, mostCommonRole };
  };

  const stats = getActivityStats();
  const dailyHighlights = apiStatus?.dailyHighlights || null;
  const bestOverallToday = dailyHighlights?.bestOverallGain || null;
  const bestSoloToday = dailyHighlights?.bestSoloqGain || null;
  const bestFlexToday = dailyHighlights?.bestFlexGain || null;
  const worstSoloToday = dailyHighlights?.worstSoloqLoss || null;
  const worstOverallToday = dailyHighlights?.worstOverallLoss || null;

  const fallbackTopTodayPlayer = useMemo(() => {
    if (rankedPlayers.length === 0) return null;
    return [...rankedPlayers].sort((a, b) => getSoloqScore(b) - getSoloqScore(a))[0] || null;
  }, [rankedPlayers]);

  const rankingContent = (
    <>
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
            <span className="activity-meta-pill">📡 API: total {apiStatus?.totalRequests ?? 0} · hoy {apiStatus?.todayRequests ?? 0}</span>
          </div>
        </div>

        <div className="activity-grid">
          <div className="activity-card activity-card--winner">
            <span className="activity-label">Ganador LPs hoy (global)</span>
            <span className="activity-value">{bestOverallToday?.player || fallbackTopTodayPlayer?.riotId || "—"}</span>
            <span className="activity-delta-hero activity-delta-hero--up">{formatSignedLps(bestOverallToday?.deltaLp ?? 0)}</span>
            <span className="activity-detail">{formatLpDelta(bestOverallToday?.deltaLp ?? 0)}</span>
          </div>

          <div className="activity-card activity-card--winner">
            <span className="activity-label">Ganador LPs hoy (FLEX)</span>
            <span className="activity-value">{bestFlexToday?.player || "—"}</span>
            <span className="activity-delta-hero activity-delta-hero--up">{formatSignedLps(bestFlexToday?.deltaLp ?? 0)}</span>
            <span className="activity-detail">{formatLpDelta(bestFlexToday?.deltaLp ?? 0)}</span>
          </div>

          <div className="activity-card activity-card--signals">
            <span className="activity-label">Señales</span>
            <ActivityTicker groupedPlayers={groupedPlayers} />
          </div>

          <div className="activity-card activity-card--loser">
            <span className="activity-label">Perdedor LPs hoy (global)</span>
            <span className="activity-value">{worstOverallToday?.player || worstSoloToday?.player || "—"}</span>
            <span className="activity-delta-hero activity-delta-hero--down">{formatSignedLps(worstOverallToday?.deltaLp ?? worstSoloToday?.deltaLp ?? 0)}</span>
            <span className="activity-detail">{formatLpDelta(worstOverallToday?.deltaLp ?? worstSoloToday?.deltaLp ?? 0)}</span>
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
          </div>
        </div>
      </div>

      {loading ? (
        <div className="loading">Cargando ladder...</div>
      ) : (
        <>
          <div className="rank-col-header">
            <span>#</span>
            <span>JUGADOR</span>
            <span>TOP CHAMPS</span>
            <span>ROL</span>
            <span>ELO</span>
            <span>SENALES</span>
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
                return (
                  <div
                    key={p.groupKey || p.riotId}
                    className={`player-row ${p.error ? "player-error" : ""} ${p._rank <= 3 ? `player-top player-top-${p._rank}` : "player-regular"}`}
                    style={{ "--tier-color": TIER_COLORS[p.soloq?.tier] || "var(--line)" }}
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
                        {shouldRenderRiotId(p.emote, p.riotId) && <span className="riot-id">{p.riotId}</span>}
                        <span className="riot-alts">{p.mainAccountRiotId || p.riotId}</span>
                        {p.altAccounts?.length > 0 && (
                          <span className="riot-alts">
                            Alt: {p.altAccounts.join(" · ")}
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
                        <span className="warn-pill warn-pill--empty">Sin senales</span>
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
              filteredPlayers.slice(0, 10).map((p) => (
                <div key={p.groupKey || p.riotId} className="hachita-card">
                  <div className="hachita-rank-badge">{p._rank}</div>
                  <div className="hachita-info">
                    <div className="hachita-name">{p.emote ? `${p.emote} · ${p.riotId}` : p.riotId}</div>
                    <div className="hachita-tier">{p.soloq?.tier || "Sin rank"} {p.soloq?.rank || ""}</div>
                    {p.altAccounts?.length > 0 && <div className="hachita-tier">Alts: {p.altAccounts.join(" · ")}</div>}
                  </div>
                  <div className="hachita-lp">{p.soloq?.leaguePoints || 0} LP</div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </>
  );

  const infoContent = (
    <div className="info-grid">
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
            <p className="section-kicker">Aplicacion</p>
            <h2>Como funciona</h2>
          </div>
        </div>
        <p className="panel-copy">
          Ranking de los pringados de Tullidos.
        </p>
        <p className="panel-copy">
          El cliente esta hecho con React y el servidor usa Express para servir la API y consultar Riot.
        </p>
      </section>
    </div>
  );

  const tabContent = {
    ranking: rankingContent,
    hachitas: hachitasContent,
    users: usersContent,
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
    </AppLayout>
  );
}

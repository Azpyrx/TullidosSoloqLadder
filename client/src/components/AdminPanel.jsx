import { useCallback, useMemo, useState } from "react";

function parseRiotId(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw || !raw.includes("#")) return null;
  const [gameNameRaw, tagLineRaw] = raw.split("#");
  const gameName = String(gameNameRaw || "").trim();
  const tagLine = String(tagLineRaw || "").trim();
  if (!gameName || !tagLine) return null;
  return { gameName, tagLine };
}

export default function AdminPanel({ apiBase, onRosterChanged }) {
  const [adminToken, setAdminToken] = useState(() => localStorage.getItem("tsl-admin-token") || "");
  const [friendRiotId, setFriendRiotId] = useState("");
  const [friendMote, setFriendMote] = useState("");
  const [friends, setFriends] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [loadingFriends, setLoadingFriends] = useState(false);
  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const authHeaders = useMemo(() => ({
    "Content-Type": "application/json",
    "x-admin-token": adminToken,
  }), [adminToken]);
  const hasAdminToken = adminToken.trim().length > 0;

  const persistToken = useCallback((value) => {
    const safe = String(value || "").trim();
    setAdminToken(safe);
    if (safe) localStorage.setItem("tsl-admin-token", safe);
    else localStorage.removeItem("tsl-admin-token");
  }, []);

  const loadFriends = useCallback(async () => {
    setLoadingFriends(true);
    setError("");
    try {
      const res = await fetch(`${apiBase}/api/friends`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setFriends(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || "No se pudo cargar la lista de jugadores");
    } finally {
      setLoadingFriends(false);
    }
  }, [apiBase]);

  const loadMetrics = useCallback(async () => {
    if (!adminToken) {
      setError("Introduce token admin para ver metricas");
      return;
    }
    setLoadingMetrics(true);
    setError("");
    try {
      const res = await fetch(`${apiBase}/api/admin/metrics`, {
        headers: { "x-admin-token": adminToken },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setMetrics(data);
    } catch (err) {
      setError(err.message || "No se pudieron cargar metricas");
    } finally {
      setLoadingMetrics(false);
    }
  }, [adminToken, apiBase]);

  const handleAddPlayer = useCallback(async () => {
    if (!adminToken) {
      setError("Introduce token admin para agregar jugadores");
      return;
    }

    const parsed = parseRiotId(friendRiotId);
    if (!parsed) {
      setError("Formato invalido. Usa Nombre#TAG");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`${apiBase}/api/friends`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          gameName: parsed.gameName,
          tagLine: parsed.tagLine,
          mote: String(friendMote || "").trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setFriendRiotId("");
      setFriendMote("");
      setNotice("Jugador agregado correctamente");
      await loadFriends();
      await onRosterChanged?.();
    } catch (err) {
      setError(err.message || "No se pudo agregar el jugador");
    } finally {
      setSaving(false);
    }
  }, [adminToken, apiBase, authHeaders, friendMote, friendRiotId, loadFriends, onRosterChanged]);

  const handleDeletePlayer = useCallback(async (gameName, tagLine) => {
    if (!adminToken) {
      setError("Introduce token admin para borrar jugadores");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`${apiBase}/api/friends/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`, {
        method: "DELETE",
        headers: {
          "x-admin-token": adminToken,
        },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setNotice(`Jugador eliminado: ${gameName}#${tagLine}`);
      await loadFriends();
      await onRosterChanged?.();
    } catch (err) {
      setError(err.message || "No se pudo eliminar el jugador");
    } finally {
      setSaving(false);
    }
  }, [adminToken, apiBase, loadFriends, onRosterChanged]);

  const handleForceRefresh = useCallback(async () => {
    if (!adminToken) {
      setError("Introduce token admin para forzar refresh");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`${apiBase}/api/force-refresh`, {
        method: "POST",
        headers: {
          "x-admin-token": adminToken,
        },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setNotice(body.message || "Refresh lanzado");
      await onRosterChanged?.();
    } catch (err) {
      setError(err.message || "No se pudo forzar refresh");
    } finally {
      setSaving(false);
    }
  }, [adminToken, apiBase, onRosterChanged]);

  return (
    <section className="admin-page">
      <div className="admin-grid">
        <article className="admin-card">
          <h3>Acceso admin</h3>
          <p>Token local para operaciones de escritura y metricas.</p>
          <label className="admin-label" htmlFor="admin-token-input">Token admin</label>
          <input
            id="admin-token-input"
            type="password"
            className="admin-input"
            placeholder="ADMIN_TOKEN"
            value={adminToken}
            onChange={(event) => persistToken(event.target.value)}
          />
          <div className="admin-actions">
            <button type="button" onClick={loadFriends} disabled={loadingFriends || saving}>
              {loadingFriends ? "Cargando..." : "Cargar jugadores"}
            </button>
            {hasAdminToken && (
              <button type="button" className="admin-ghost" onClick={loadMetrics} disabled={loadingMetrics || saving}>
                {loadingMetrics ? "Cargando..." : "Cargar metricas"}
              </button>
            )}
          </div>
          <div className="admin-actions">
            <button type="button" className="admin-ghost" onClick={handleForceRefresh} disabled={saving || loadingFriends}>
              Forzar refresh ladder
            </button>
            <button type="button" className="admin-ghost" onClick={() => persistToken("")}>
              Borrar token guardado
            </button>
          </div>
        </article>

        <article className="admin-card">
          <h3>Gestion de jugadores</h3>
          <p>Agregar o quitar jugadores del ladder.</p>
          <label className="admin-label" htmlFor="new-player-input">Riot ID</label>
          <input
            id="new-player-input"
            type="text"
            className="admin-input"
            placeholder="Nombre#TAG"
            value={friendRiotId}
            onChange={(event) => setFriendRiotId(event.target.value)}
          />
          <label className="admin-label" htmlFor="new-player-mote-input">Mote (opcional)</label>
          <input
            id="new-player-mote-input"
            type="text"
            className="admin-input"
            placeholder="Mote"
            value={friendMote}
            onChange={(event) => setFriendMote(event.target.value)}
          />
          <div className="admin-actions">
            <button type="button" onClick={handleAddPlayer} disabled={saving}>Agregar</button>
            <button type="button" className="admin-ghost" onClick={loadFriends} disabled={saving || loadingFriends}>Recargar</button>
          </div>

          {friends.length === 0 && !loadingFriends ? (
            <p className="admin-muted">Sin jugadores cargados.</p>
          ) : (
            <ul className="admin-list">
              {friends.map((friend, idx) => (
                <li key={`${friend.gameName}-${friend.tagLine}-${idx}`}>
                  <span>{friend.gameName}#{friend.tagLine}</span>
                  <button
                    type="button"
                    className="admin-danger"
                    disabled={saving}
                    onClick={() => handleDeletePlayer(friend.gameName, friend.tagLine)}
                  >
                    Eliminar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>

      {hasAdminToken && (
        <article className="admin-card admin-card--metrics">
          <h3>Metricas de visitas (anonimizadas)</h3>
          <p>Solo se registran tras consentimiento y con IP anonimizada.</p>
          {metrics ? (
            <>
              <div className="admin-metrics-summary">
                <div>
                  <strong>Vistas consentidas</strong>
                  <span>{metrics?.totals?.consentedPageViews || 0}</span>
                </div>
                <div>
                  <strong>Total vistas guardadas</strong>
                  <span>{metrics?.totals?.pageViews || 0}</span>
                </div>
                <div>
                  <strong>Ultima actualizacion</strong>
                  <span>{metrics?.lastUpdatedAt ? new Date(metrics.lastUpdatedAt).toLocaleString() : "-"}</span>
                </div>
              </div>

              <div className="admin-metrics-columns">
                <div>
                  <h4>Paises top</h4>
                  <ul className="admin-mini-list">
                    {(metrics.topCountries || []).map((item) => (
                      <li key={item.country}>{item.country}: {item.views}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4>Ciudades top</h4>
                  <ul className="admin-mini-list">
                    {(metrics.topCities || []).map((item) => (
                      <li key={item.city}>{item.city}: {item.views}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4>Paginas top</h4>
                  <ul className="admin-mini-list">
                    {(metrics.topPaths || []).map((item) => (
                      <li key={item.path}>{item.path}: {item.views}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <h4>Ultimos eventos</h4>
              <div className="admin-events">
                {(metrics.recentEvents || []).slice(0, 30).map((event) => (
                  <div key={event.id} className="admin-event-row">
                    <span>{event.at ? new Date(event.at).toLocaleString() : "-"}</span>
                    <span>{event.country || "??"}</span>
                    <span>{event.city || "unknown"}</span>
                    <span>{event.pagePath || "/"}</span>
                    <span>{event.source || "direct"}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="admin-muted">Carga metricas para ver el panel.</p>
          )}
        </article>
      )}

      {error && <p className="admin-message admin-message--error">{error}</p>}
      {notice && <p className="admin-message admin-message--ok">{notice}</p>}
    </section>
  );
}

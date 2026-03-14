# 🏆 Tullidos SoloQ Ladder

![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white)
![Express](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)
![License](https://img.shields.io/badge/licencia-MIT-green)

Aplicación web fullstack para visualizar un **ladder personalizado de League of Legends** con métricas de SoloQ/Flex, actividad diaria, seguimiento de LP y muro de usuarios.

---

## 📋 Tabla de contenidos

- [Características](#-características)
- [Tecnologías](#-tecnologías)
- [Estructura del proyecto](#-estructura-del-proyecto)
- [Requisitos previos](#-requisitos-previos)
- [Instalación](#-instalación)
- [Configuración](#-configuración)
- [Uso en desarrollo](#-uso-en-desarrollo)
- [Build de producción](#-build-de-producción)
- [API REST](#-api-rest)
- [Gestión de jugadores (friends.json)](#-gestión-de-jugadores-friendsjson)
- [Deploy](#-deploy)
- [Notas de runtime](#-notas-de-runtime)

---

## ✨ Características

| Funcionalidad | Descripción |
|---|---|
| 🥇 **Ladder personalizado** | Ranking ordenado por tier/división/LP de un grupo de amigos |
| 📊 **Métricas de rango** | SoloQ y Flex con tier, división, LP y winrate |
| 📅 **Seguimiento diario de LP** | Ganancias y pérdidas del día con detección de anomalías de LP |
| 🏆 **Mejores jugadores del día** | Highlights automáticos: mayor ganancia, mayor pérdida, etc. |
| 🎮 **Historial reciente** | Campeones jugados, roles detectados y compañeros de duo |
| 🔄 **Actualización automática** | Refresco de datos cada 2 minutos (configurable) |
| 👥 **Muro de actividad** | Ticker de actividad y estado en tiempo real de cada jugador |
| 🔍 **Filtros** | Búsqueda por nombre y filtrado por rol (Top, Jungle, Mid, ADC, Support) |
| 🌐 **Enlace a OP.GG** | Links directos al perfil de cada jugador |
| ⚙️ **Respeto a rate limits** | Gestión inteligente de los límites de la API de Riot |

---

## 🛠 Tecnologías

**Frontend**
- [React 19](https://react.dev/) con React Compiler
- [Vite 7](https://vitejs.dev/) (bundler y dev server)
- [GSAP](https://gsap.com/) + [Motion](https://motion.dev/) para animaciones
- [react-masonry-css](https://github.com/paulcollett/react-masonry-css) para layout responsive

**Backend**
- [Express 5](https://expressjs.com/)
- [dotenv](https://github.com/motdotla/dotenv) para variables de entorno
- [CORS](https://github.com/expressjs/cors)
- [Riot Games API](https://developer.riotgames.com/) (Account, Summoner, League y Match v5)

---

## 📁 Estructura del proyecto

```
TullidosSoloqLadder/
├── package.json                 # Workspace raíz (scripts de build/start)
│
├── client/                      # Frontend React + Vite
│   ├── package.json
│   ├── vite.config.js
│   ├── index.html
│   └── src/
│       ├── main.jsx             # Entry point
│       ├── App.jsx              # Componente principal y lógica de la app
│       └── components/
│           ├── StaggeredMenu.jsx# Menú de pestañas
│           ├── AnimatedList.jsx # Lista de ranking animada
│           ├── AppLayout.jsx    # Wrapper de layout
│           └── FooterCarousel.jsx # Ticker de actividad
│
└── server/                      # Backend Express
    ├── package.json
    ├── index.js                 # Servidor principal y lógica de API
    ├── friends.json             # Lista de jugadores tracked
    ├── .env.example             # Plantilla de configuración
    └── public/assets/icons/     # Iconos de rangos y roles
        ├── rank/                # challenger, grandmaster, master, etc.
        └── position/            # top, jungle, mid, adc, support
```

---

## 📦 Requisitos previos

- **Node.js** 20 o superior
- **npm** 10 o superior
- Una **Riot Games API Key** — obtenla en [developer.riotgames.com](https://developer.riotgames.com/)

> ⚠️ Las API keys de desarrollo de Riot expiran cada 24 horas. Para uso continuo, solicita una Production Key.

---

## 🚀 Instalación

Clona el repositorio e instala todas las dependencias desde la raíz:

```bash
git clone https://github.com/Azpyrx/TullidosSoloqLadder.git
cd TullidosSoloqLadder
npm install
```

El script `postinstall` instalará automáticamente las dependencias de `server/` y `client/`.

---

## ⚙️ Configuración

Copia el archivo de ejemplo y edítalo con tus valores:

```bash
cp server/.env.example server/.env
```

| Variable | Requerida | Por defecto | Descripción |
|---|---|---|---|
| `RIOT_API_KEY` | ✅ | — | Clave de la API de Riot Games |
| `PORT` | ❌ | `3001` | Puerto del servidor Express |
| `LADDER_CACHE_TTL_MS` | ❌ | `120000` | Intervalo de refresco del ladder (ms) |
| `MATCH_SYNC_TTL_MS` | ❌ | `120000` | Intervalo de refresco de partidas (ms) |
| `RATE_LIMIT_FALLBACK_MS` | ❌ | `60000` | Espera al alcanzar el rate limit (ms) |
| `FRIENDS_PER_REFRESH` | ❌ | `2` | Jugadores actualizados por ciclo (no-full) |
| `MAX_NEW_MATCH_DETAILS_PER_REFRESH` | ❌ | `1` | Detalles de partida nuevos por ciclo |
| `FULL_REFRESH_EVERY_CYCLE` | ❌ | `true` | Refresco total en cada ciclo |
| `ACCOUNT_REFRESH_TTL_MS` | ❌ | `86400000` | TTL de datos de cuenta (24h) |
| `SUMMONER_REFRESH_TTL_MS` | ❌ | `21600000` | TTL de datos de invocador (6h) |
| `LP_STEP_ANOMALY_WINDOW_MS` | ❌ | `1800000` | Ventana para detectar anomalías de LP (30m) |
| `LP_STEP_ANOMALY_THRESHOLD` | ❌ | `55` | Umbral de LP para considerar salto anómalo |
| `ADMIN_TOKEN` | ✅ para admin | — | Token para acceder al panel admin (altas/bajas, refresh y métricas) |
| `MAX_VISIT_METRICS_EVENTS` | ❌ | `3000` | Máximo de eventos de visitas anonimizadas guardados |

---

## 💻 Uso en desarrollo

Abre **dos terminales** en la raíz del proyecto:

**Terminal 1 — Backend:**
```bash
cd server
npm run dev      # usa node --watch para recarga automática
```

**Terminal 2 — Frontend:**
```bash
cd client
npm run dev
```

| Servicio | URL |
|---|---|
| API backend | http://localhost:3001 |
| Frontend (Vite) | http://localhost:5173 |

El frontend apunta por defecto a `localhost:3001`. En producción usa el mismo dominio (ver [Deploy](#-deploy)).

---

## 📦 Build de producción

Desde la raíz del proyecto:

```bash
npm run build    # genera client/dist
npm start        # arranca el servidor Express (sirve también el frontend)
```

El servidor Express sirve el frontend compilado desde `client/dist` y expone la API en `/api/*`.

---

## 🌐 API REST

Todos los endpoints tienen el prefijo `/api`.

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/ladder` | Devuelve todos los jugadores ordenados por rango |
| `GET` | `/api/player?gameName=X&tagLine=Y` | Datos de un jugador específico |
| `GET` | `/api/friends` | Lista los jugadores en seguimiento |
| `POST` | `/api/friends` | Añade un jugador (`{ gameName, tagLine, mote? }`) - requiere `x-admin-token` |
| `DELETE` | `/api/friends/:gameName/:tagLine` | Elimina un jugador del seguimiento - requiere `x-admin-token` |
| `GET` | `/api/status` | Estadísticas de la API (requests, rate limit) |
| `POST` | `/api/force-refresh` | Fuerza un refresco manual del ladder - requiere `x-admin-token` |
| `POST` | `/api/metrics/page-view` | Registra una vista anonimizada (solo con consentimiento) |
| `GET` | `/api/admin/metrics` | Panel de métricas agregadas y últimos eventos - requiere `x-admin-token` |

### Ejemplo de respuesta — `/api/ladder`

```json
[
  {
    "gameName": "Azpy",
    "tagLine": "1337",
    "mote": "Azpy",
    "soloq": {
      "tier": "PLATINUM",
      "rank": "I",
      "leaguePoints": 75,
      "wins": 120,
      "losses": 98
    },
    "flex": { "tier": "GOLD", "rank": "II", "leaguePoints": 40 },
    "recentChampions": ["Jinx", "Caitlyn", "Ashe"],
    "mainRole": "ADC",
    "dailyLpDelta": 23
  }
]
```

---

## 👥 Gestión de jugadores (friends.json)

El archivo `server/friends.json` contiene la lista de jugadores en seguimiento. Puedes editarlo directamente o usar los endpoints de la API.

```json
[
  {
    "gameName": "NombreDeInvocador",
    "tagLine": "EUW",
    "puuid": "",
    "mote": "NombrePersonalizado"
  }
]
```

| Campo | Requerido | Descripción |
|---|---|---|
| `gameName` | ✅ | Nombre de invocador (Riot ID) |
| `tagLine` | ✅ | Tag del Riot ID (sin `#`) |
| `puuid` | ❌ | El servidor lo rellena automáticamente |
| `mote` | ❌ | Apodo visible en la UI |

---

## ☁️ Deploy

### Opción A — Todo en una plataforma (recomendado)

Despliega frontend + backend juntos como un único servicio en **Railway** o **Render**.

| Ajuste | Valor |
|---|---|
| Root Directory | *(vacío — raíz del repo)* |
| Build Command | `npm run build` |
| Start Command | `npm start` |
| Variable de entorno | `RIOT_API_KEY=<tu_clave>` |

El servidor Express sirve tanto la API como el frontend compilado desde el mismo dominio.

#### Railway — paso a paso

1. **New Project → Deploy from GitHub Repo** y selecciona este repositorio.
2. En **Settings** del servicio configura los comandos de la tabla anterior.
3. En **Variables** añade `RIOT_API_KEY`.
4. Haz deploy y revisa los logs.

**Errores comunes en Railway:**

| Error | Solución |
|---|---|
| `npm ERR! missing script: start` | Asegúrate de usar la raíz del repo, no `client/` |
| Página en blanco tras build | Verifica que `client/dist` se generó correctamente |
| `Falta RIOT_API_KEY` | Añade la variable en la sección Variables del servicio |

---

### Opción B — Frontend en Vercel + Backend en Render/Railway

**Frontend (Vercel):**

1. Importa el repo en Vercel.
2. Establece **Root Directory** como `client`.
3. Build Command: `npm run build` · Output Directory: `dist`
4. Añade la variable de entorno: `VITE_API_URL=https://tu-backend-publico`

**Backend (Render / Railway / Fly.io):**

El servidor usa un proceso Express persistente con caché en sistema de archivos (`ladder-cache.json`). Despliégalo en una plataforma con **filesystem persistente**, no en funciones serverless puras (el estado de caché se perdería entre invocaciones).

---

## 📝 Notas de runtime

- `server/ladder-cache.json` — caché de datos del ladder generada en ejecución. **No se versiona.**
- `server/api-stats.json` — estadísticas de uso de la API (rolling de 31 días). **No se versiona.**
- `server/.env` — credenciales y configuración local. **Nunca subir al repositorio.**

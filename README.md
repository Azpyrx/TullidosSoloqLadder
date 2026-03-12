# Tullidos SoloQ Ladder

Aplicacion web para visualizar un ladder personalizado con metricas de SoloQ/FLEX, actividad diaria y muro de usuarios.

## Estructura

- `client/`: frontend en React + Vite.
- `server/`: API en Express para consultar, cachear y exponer datos del ladder.

## Requisitos

- Node.js 20+ recomendado.
- npm 10+ recomendado.

## Configuracion

1. Copia `server/.env.example` a `server/.env`.
2. Completa al menos `RIOT_API_KEY`.

## Instalacion

Instala dependencias en cada proyecto:

```bash
cd server
npm install

cd ../client
npm install
```

## Desarrollo

En una terminal:

```bash
cd server
npm run start
```

En otra terminal:

```bash
cd client
npm run dev
```

- API backend: `http://localhost:3001`
- Frontend: `http://localhost:5173`

## Build de produccion

```bash
cd client
npm run build
```

El resultado queda en `client/dist`.

## Notas

- `server/ladder-cache.json` y `server/api-stats.json` son archivos de runtime y no se versionan.
- `server/.env` no se versiona por seguridad.

## Deploy recomendado

### Deploy entero en una sola plataforma (1 servicio)

Si quieres subir frontend + backend juntos, puedes hacerlo en Render o Railway como un unico servicio web.

Configuracion sugerida:

1. Root del repo: `SOLOQLADDER/`
2. Build Command:
	- `npm --prefix client install && npm --prefix server install && npm --prefix client run build`
3. Start Command:
	- `npm --prefix server run start`
4. Variables de entorno:
	- `RIOT_API_KEY=...`
	- `PORT` (opcional, la plataforma normalmente lo inyecta)

Con esta configuracion:

- El backend sirve la API en `/api/*`.
- El backend tambien sirve el frontend compilado (`client/dist`).
- El frontend usa el mismo dominio para consumir la API en produccion.

### Frontend en Vercel

1. Importa el repo en Vercel.
2. En el proyecto, usa `client` como Root Directory.
3. Configuracion sugerida:
	- Build Command: `npm run build`
	- Output Directory: `dist`
4. Define variable de entorno en Vercel:
	- `VITE_API_URL=https://TU_BACKEND_PUBLICO`

### Backend

El backend actual en `server/` usa proceso Express persistente y archivos locales de cache (`ladder-cache.json`, `api-stats.json`).

Por eso, lo mas estable es desplegarlo en Render/Railway/Fly.io (no serverless puro) y luego apuntar `VITE_API_URL` a ese dominio.

### Importante sobre Vercel + backend actual

Si intentas desplegar `server/index.js` tal cual en funciones serverless, el sistema de archivos es efimero y la app puede perder cache entre invocaciones.

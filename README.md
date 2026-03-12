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

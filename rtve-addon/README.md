# rtve-addon

Addon de Stremio para el contenido gratuito de RTVE Play: series, documentales, programas y cine.

## Qué ofrece

| Catálogo | Tipo | Contenido |
|---|---|---|
| RTVE · Series | series | Programas con `programType` "Serie*", filtrables por género |
| RTVE · Documentales | series | Documentales y reportajes |
| RTVE · Programas | series | Resto de programas (magacines, concursos, infantiles...) |
| RTVE · Cine | movie | Películas de los contenedores de cine (Cine de barrio, Somos cine...) |
| RTVE Play (búsqueda) | series | Búsqueda por nombre de programa |

- Las series se muestran con sus temporadas reales; los programas sin temporadas aparecen como temporada 1 (los últimos 500 episodios completos).
- Los streams son HLS (hasta 1080p) con subtítulos (es/en/gl/ca/eu) cuando existen.

## Cómo funciona

- Catálogo y metadatos: API pública `https://www.rtve.es/api/*` (no requiere cuenta). El índice de ~4.700 programas se carga en memoria al arrancar y se refresca cada 6 h.
- Stream: `ztnr.rtve.es/ztnr/{id}.m3u8` responde 302 a un manifest HLS del CDN. Esa URL no está ligada a la IP, así que se entrega directamente al cliente de Stremio: **el servidor no hace de proxy** del vídeo.
- RTVE (Fastly) devuelve 403 si la petición no lleva un User-Agent de navegador; el addon lo envía en todas sus llamadas.

## Limitaciones

- Contenido con DRM (Widevine) no se puede reproducir y devuelve 0 streams.
- Los directos no están incluidos.
- No hay autenticación: solo expone contenido público de RTVE, no hay nada que proteger.

## Ejecutar

```bash
npm install
npm run dev        # http://localhost:8000/manifest.json
```

Variables: `PORT` (por defecto 8000).

## Despliegue

Imagen publicada por GitHub Actions en `ghcr.io/aghermida/rtve-addon:latest`. Ver `.github/workflows/rtve-addon.yml`.

```yaml
services:
  rtve-addon:
    image: ghcr.io/aghermida/rtve-addon:latest
    container_name: rtve-addon
    restart: unless-stopped
    ports:
      - "127.0.0.1:8002:8000"
```

Detrás de un proxy inverso con HTTPS (Stremio exige HTTPS salvo en localhost), e instalar con `https://<dominio>/manifest.json`.

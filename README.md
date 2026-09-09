# Stremio_Addons

Colección de addons de Stremio independientes, cada uno en su propia carpeta con su propio `Dockerfile`, dependencias y pipeline de build/publish. No comparten código ni herramientas entre sí — cada addon se puede construir y desplegar de forma aislada.

## Addons

| Addon | Descripción | Imagen |
|---|---|---|
| [`nextcloud-addon`](./nextcloud-addon) | Addon de Stremio que expone archivos de una carpeta de Nextcloud (vía WebDAV) como catálogo navegable y streams reproducibles. | `ghcr.io/aghermida/nextcloud-addon:latest` |

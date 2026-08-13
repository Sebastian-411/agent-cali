FROM node:22-alpine AS build
WORKDIR /app

# Vite resuelve las VITE_* en tiempo de BUILD: por eso viaja como build arg y no
# como variable de entorno del contenedor. Vacío = el navegador usa el mismo
# origen y llega al backend por el proxy /api de nginx.
ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
RUN npm run build

FROM nginx:alpine
# BACKEND_URL sí se resuelve al arrancar el contenedor (ver templates/).
ENV BACKEND_URL=http://backend:3000
# DNS interno de Docker. Fuera de Docker, apúntalo al resolver de la red.
ENV NGINX_RESOLVER=127.0.0.11
ENV NGINX_ENVSUBST_FILTER=BACKEND_URL|NGINX_RESOLVER
COPY nginx/templates /etc/nginx/templates
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80

# Jafra Z UI: static Vite build served by unprivileged nginx on :8080 (works under OpenShift's random uid).
# The build stage runs on the build host's arch (output is plain JS/CSS), so multi-arch needs no emulation for npm.
FROM --platform=$BUILDPLATFORM docker.io/library/node:20-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src
# Optional prefill of empty settings; users can still change them in Settings or via ?analyzer_url= ?laya_url= ?jafraz_url=
ARG VITE_ANALYZER_URL=""
ARG VITE_LAYA_URL="http://localhost:8000"
ARG VITE_JAFRAZ_URL="http://localhost:8081"
ENV VITE_ANALYZER_URL=$VITE_ANALYZER_URL VITE_LAYA_URL=$VITE_LAYA_URL VITE_JAFRAZ_URL=$VITE_JAFRAZ_URL
RUN npm run build

FROM docker.io/nginxinc/nginx-unprivileged:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

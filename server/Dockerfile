FROM node:20-bookworm-slim

# libs de runtime (wrtc/sharp/bcrypt) + toolchain de build
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates tzdata \
    libnss3 libnspr4 libasound2 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libgbm1 libgtk-3-0 libxcomposite1 \
    libxdamage1 libxrandr2 libxkbcommon0 libpango-1.0-0 libcairo2 \
 && rm -rf /var/lib/apt/lists/*

ENV TZ=America/Sao_Paulo
ENV NODE_ENV=production
ENV PORT=3010

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /app/sessions /app/client/public/media /app/client/public/meta-media \
 && chown -R node:node /app

USER node

EXPOSE 3010

CMD ["node", "server.js"]

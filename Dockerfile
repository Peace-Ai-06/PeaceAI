FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache bubblewrap util-linux

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV PEACEAI_DATA_DIR=/app/data

VOLUME ["/app/data"]
EXPOSE 3000

USER node

CMD ["node", "src/server.js"]

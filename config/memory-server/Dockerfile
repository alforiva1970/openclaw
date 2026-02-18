FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY memory-server.js ./

# Identity dirs will be mounted as volumes
RUN mkdir -p /identity/silicea /identity/shared /app/data

ENV MEMORY_SERVER_PORT=3001
ENV MEMORY_DATA_DIR=/app/data
ENV SILICEA_IDENTITY_DIR=/identity/silicea
ENV SHARED_IDENTITY_DIR=/identity/shared

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s \
    CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "memory-server.js"]

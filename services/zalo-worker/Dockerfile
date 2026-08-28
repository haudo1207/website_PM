FROM node:20-alpine

WORKDIR /app

# artifacts/ holds the Zalo cookie/imei file and is mounted as a named
# volume — Docker creates named volumes owned by root on first use, but the
# app runs as non-root `node` below, so create+chown it here up front
# (avoids a PermissionError crash on the first /session/import call).
RUN mkdir -p /app/artifacts/zca-auth && chown -R node:node /app

COPY package.json ./

# npm install runs INSIDE this Linux container, never copied in from a
# Windows dev machine (an npm-install-on-Windows-then-COPY would leave stale
# native bindings / bad symlinks for a Linux container).
RUN npm install --omit=dev

COPY server.js ./

RUN chown -R node:node /app
USER node

EXPOSE 8090

CMD ["node", "server.js"]

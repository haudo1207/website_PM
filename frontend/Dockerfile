FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install --silent
COPY . .
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_PORTAL_BRAND=securityzone
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_PORTAL_BRAND=$NEXT_PUBLIC_PORTAL_BRAND
RUN npm run build
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone .
COPY --from=builder /app/.next/static ./.next/static
RUN addgroup -S app && adduser -S app -G app && chown -R app /app
USER app
EXPOSE 3000
CMD ["node","server.js"]

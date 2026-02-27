FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Build-time API URL for server-side rewrites (internal Docker network)
ARG NEXT_PUBLIC_API_URL=http://server:3456/api
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

# These are inlined into the client bundle by Next.js at build time.
# Pass via --build-arg or docker-compose args.
ARG NEXT_PUBLIC_API_KEY=
ENV NEXT_PUBLIC_API_KEY=$NEXT_PUBLIC_API_KEY

ARG NEXT_PUBLIC_ADMIN_PASSWORD=
ENV NEXT_PUBLIC_ADMIN_PASSWORD=$NEXT_PUBLIC_ADMIN_PASSWORD

RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000

CMD ["node", "server.js"]

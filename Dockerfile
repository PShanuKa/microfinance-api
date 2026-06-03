FROM node:20-alpine

# Install Chromium and its dependencies for Alpine Linux
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Install OpenSSL which is required by Prisma
RUN apk add --no-cache openssl tzdata

# Force UTC timezone for all internal date operations
ENV TZ=UTC

WORKDIR /app

# Copy dependency files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci

# Copy application files
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Expose the API port
EXPOSE 4000

# Start the Fastify server
CMD ["npm", "start"]

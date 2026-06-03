FROM node:20-alpine

RUN apt-get update && apt-get install -y \
    chromium \
    chromium-driver \
    libgbm-dev \
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libasound2 \
    --no-install-recommends

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

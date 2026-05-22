FROM node:20-alpine

# Install OpenSSL which is required by Prisma
RUN apk add --no-cache openssl

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

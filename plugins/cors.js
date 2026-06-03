import fp from 'fastify-plugin';
import cors from '@fastify/cors';

async function corsPlugin(fastify, options) {
  let allowedOrigins = true; // Default fallback to all

  if (process.env.NODE_ENV === "production" && process.env.CORS_ORIGIN) {
    allowedOrigins = process.env.CORS_ORIGIN.split(',').map(origin => origin.trim());
  }

  await fastify.register(cors, {
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
    exposedHeaders: ['Set-Cookie'],
    credentials: true, // Allow cookies
    preflightContinue: false,
    optionsSuccessStatus: 204
  });
}

export default fp(corsPlugin);

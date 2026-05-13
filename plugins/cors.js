import fp from 'fastify-plugin';
import cors from '@fastify/cors';

async function corsPlugin(fastify, options) {
  await fastify.register(cors, {
    origin: true, // Allow all origins in development
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
    exposedHeaders: ['Set-Cookie'],
    credentials: true, // Allow cookies
    preflightContinue: false,
    optionsSuccessStatus: 204
  });
}

export default fp(corsPlugin);

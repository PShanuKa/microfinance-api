import fp from 'fastify-plugin';
import fastifyJwt from '@fastify/jwt';
import { createForbiddenError, createUnauthorizedError } from '../utils/errors.js';

async function jwtPlugin(fastify, options) {
  await fastify.register(fastifyJwt, {
    secret: process.env.JWT_SECRET || "super-secret-key-change-me",
  });

  fastify.decorate("authenticate", async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      if (err.code === 'FST_JWT_AUTHORIZATION_TOKEN_EXPIRED') {
        const error = new Error('TOKEN_EXPIRED');
        error.statusCode = 401;
        throw error;
      }
      throw createUnauthorizedError();
    }
  });

  // Reusable role-based authorization middleware
  fastify.decorate("authorize", (allowedRoles) => {
    return async (request, reply) => {
      // 1. Ensure user is authenticated
      if (!request.user) {
        throw createUnauthorizedError();
      }

      // 2. Check if the user has any of the allowed roles
      const userRoles = request.user.roles || [];
      const hasAccess = userRoles.some(role => allowedRoles.includes(role));
      if (!hasAccess) {
        throw createForbiddenError("Forbidden: You do not have permission to access this resource");
      }
    };
  });
}

export default fp(jwtPlugin);

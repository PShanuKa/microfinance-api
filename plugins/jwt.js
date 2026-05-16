import fp from 'fastify-plugin';
import fastifyJwt from '@fastify/jwt';

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
      const error = new Error('Unauthorized');
      error.statusCode = 401;
      throw error;
    }
  });
}

export default fp(jwtPlugin);

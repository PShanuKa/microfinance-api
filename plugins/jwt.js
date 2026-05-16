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
      throw new Error('Unauthorized');
    }
  });
}

export default fp(jwtPlugin);

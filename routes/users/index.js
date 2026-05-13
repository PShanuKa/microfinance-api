// routes/users/index.js

export default async function userRoutes(fastify, opts) {
  fastify.get("/", async (request, reply) => {
    const users = await fastify.prisma.user.findMany({
      select: {
        id: true,
        fullname: true,
        email: true,
        role: true,
        status: true,
        branch: true,
        createdAt: true,
      },
    });
    return { success: true, users };
  });

  fastify.get("/me", async (request, reply) => {
    // This would use the authenticateToken middleware
    return { success: true, user: request.user };
  });
}

// 🌍 Force UTC timezone for all internal Date operations.
// Display formatting uses Asia/Colombo via dateHelpers.js.
process.env.TZ = 'UTC';

import { buildApp } from "./app.js";


const start = async () => {

  const fastify = await buildApp();

  // Graceful shutdown handling
  const gracefulShutdown = async (signal) => {
    console.log(`\n🛑 Received ${signal}. Graceful shutdown...`);
    try {
      await fastify.close();
      console.log("✅ Server closed gracefully");
      process.exit(0);
    } catch (err) {
      console.error("❌ Error during shutdown:", err);
      process.exit(1);
    }
  };

  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

  try {
    const port = parseInt(fastify.config.PORT || "3000");
    const host = fastify.config.HOST || "0.0.0.0";

    await fastify.listen({ port, host });

    console.log(`
🚀 Server started successfully!
📍 URL: http://${host}:${port}
🌍 Environment: ${process.env.NODE_ENV || "development"}
📊 Health: http://${host}:${port}/api/health
📚 Documentation: http://${host}:${port}/documentation
    `);
  } catch (err) {
    console.error("❌ Error starting server:", err);
    fastify.log.error(err);
    process.exit(1);
  }
};

start();

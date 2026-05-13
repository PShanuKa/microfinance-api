import fp from "fastify-plugin";

/**
 * Custom request logger plugin
 * Logs API requests in format: INFO: METHOD /path - STATUS - TIMEms
 */
async function requestLoggerPlugin(fastify, opts) {
  fastify.addHook("onRequest", async (request, reply) => {
    request.startTime = Date.now();
  });

  fastify.addHook("onResponse", async (request, reply) => {
    const responseTime = Date.now() - request.startTime;
    const method = request.method;
    const url = request.url;
    const statusCode = reply.statusCode;

    // Color codes for different status ranges
    const getStatusColor = (status) => {
      if (status >= 200 && status < 300) return "\x1b[32m"; // Green
      if (status >= 300 && status < 400) return "\x1b[36m"; // Cyan
      if (status >= 400 && status < 500) return "\x1b[33m"; // Yellow
      if (status >= 500) return "\x1b[31m"; // Red
      return "\x1b[0m"; // Reset
    };

    const reset = "\x1b[0m";
    const bold = "\x1b[1m";
    const statusColor = getStatusColor(statusCode);

    console.log(
      `${bold}INFO:${reset} ${method} ${url} - ${statusColor}${statusCode}${reset} - ${responseTime}ms`,
    );
  });
}

export default fp(requestLoggerPlugin, {
  name: "request-logger",
});

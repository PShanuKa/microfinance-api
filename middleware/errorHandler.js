export const globalErrorHandler = (fastify) => {
  fastify.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error, url: request.url }, "Global error handler");

    // Validation errors (from schema)
    if (error.validation) {
      return reply.code(400).send({
        success: false,
        error: "Validation error",
        details: error.validation,
        statusCode: 400,
      });
    }

    // Prisma errors
    if (error.code && error.code.startsWith("P")) {
      const prismaError = handlePrismaError(error);
      return reply.code(prismaError.statusCode).send({
        success: false,
        error: prismaError.message,
        statusCode: prismaError.statusCode,
      });
    }

    // JWT errors
    if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
      return reply.code(401).send({
        success: false,
        error: error.name === "TokenExpiredError" ? "Token expired" : "Invalid token",
        statusCode: 401,
      });
    }

    // Custom Unauthorized errors (401)
    if (error.name === "UnauthorizedError") {
      return reply.code(401).send({
        success: false,
        error: error.message || "Unauthorized",
        code: error.code, // Include error code (e.g., TOKEN_EXPIRED)
        statusCode: 401,
      });
    }

    // Custom Forbidden errors (403)
    if (error.name === "AppError" && error.statusCode === 403) {
      return reply.code(403).send({
        success: false,
        error: error.message || "Forbidden",
        statusCode: 403,
      });
    }

    // Default error
    const statusCode = error.statusCode || 500;
    return reply.code(statusCode).send({
      success: false,
      error: error.message || "Internal server error",
      message: process.env.NODE_ENV === "development" ? error.stack : undefined,
      statusCode,
    });
  });
};

export const notFoundHandler = (fastify) => {
  fastify.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      success: false,
      message: "Route not found",
      path: request.url,
      // method: request.method,
      statusCode: 404,
    });
  });
};

function handlePrismaError(error) {
  const errorMap = {
    P2002: {
      statusCode: 409,
      message: "A record with this unique field already exists",
    },
    P2025: {
      statusCode: 404,
      message: "Record not found",
    },
    P2003: {
      statusCode: 400,
      message: "Foreign key constraint failed",
    },
    P2014: {
      statusCode: 400,
      message: "Invalid relation data",
    },
    P2000: {
      statusCode: 400,
      message: "The provided value is too long for the field",
    },
    P2001: {
      statusCode: 404,
      message: "Record does not exist",
    },
  };

  return (
    errorMap[error.code] || {
      statusCode: 500,
      message: "Database error occurred",
    }
  );
}

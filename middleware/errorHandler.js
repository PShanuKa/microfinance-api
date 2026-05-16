// middleware/errorHandler.js

export const globalErrorHandler = (fastify) => {
  fastify.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error, url: request.url }, "Global error handler");

    // Validation errors (from Fastify schema)
    if (error.validation) {
      const formattedErrors = {};
      error.validation.forEach((err) => {
        // Map AJV/Fastify validation errors to field-level errors
        const field = err.instancePath.replace("/", "") || err.params?.missingProperty;
        if (field) {
          formattedErrors[field] = err.message;
        }
      });

      return reply.code(400).send({
        success: false,
        error: "Validation error",
        fields: formattedErrors, // Field-level errors for frontend
        statusCode: 400,
      });
    }

    // AppError (Custom errors)
    if (error.name === "AppError") {
      return reply.code(error.statusCode || 400).send({
        success: false,
        error: error.message,
        fields: error.fields, // Field-level errors for frontend
        statusCode: error.statusCode || 400,
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
  };

  return (
    errorMap[error.code] || {
      statusCode: 500,
      message: "Database error occurred",
    }
  );
}

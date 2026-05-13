// routes/auth/index.js
import bcrypt from "bcryptjs";
import { generateTokens } from "../../utils/tokens.js";
import { createBadRequestError, createUnauthorizedError } from "../../utils/errors.js";

export default async function authRoutes(fastify, opts) {
  // Register Route
  fastify.post("/create", {
    schema: {
      body: {
        type: "object",
        required: ["fullname", "email", "password", "role"],
        properties: {
          fullname: { type: "string", minLength: 3 },
          email: { type: "string", format: "email" },
          password: { type: "string", minLength: 6 },
          role: { 
            type: "string", 
            enum: ["ADMIN", "BRANCH_MANAGER", "LOAN_OFFICER", "COLLECTION_OFFICER", "APPROVER", "AUDITOR"] 
          },
          branch: { type: "array", items: { type: "string" } },
        },
        errorMessage: {
          required: {
            fullname: "Full name is required",
            email: "Email is required",
            password: "Password is required",
            role: "Role is required"
          },
          properties: {
            email: "Invalid email format",
            password: "Password must be at least 6 characters",
            fullname: "Full name must be at least 3 characters",
            role: "Invalid role selected"
          }
        }
      },
    },
    handler: async (request, reply) => {
      const { fullname, email, password, role, branch } = request.body;

      const existingUser = await fastify.prisma.user.findUnique({
        where: { email },
      });

      if (existingUser) {
        throw createBadRequestError("Email already in use");
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      const user = await fastify.prisma.user.create({
        data: {
          fullname,
          email,
          password: hashedPassword,
          role,
          branch: branch || [],
        },
      });

      const tokens = generateTokens(user);

      // Save refresh token
      await fastify.prisma.refreshToken.create({
        data: {
          token: tokens.refreshToken,
          userId: user.id,
        },
      });

      return {
        success: true,
        message: "Registration successful",
        user: {
          id: user.id,
          fullname: user.fullname,
          email: user.email,
          role: user.role,
        },
        ...tokens,
      };
    },
  });

  // Login Route
  fastify.post("/login", {
    schema: {
      body: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string", minLength: 6 },
        },
        errorMessage: {
          required: {
            email: "Email is required",
            password: "Password is required"
          },
          properties: {
            email: "Invalid email format",
            password: "Password must be at least 6 characters"
          }
        }
      },
    },
    handler: async (request, reply) => {
      const { email, password } = request.body;

      const user = await fastify.prisma.user.findUnique({
        where: { email },
      });

      if (!user || !user.status) {
        throw createUnauthorizedError("Invalid credentials or account deactivated");
      }

      const isPasswordValid = await bcrypt.compare(password, user.password);

      if (!isPasswordValid) {
        throw createUnauthorizedError("Invalid credentials");
      }

      const tokens = generateTokens(user);

      // Upsert refresh token
      await fastify.prisma.refreshToken.upsert({
        where: { token: tokens.refreshToken },
        update: { token: tokens.refreshToken },
        create: {
          token: tokens.refreshToken,
          userId: user.id,
        },
      });

      return {
        success: true,
        message: "Login successful",
        user: {
          id: user.id,
          fullname: user.fullname,
          email: user.email,
          role: user.role,
        },
        ...tokens,
      };
    },
  });

  // Refresh Token Route
  fastify.post("/refresh", async (request, reply) => {
    const { refreshToken } = request.body;

    if (!refreshToken) {
      throw createBadRequestError("Refresh token required");
    }

    const tokenRecord = await fastify.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });

    if (!tokenRecord) {
      throw createUnauthorizedError("Invalid refresh token");
    }

    const tokens = generateTokens(tokenRecord.user);

    await fastify.prisma.refreshToken.update({
      where: { id: tokenRecord.id },
      data: { token: tokens.refreshToken },
    });

    return {
      success: true,
      ...tokens,
    };
  });
}

export const envSchema = {
  type: "object",
  required: [
    "DB_USER",
    "DB_PASS",
    "DB_HOST",
    "DB_PORT",
    "DB_NAME",
    "JWT_SECRET",
    "JWT_REFRESH_SECRET",
  ],
  properties: {
    PORT: {
      type: "number",
      default: 3000,
    },
    HOST: {
      type: "string",
      default: "0.0.0.0",
    },
    NODE_ENV: {
      type: "string",
      enum: ["development", "production", "test"],
      default: "development",
    },
    DATABASE_URL: {
      type: "string",
    },
    DB_USER: { type: "string" },
    DB_PASS: { type: "string" },
    DB_HOST: { type: "string" },
    DB_PORT: { type: "string" },
    DB_NAME: { type: "string" },
    DB_POOL_MIN: {
      type: "number",
      default: 2,
    },
    DB_POOL_MAX: {
      type: "number",
      default: 10,
    },
    CORS_ORIGIN: {
      type: "string",
      default: "*",
    },
    RATE_LIMIT_MAX: {
      type: "number",
      default: 100,
    },
    RATE_LIMIT_TIME_WINDOW: {
      type: "string",
      default: "60000",
    },
    JWT_SECRET: {
      type: "string",
    },
    JWT_REFRESH_SECRET: {
      type: "string",
    },
    S3_ENDPOINT: {
      type: "string",
    },
    S3_REGION: {
      type: "string",
      default: "us-east-1",
    },
    S3_ACCESS_KEY: {
      type: "string",
    },
    S3_SECRET_KEY: {
      type: "string",
    },
    S3_BUCKET: {
      type: "string",
      default: "microfinance-uploads",
    },
    MAIL_HOST: {
      type: "string",
      default: "",
    },
    MAIL_PORT: {
      type: "number",
      default: 587,
    },
    MAIL_USERNAME: {
      type: "string",
      default: "",
    },
    MAIL_PASSWORD: {
      type: "string",
      default: "",
    },
  },
};

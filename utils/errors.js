export const createAppError = (message, statusCode = 500, fields = undefined) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.name = 'AppError';
  error.fields = fields;
  return error;
};

export const createUnauthorizedError = (message = 'Unauthorized') => {
  return createAppError(message, 401);
};

export const createForbiddenError = (message = 'Forbidden') => {
  return createAppError(message, 403);
};

export const createBadRequestError = (message = 'Bad Request', fields = undefined) => {
  return createAppError(message, 400, fields);
};

export const createNotFoundError = (message = 'Not Found') => {
  return createAppError(message, 404);
};

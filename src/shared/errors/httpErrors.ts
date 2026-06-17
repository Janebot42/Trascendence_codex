import { AppError } from './AppError.js';

export const badRequest = (message = 'Bad request', code = 'BAD_REQUEST') =>
  new AppError(message, 400, code);

export const unauthorized = (message = 'Authentication required', code = 'UNAUTHORIZED') =>
  new AppError(message, 401, code);

export const forbidden = (message = 'Forbidden', code = 'FORBIDDEN') =>
  new AppError(message, 403, code);

export const conflict = (message = 'Conflict', code = 'CONFLICT') =>
  new AppError(message, 409, code);

export const tooManyRequests = (message = 'Too many attempts', code = 'RATE_LIMITED') =>
  new AppError(message, 429, code);


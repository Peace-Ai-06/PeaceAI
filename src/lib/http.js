export class ApiError extends Error {
  constructor(status, message, code = 'error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function fail(status, message, code) {
  throw new ApiError(status, message, code);
}

export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export function required(value, label) {
  if (value === undefined || value === null || String(value).trim() === '') {
    fail(400, `${label} is required`, 'validation_error');
  }
  return String(value).trim();
}

export function optionalString(value, fallback = '') {
  return value === undefined || value === null ? fallback : String(value).trim();
}

export function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

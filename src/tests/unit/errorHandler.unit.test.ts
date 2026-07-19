/**
 * Strategy: unit tests for Express errorHandler middleware.
 * Verifies HTTP status codes and JSON bodies for each repository error type.
 */
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  ConflictError,
  FirestoreIndexError,
  NotFoundError,
  ValidationError,
} from '../../core/Errors.js';
import { errorHandler } from '../../express/index.js';

function createMockResponse() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as unknown as Response & {
    status: jest.Mock;
    json: jest.Mock;
  };
}

describe('errorHandler', () => {
  const req = {} as Request;
  const next = jest.fn() as NextFunction;

  it('should return 400 with validation issues for ValidationError', () => {
    const res = createMockResponse();
    const schema = z.object({ email: z.string().email() });
    const result = schema.safeParse({ email: 'bad' });
    if (result.success) throw new Error('expected validation failure');

    errorHandler(new ValidationError(result.error.issues), req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'ValidationError',
      details: result.error.issues,
    });
  });

  it('should return 404 for NotFoundError', () => {
    const res = createMockResponse();
    errorHandler(new NotFoundError('Document missing'), req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: 'NotFoundError',
      message: 'Document missing',
    });
  });

  it('should return 503 with index URL for FirestoreIndexError', () => {
    const res = createMockResponse();
    const err = new FirestoreIndexError('https://console.firebase.google.com/index', [
      'status',
      'createdAt',
    ]);

    errorHandler(err, req, res, next);

    // A missing index is a server/config failure — 5xx, not a client 404.
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Query needs an index',
      message: err.message,
      url: err.indexUrl,
    });
  });

  it('should return 409 for ConflictError', () => {
    const res = createMockResponse();
    errorHandler(new ConflictError('Email already exists'), req, res, next);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      error: 'ConflictError',
      message: 'Email already exists',
    });
  });

  it('should return 500 for unknown errors', () => {
    const res = createMockResponse();
    errorHandler(new Error('unexpected'), req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: 'InternalServerError',
      message: 'Something went wrong',
    });
  });
});

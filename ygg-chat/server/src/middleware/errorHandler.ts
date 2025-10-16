import { NextFunction, Request, Response } from 'express'
import { ZodError } from 'zod'
import { ErrorResponse } from '../../../shared/types'

export function errorHandler(err: Error, req: Request, res: Response<ErrorResponse>, next: NextFunction): void {
  console.error('Error:', err)

  if (err instanceof ZodError) {
    res.status(400).json({
      error: true,
      message: err.message || 'VALIDATION_ERROR', // wonder if its better to send error.errs whole as a detail prop
    })
    return
  }

  const statusCode = 'statusCode' in err && typeof err.statusCode === 'number' ? err.statusCode : 500

  res.status(statusCode).json({
    error: true,
    message: err.message || 'INTERNAL_ERROR',
  })
}

//asyncHandler accepts a function that returns a Promise.
// It catches any errors that occur in the function
// and passes them to the next middleware (error handler).

// export const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) => {
//   return (req: Request, res: Response, next: NextFunction) => {
//     Promise.resolve(fn(req, res, next)).catch(next)
//   }
// }
//whats the difference between this and the above?
import { NextFunction, Request, Response } from 'express'

type AsyncFunction = (req: Request, res: Response, next: NextFunction) => Promise<any>

export const asyncHandler = (fn: AsyncFunction) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res, next)).catch(next)
}

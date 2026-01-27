import 'express-serve-static-core'

declare module 'express-serve-static-core' {
  interface ParamsDictionary {
    [key: string]: string
  }
}

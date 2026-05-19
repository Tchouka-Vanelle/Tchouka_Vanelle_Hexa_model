import 'fastify'

declare module 'fastify' {
  interface FastifyInstance {
    ports?: any
  }
}

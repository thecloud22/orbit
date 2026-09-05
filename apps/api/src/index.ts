import { buildServer } from './server';

const port = Number(process.env.API_PORT ?? 3002);
const host = process.env.API_HOST ?? '127.0.0.1';

const app = buildServer();

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

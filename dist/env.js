import dotenv from 'dotenv';
import path from 'node:path';
import { z } from 'zod';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '..', '.env') });
const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.string().min(1),
    JWT_SECRET: z.string().min(16),
    APP_PUBLIC_URL: z.string().default('http://localhost:4000'),
    BUNNY_STREAM_LIBRARY_ID: z.coerce.number().int().positive(),
    BUNNY_STREAM_ACCESS_KEY: z.string().min(1),
    BUNNY_STREAM_READ_ONLY_KEY: z.string().min(1).optional(),
    BUNNY_STREAM_API_BASE: z.string().default('https://video.bunnycdn.com'),
    BUNNY_PLAYER_BASE_URL: z.string().default('https://player.mediadelivery.net/embed')
});
const parsedEnv = envSchema.parse(process.env);
export const env = {
    ...parsedEnv,
    BUNNY_STREAM_READ_ONLY_KEY: parsedEnv.BUNNY_STREAM_READ_ONLY_KEY ?? parsedEnv.BUNNY_STREAM_ACCESS_KEY
};
export const isProduction = env.NODE_ENV === 'production';

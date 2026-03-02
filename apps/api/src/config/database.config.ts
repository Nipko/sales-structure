import { registerAs } from '@nestjs/config';

export default registerAs('database', () => ({
    url: process.env.DATABASE_URL || 'postgresql://parallext:parallext_secret@localhost:5432/parallext_engine',
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '5432', 10),
    user: process.env.DATABASE_USER || 'parallext',
    password: process.env.DATABASE_PASSWORD || 'parallext_secret',
    name: process.env.DATABASE_NAME || 'parallext_engine',
}));

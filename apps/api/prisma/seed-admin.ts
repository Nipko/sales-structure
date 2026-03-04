/**
 * Seed Admin User
 * Run: npx ts-node prisma/seed-admin.ts
 * 
 * Creates the initial super_admin user for the Parallext platform.
 * Password is hashed with bcrypt (12 rounds).
 */

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@parallext.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'Parallext2026!';

    // Check if admin already exists
    const existing = await prisma.user.findUnique({
        where: { email: adminEmail },
    });

    if (existing) {
        console.log(`⚠️  Admin user already exists: ${adminEmail}`);
        console.log(`   Role: ${existing.role}`);
        console.log(`   Active: ${existing.isActive}`);
        return;
    }

    // Hash password with bcrypt (12 rounds)
    const hashedPassword = await bcrypt.hash(adminPassword, 12);

    // Create super_admin user
    const admin = await prisma.user.create({
        data: {
            email: adminEmail,
            password: hashedPassword,
            firstName: 'Admin',
            lastName: 'Parallext',
            role: 'super_admin',
            tenantId: null, // super_admin has access to all tenants
            isActive: true,
        },
    });

    console.log('');
    console.log('✅ Admin user created successfully!');
    console.log('');
    console.log('┌──────────────────────────────────────┐');
    console.log(`│  Email:    ${adminEmail.padEnd(25)}│`);
    console.log(`│  Password: ${adminPassword.padEnd(25)}│`);
    console.log(`│  Role:     super_admin               │`);
    console.log(`│  ID:       ${admin.id.substring(0, 25)}│`);
    console.log('└──────────────────────────────────────┘');
    console.log('');
    console.log('🔐 Usa estas credenciales para iniciar sesión en:');
    console.log('   https://admin.parallly-chat.cloud/login');
    console.log('');
    console.log('⚠️  IMPORTANTE: Cambia la contraseña después del primer login.');
}

main()
    .catch((e) => {
        console.error('❌ Error creating admin:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });

const fs = require('fs');

const template = fs.readFileSync('c:/Users/USER/Desktop/Sales_Structure/apps/api/prisma/tenant-schema.sql', 'utf8');
const statements = template
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('--'));

for (let i = 0; i < statements.length; i++) {
    const s = statements[i];
    // Check if a statement is incomplete or invalid
    if (s.split('\n').some(line => line.trim().startsWith('--') && !line.trim().includes('(') && !line.trim().includes(')'))) {
        // Wait, just print statements that don't start with CREATE
        if (!s.toUpperCase().startsWith('CREATE') && !s.toUpperCase().startsWith('ALTER')) {
            console.log(`\n\n[Suspicious statement #${i}]:\n${s}`);
        }
    }
}

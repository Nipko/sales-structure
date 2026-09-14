import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import * as ts from 'typescript';
import { isRuntimeSchemaDdl } from './runtime-schema-lock';

function unguardedRawDdl(source: string, file = 'probe.ts'): string[] {
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const failures: string[] = [];
    function visit(node: ts.Node) {
        if (ts.isCallExpression(node)) {
            let expression: ts.Expression = node.expression;
            while (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression)) expression = expression.expression;
            if (!/^(?:this\.(?:prisma\.)?|super\.)\$(?:query|execute)RawUnsafe$/.test(expression.getText(ast))) {
                ts.forEachChild(node, visit);
                return;
            }
            const argument = node.arguments[0];
            const prefix = argument && (ts.isTemplateExpression(argument) ? argument.head.text
                : ts.isStringLiteralLike(argument) ? argument.text : '');
            if (prefix && isRuntimeSchemaDdl(prefix)) {
                // Guarded statements must execute on tx, never on the root client,
                // even if a surrounding function also calls the lock helper.
                failures.push(`${file}:${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1}`);
            }
        }
        ts.forEachChild(node, visit);
    }
    visit(ast);
    return failures;
}

describe('runtime raw DDL boundary', () => {
    it('rejects a new unguarded caller, including a fake guard in a comment', () => {
        expect(unguardedRawDdl('class A { async run() { await (super.$executeRawUnsafe as any)(`CREATE TABLE public.probe(id int)`); } }')).toHaveLength(1);
        expect(unguardedRawDdl('class A { async run() { /* withRuntimeSchemaLock */ await this.prisma.$queryRawUnsafe(`CREATE TABLE IF NOT EXISTS public.probe(id int)`); } }')).toHaveLength(1);
        expect(unguardedRawDdl('class A { async run() { await withRuntimeSchemaLock(this.prisma, "public", async tx => { await this.prisma.$queryRawUnsafe(`CREATE TABLE public.probe(id int)`); }); } }')).toHaveLength(1);
        expect(unguardedRawDdl('class A { async run() { await withRuntimeSchemaLock(this.prisma, "public", async tx => { await tx.$queryRawUnsafe(`CREATE TABLE public.probe(id int)`); }); } }')).toHaveLength(0);
    });

    it('keeps literal runtime DDL off uncoordinated root clients', () => {
        const failures: string[] = [];
        function scan(directory: string) {
            for (const entry of readdirSync(directory, { withFileTypes: true })) {
                const file = join(directory, entry.name);
                if (entry.isDirectory() && entry.name !== '__fixtures__') scan(file);
                else if (entry.isFile() && file.endsWith('.ts') && !file.endsWith('.spec.ts')) {
                    failures.push(...unguardedRawDdl(readFileSync(file, 'utf8'), file));
                }
            }
        }
        scan(join(__dirname, '../../modules'));
        expect(failures).toEqual([]);
    });
});

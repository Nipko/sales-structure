import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';

const schedulerDecorators = new Set(['Cron', 'Interval', 'Timeout']);

function sourceFiles(root: string): string[] {
    return readdirSync(root).flatMap(entry => {
        const path = join(root, entry);
        return statSync(path).isDirectory()
            ? sourceFiles(path)
            : path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
    });
}

describe('scheduled handler contract', () => {
    it('does not advertise an empty scheduled operation', () => {
        const modulesRoot = join(__dirname, '..', '..', 'modules');
        const empty: string[] = [];

        for (const file of sourceFiles(modulesRoot)) {
            const text = readFileSync(file, 'utf8');
            const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
            const visit = (node: ts.Node) => {
                if (ts.isMethodDeclaration(node) && node.body?.statements.length === 0) {
                    const decorators = ts.canHaveDecorators(node) ? ts.getDecorators(node) || [] : [];
                    const scheduled = decorators.some(decorator => {
                        const expression = decorator.expression;
                        const name = ts.isCallExpression(expression) ? expression.expression : expression;
                        return ts.isIdentifier(name) && schedulerDecorators.has(name.text);
                    });
                    if (scheduled) {
                        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
                        empty.push(`${file}:${line}:${node.name.getText(source)}`);
                    }
                }
                ts.forEachChild(node, visit);
            };
            visit(source);
        }

        expect(empty).toEqual([]);
    });
});

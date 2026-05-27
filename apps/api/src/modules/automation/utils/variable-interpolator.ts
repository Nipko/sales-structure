export function interpolate(template: any, context: Record<string, any>): any {
    if (typeof template === 'string') {
        return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
            const value = resolvePath(context, path.trim());
            return value !== undefined ? String(value) : match;
        });
    }
    if (Array.isArray(template)) {
        return template.map(item => interpolate(item, context));
    }
    if (template && typeof template === 'object') {
        const result: Record<string, any> = {};
        for (const [key, value] of Object.entries(template)) {
            result[key] = interpolate(value, context);
        }
        return result;
    }
    return template;
}

export function resolvePath(obj: any, path: string): any {
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
        if (current == null) return undefined;
        const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/);
        if (arrayMatch) {
            current = current[arrayMatch[1]];
            if (Array.isArray(current)) {
                current = current[parseInt(arrayMatch[2])];
            } else {
                return undefined;
            }
        } else {
            current = current[part];
        }
    }
    return current;
}

import { resolvePath } from './variable-interpolator';

export function extractFromResponse(body: any, mapping: any): Record<string, any> {
    const result: Record<string, any> = {};
    if (!mapping || typeof mapping !== 'object') return result;

    if (Array.isArray(mapping)) {
        for (const item of mapping) {
            if (item && typeof item === 'object' && item.variable) {
                const rawPath = item.jsonPath || item.json_path || '';
                const cleanPath = rawPath.startsWith('$.') ? rawPath.substring(2) : rawPath;
                result[item.variable] = resolvePath(body, cleanPath);
            }
        }
    } else {
        for (const [key, path] of Object.entries(mapping)) {
            if (typeof path === 'string') {
                const cleanPath = path.startsWith('$.') ? path.substring(2) : path;
                result[key] = resolvePath(body, cleanPath);
            }
        }
    }
    return result;
}

import { resolvePath } from './variable-interpolator';

export function extractFromResponse(body: any, mapping: Record<string, string>): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [key, path] of Object.entries(mapping)) {
        const cleanPath = path.startsWith('$.') ? path.substring(2) : path;
        result[key] = resolvePath(body, cleanPath);
    }
    return result;
}

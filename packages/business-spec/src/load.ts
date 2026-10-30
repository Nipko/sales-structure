/**
 * Lectura de los YAML desde disco (Node). Es la única pieza con E/S del paquete; el resto es puro.
 * No se exporta desde el índice del núcleo: `import { loadSpec } from '@parallext/business-spec/src/load'`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import { compile, compileOrThrow, type CompileOptions, type SpecDocs } from './compile';
import type { CompiledSpec } from './types';

export const SPEC_DIR = path.resolve(__dirname, '..', 'spec');

export function readSpecDocs(dir: string = SPEC_DIR): SpecDocs {
    const read = (f: string) => yaml.load(fs.readFileSync(path.join(dir, f), 'utf8')) as any;
    return {
        core: read('core.yaml'),
        objects: read('objects.yaml'),
        profiles: read('profiles.yaml'),
        intents: read('intents.yaml'),
        schema: JSON.parse(fs.readFileSync(path.join(dir, 'requirement.schema.json'), 'utf8')),
    };
}

let cached: CompiledSpec | null = null;
/** La especificación del repo, compilada una vez por proceso (falla si tiene defectos). */
export function loadSpec(dir?: string, options?: CompileOptions): CompiledSpec {
    if (!dir && !options && cached) return cached;
    const spec = compileOrThrow(readSpecDocs(dir), options);
    if (!dir && !options) cached = spec;
    return spec;
}

export { compile };

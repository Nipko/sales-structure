import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '../../..');

describe('single agent configuration authority', () => {
    it('mounts Persona and does not expose the retired Carla runtime', () => {
        const appModule = readFileSync(resolve(ROOT, 'src/app.module.ts'), 'utf8');

        expect(appModule).toContain('PersonaModule');
        expect(appModule).toContain('ConversationsModule');
        expect(appModule).not.toContain('CarlaModule');
        expect(existsSync(resolve(ROOT, 'src/modules/carla/carla.module.ts'))).toBe(false);
        expect(existsSync(resolve(ROOT, 'src/modules/carla/carla.controller.ts'))).toBe(false);
    });

    it('keeps historical Carla storage out of the application authority', () => {
        const sourceRoot = resolve(ROOT, 'src');
        const appModule = readFileSync(resolve(sourceRoot, 'app.module.ts'), 'utf8');

        expect(appModule).not.toMatch(/modules\/carla|Controller\(['"]carla['"]\)/);
    });
});

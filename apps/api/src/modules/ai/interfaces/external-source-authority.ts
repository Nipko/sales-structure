import type { LLMResponse } from './illm-provider.interface';

/** Server-owned authority for one external attempt, including non-text model outputs.
 * Request bodies never carry this function. Usage is projected separately so a
 * rejected response need not retain its text or vectors.
 */
export type ExternalSourceAuthority = <T>(invoke:()=>Promise<T>,usage?:(result:T)=>LLMResponse['usage'])=>Promise<T>;

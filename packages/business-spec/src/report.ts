/** Informe de preparación en Markdown (la CLI imprime además el JSON del ReadinessResult). */
import type { ReadinessResult } from './types';

const VERDICT: Record<string, string> = { no_listo: '**No listo**', limitado: '**Listo en modo limitado**', listo: '**Listo**' };
const esc = (s: unknown) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function renderTenantMarkdown(r: ReadinessResult): string {
    const lines: string[] = [];
    const objs = r.config.objects.map(o => `${o.object}${o.variant ? `(${o.variant})` : ''} · ${o.writeMode}${o.writeModeDeclared ? '' : ' (por defecto)'}`).join('; ');
    lines.push(`## ${esc(r.tenant.name ?? r.tenant.ref)} · ${r.config.profileId ?? 'sin perfil'} · ${VERDICT[r.verdict]}`, '');
    lines.push(`- Subtipo: \`${r.config.subtype ?? '—'}\` · objetos: ${objs || '—'} · dominios: ${r.config.domains.join(', ') || '—'}`);
    lines.push(`- Aplicables ${r.counts.applicable} · bloqueantes ${r.counts.blocking} (fallan **${r.counts.blockingFailing}**) · necesarios ${r.counts.necessary} (fallan ${r.counts.necessaryFailing}) · recomendados ${r.counts.recommended} (cobertura R5 ${r.coverage.r5Pct} %)`);
    lines.push(`- snapshotHash \`${r.snapshotHash.slice(0, 16)}…\` · resultHash \`${r.resultHash.slice(0, 16)}…\` · a la fecha ${r.asOf}`, '');
    const byId = new Map(r.requirements.map(x => [x.id, x]));
    if (r.blockingGaps.length) {
        lines.push('### Bloqueantes que fallan', '', '| # | Requisito | Causa | Qué ve el dueño | Dónde | Arrastra |', '|---|---|---|---|---|---|');
        r.blockingGaps.forEach((id, i) => {
            const g = byId.get(id)?.gap;
            const where = g?.rootCause ? `→ ver ${g.rootCause}` : (g?.uiTarget ?? 'pantalla nueva');
            lines.push(`| ${i + 1} | ${id} | ${g?.cause ?? ''} | ${esc(g?.message)} | ${esc(where)} | ${(g?.rootOf ?? []).join(', ')} |`);
        });
        lines.push('');
    }
    const necessary = r.requirements.filter(x => x.applies && x.gap && ((x.level === 'necesario' && !r.blockingGaps.includes(x.id)) || x.levelResults?.necesario === 'no_cumple') && !x.derived && x.gap.cause !== 'plataforma');
    if (necessary.length) {
        lines.push(`### Necesarios (R4) que fallan: ${necessary.length}`, '', necessary.map(x => `\`${x.id}\` (${x.gap?.cause})`).join(' · '), '');
    }
    if (r.platformGaps.length) lines.push('### Huecos de plataforma (no bajan el estado del tenant)', '', ...r.platformGaps.map(p => `- ${p.id}: ${esc(p.message)}`), '');
    const derived = r.requirements.filter(x => x.applies && x.derived && x.result !== 'cumple');
    if (derived.length) lines.push(`Derivados que no cumplen (sin hueco propio): ${derived.map(x => `\`${x.id}\``).join(', ')}.`, '');
    if (r.limitedIntents.length) lines.push(`Intenciones que quedarían en «no consta» si se publicara en modo limitado: ${r.limitedIntents.length} (${r.limitedIntents.slice(0, 12).map(i => i.id).join(', ')}${r.limitedIntents.length > 12 ? '…' : ''}).`, '');
    if (r.qualityWarnings.length) lines.push(`Avisos de calidad: ${r.qualityWarnings.length} (${[...new Set(r.qualityWarnings.map(w => w.message))].slice(0, 3).map(esc).join('; ')}).`, '');
    return lines.join('\n');
}

export function renderSummaryMarkdown(results: ReadinessResult[]): string {
    const lines = ['| Tenant | Perfil | Objetos | Aplicables | Bloqueantes (fallan) | Necesarios (fallan) | R5 % | Veredicto |', '|---|---|---|---:|---:|---:|---:|---|'];
    for (const r of results) {
        lines.push(`| ${esc(r.tenant.name ?? r.tenant.ref)} | ${r.config.profileId ?? '—'} | ${r.config.objects.map(o => o.object).join(', ')} | ${r.counts.applicable} | ${r.counts.blocking} (${r.counts.blockingFailing}) | ${r.counts.necessary} (${r.counts.necessaryFailing}) | ${r.coverage.r5Pct} | ${VERDICT[r.verdict]} |`);
    }
    return lines.join('\n');
}

export function renderReportMarkdown(results: ReadinessResult[], header = ''): string {
    return [header, renderSummaryMarkdown(results), '', ...results.map(renderTenantMarkdown)].filter(s => s !== '').join('\n\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

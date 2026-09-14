import type { AgentQualityOverview } from '@parallext/shared';

export function agentReadinessBlockers(overview: AgentQualityOverview) {
  const checks = overview.preparation.dimensions.flatMap(dimension => dimension.checks);
  return overview.preparation.criticalBlockers.map(rawCode => {
    const code = rawCode.replace(/^fix_/, '');
    const check = checks.find(check => check.code === code);
    return { code, check, unavailable: !check || check.status === 'unknown' };
  });
}

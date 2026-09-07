import { buildDomainContractDraft, composeSubtypeEvalPack, CONVERSATIONAL_CHANNELS, EVAL_LANGUAGES,
    listCanonicalSubtypeExperienceProfileIds, listSubtypeExperienceProfileIds, resolveSubtypeExperienceProfile,
    VERTICAL_DOMAIN_CONTRACT_VERSION } from '@parallext/shared';
import { TOOL_POLICY_REGISTRY } from '../conversations/tool-policy-registry';
import { CORE_PREREQUISITES } from '../conversations/tool-task-dependencies';
import { EVAL_WRITER_SANDBOX_FAMILIES } from '../conversations/agent-test-tool-policy';

/** Declared coverage, deliberately separate from a tenant's execution results or certification. */
export function buildTaskCompetenceMatrix(profileId?: string) {
    const ids = listCanonicalSubtypeExperienceProfileIds().sort();
    if (profileId && !ids.includes(profileId)) throw new Error('canonical_profile_required');
    const profiles = (profileId ? [profileId] : ids).map(id => {
        const [industry, subtype] = id.split('/');
        const profile = resolveSubtypeExperienceProfile(industry, subtype);
        const domain = buildDomainContractDraft(industry, subtype);
        const packs = EVAL_LANGUAGES.map(language => ({ language, scenarios: composeSubtypeEvalPack({ industry, subtype, language }) }));
        return {
            profileId: id, profileVersion: profile.version, manifestVersion: profile.manifestVersion,
            availability: profile.availability, scope: profile.scope,
            capabilities: profile.capability.capabilities,
            requiredConfiguration: profile.capability.readiness.requirements,
            unresolvedContract: domain.unresolved,
            // A shared tool, a passing generic probe or a selectable profile is not profile-specific evidence.
            certification: { certified: false, evidence: 'not_loaded' as const },
            tasks: domain.intents.map(intent => {
                const tools = [...new Set([...intent.toolPlan, ...intent.toolPlan.flatMap(name => CORE_PREREQUISITES[name] || [])])].map(name => {
                    const policy = TOOL_POLICY_REGISTRY[name];
                    const familyEntry = Object.entries(EVAL_WRITER_SANDBOX_FAMILIES).find(([, family]) => family.tools.includes(name));
                    const family = familyEntry?.[1];
                    return { name, registered: !!policy, prerequisite: !intent.toolPlan.includes(name),
                        effect: policy?.effect ?? 'unknown', commitsBusiness: policy?.commitsBusiness ?? false,
                        ownership: policy?.ownership ?? 'unknown',
                        assurance: policy?.assurance ?? 'unknown', confirmation: policy?.confirmation ?? 'unknown',
                        idempotency: policy?.idempotency ?? 'unknown', externalEffect: policy?.externalEffect ?? 'unknown',
                        previewExecutable: policy?.agentTestAllowed === true,
                        effectVerifier: family?.contactColumn && (family.status === 'audited' || family.verifierAudited)
                            ? { family: familyEntry![0], table: family.table, ownershipColumn: family.contactColumn } : null,
                    };
                });
                const scenarios = packs.map(pack => {
                    const matching = pack.scenarios.filter(scenario => scenario.key.startsWith(`intent_${intent.key}_`));
                    const positive = matching.filter(scenario => scenario.expectedActions?.some(action => action.kind === 'db_effect' &&
                        (action.type === 'row_exists' || (action.type === 'row_count' && (action.count ?? 1) > 0))));
                    const negative = matching.filter(scenario => scenario.expectedActions?.some(action =>
                        action.kind === 'tool_call' ? action.type === 'not_called' : action.type === 'no_row'));
                    return { language: pack.language, cases: matching.map(scenario => scenario.storageKey || scenario.key),
                        positiveAssertions: positive.length, negativeAssertions: negative.length };
                });
                const gaps: string[] = [];
                if (tools.some(tool => !tool.registered)) gaps.push('tool_not_registered');
                if (intent.commits && tools.filter(tool => tool.effect === 'write' || tool.commitsBusiness).some(tool => !tool.effectVerifier)) gaps.push('effect_verifier_missing');
                if (intent.commits && scenarios.some(scenario => !scenario.positiveAssertions)) gaps.push('positive_task_case_missing');
                gaps.push('profile_execution_evidence_missing');
                return { key: intent.key, description: intent.description, commits: intent.commits,
                    confirmation: intent.confirmation, fallback: intent.fallback, states: intent.states,
                    requiredSlots: intent.slots.filter(slot => slot.required).map(slot => ({ key: slot.key, type: slot.type,
                        source: slot.source, sensitivity: slot.sensitivity, persistence: slot.persistence })),
                    tools, scenarios, gaps,
                    channelEvidence: CONVERSATIONAL_CHANNELS.map(channel => ({ channel,
                        languages: EVAL_LANGUAGES.map(language => ({ language, result: 'not_run' as const })) })),
                };
            }),
        };
    });
    const tasks = profiles.flatMap(profile => profile.tasks);
    const compatibilityProfiles = listSubtypeExperienceProfileIds().filter(id => !ids.includes(id)).sort().map(id => {
        const [industry, subtype] = id.split('/');
        return { profileId: id, resolvedProfileId: resolveSubtypeExperienceProfile(industry, subtype).id,
            evidence: 'not_inherited' as const };
    });
    return { version: 1, domainContractVersion: VERTICAL_DOMAIN_CONTRACT_VERSION, evidenceKind: 'declared_coverage' as const,
        summary: { profiles: profiles.length, tasks: tasks.length, committingTasks: tasks.filter(task => task.commits).length,
            tasksMissingPositiveCases: tasks.filter(task => task.gaps.includes('positive_task_case_missing')).length,
            tasksMissingVerifiers: tasks.filter(task => task.gaps.includes('effect_verifier_missing')).length,
            unregisteredTools: [...new Set(tasks.flatMap(task => task.tools.filter(tool => !tool.registered).map(tool => tool.name)))].sort(),
            certifiedProfiles: 0 }, profiles, compatibilityProfiles };
}

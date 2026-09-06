/** Pure dependency discovery for SuperAgents-driven continuous prompts. */

function collectConditionSources(condition, sources) {
    if (!condition || typeof condition !== 'object') return;
    if (condition.type === 'provider-state'
        && condition.providerId === 'superagents'
        && String(condition.source || '').trim()) {
        sources.add(String(condition.source).trim());
    }
    for (const child of condition.conditions || []) {
        collectConditionSources(child, sources);
    }
}

function collectSubjectSource(subject, sources) {
    if (subject?.mode !== 'state-source'
        || subject.providerId !== 'superagents'
        || !String(subject.source || '').trim()) return;
    sources.add(String(subject.source).trim());
}

/** Return the validated SuperAgents variables consumed by active continuous components. */
export function collectSuperAgentsContinuousSources(eventSets = []) {
    const sources = new Set();
    for (const set of eventSets) {
        for (const track of set.stateTracks || []) {
            if (!track.enabled) continue;
            collectSubjectSource(track.subject, sources);
            for (const state of track.states || []) {
                if (state.enabled === false) continue;
                collectConditionSources(state.condition, sources);
                collectConditionSources(state.exitCondition, sources);
            }
        }
        for (const router of set.promptRouters || []) {
            if (!router.enabled) continue;
            collectSubjectSource(router.subject, sources);
            for (const layer of router.layers || []) {
                if (layer.enabled === false) continue;
                collectConditionSources(layer.condition, sources);
            }
        }
    }
    return sources;
}

/** Unknown legacy events stay refresh-worthy; known unrelated variables do not. */
export function stateCommitAffectsSources(event, sources) {
    if (!(sources instanceof Set) || sources.size === 0) return false;
    const variableName = String(event?.detail?.variableName || '').trim();
    return !variableName || sources.has(variableName);
}

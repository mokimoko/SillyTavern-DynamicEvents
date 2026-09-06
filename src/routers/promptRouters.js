import {
    InjectionMode,
    PromptPosition,
    PromptRole,
    createCondition,
    evaluateCondition,
    evaluateConditionDetailed,
    generateId,
    isSetActive,
} from '../../eventEngine.js';
import { createSubject, renderSubjectText, resolveSubject } from '../subjects/subjects.js';

export const PromptRouterMode = Object.freeze({
    STACK: 'stack',
    EXCLUSIVE: 'exclusive',
});

export const PROMPT_OUTLET_PREFIX = 'de_';

/** Normalize the user-entered suffix used by a named Prompt Router macro. */
export function sanitizePromptOutletName(value) {
    return String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/^de_+/, '')
        .replace(/[\s-]+/g, '_')
        .replace(/[^a-z0-9_]/g, '')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 48);
}

export function promptOutletMacroName(value) {
    const suffix = sanitizePromptOutletName(value);
    return suffix ? `${PROMPT_OUTLET_PREFIX}${suffix}` : '';
}

export function createPromptLayer(overrides = {}) {
    return {
        id: generateId('layer'),
        name: 'New Prompt Layer',
        enabled: true,
        priority: 0,
        text: '',
        condition: createCondition(),
        ...overrides,
    };
}
export function createPromptRouter(overrides = {}) {
    return {
        id: generateId('router'),
        name: 'New Prompt Router',
        enabled: true,
        mode: PromptRouterMode.STACK,
        subject: createSubject(),
        layers: [],
        injection: {
            mode: InjectionMode.EXTENSION_PROMPT,
            position: PromptPosition.IN_CHAT,
            depth: 1,
            role: PromptRole.SYSTEM,
            macroName: '',
        },
        ...overrides,
    };
}

function sortedMatches(router, chatState, context) {
    const enabled = (router.layers || []).filter(layer => layer.enabled !== false);
    return enabled
        .map((layer, index) => ({
            layer,
            index,
            detail: evaluateConditionDetailed(layer.condition, chatState, context),
        }))
        .filter(({ detail }) => detail.result)
        .sort((a, b) => Number(b.layer.priority || 0) - Number(a.layer.priority || 0)
            || a.index - b.index);
}

function firstProviderValue(detail) {
    if (!detail) return undefined;
    if (detail.type === 'provider-state') return detail.actual;
    for (const child of (detail.children || [])) {
        const value = firstProviderValue(child);
        if (value !== undefined) return value;
    }
    return undefined;
}

function formatConditionValue(value) {
    if (value === undefined || value === null) return '';
    if (Array.isArray(value)) return value.map(entry => String(entry)).join(', ');
    if (typeof value === 'object') {
        try { return JSON.stringify(value); } catch { return ''; }
    }
    return String(value);
}

function renderLayerText(match, subject, context) {
    const value = formatConditionValue(firstProviderValue(match.detail));
    return renderSubjectText(match.layer.text, subject, context)
        .replace(/\{\{conditionValue\}\}/g, () => value);
}

/** Evaluate continuous conditional prompt fragments without mutating runtime state. */
export function evaluatePromptRouters(eventSets, chatState, bindingContext, evaluationContext = {}) {
    const active = [];
    const texts = new Map();

    for (const set of eventSets || []) {
        if (!isSetActive(set, bindingContext)) continue;
        for (const router of (set.promptRouters || [])) {
            if (!router.enabled) continue;
            const context = {
                ...bindingContext,
                ...evaluationContext,
                subject: router.subject,
            };
            const matches = sortedMatches(router, chatState, context);
            const selected = router.mode === PromptRouterMode.EXCLUSIVE
                ? matches.slice(0, 1)
                : matches;
            const subject = resolveSubject(router.subject, context);
            const rendered = selected
                .map(match => renderLayerText(match, subject, context).trim())
                .filter(Boolean);

            if (rendered.length) {
                texts.set(router.id, {
                    text: rendered.join('\n'),
                    injection: router.injection,
                    setId: set.id,
                    layerIds: selected.map(({ layer }) => layer.id),
                });
            }
            active.push({
                set,
                router,
                layers: selected.map(({ layer }) => layer),
                subject,
            });
        }
    }

    return { active, texts };
}

export function inspectPromptRouter(router, chatState, bindingContext, evaluationContext = {}) {
    const clonedRouter = structuredClone(router);
    const clonedState = structuredClone(chatState);
    const context = {
        ...bindingContext,
        ...evaluationContext,
        subject: clonedRouter.subject,
    };
    const conditionResults = {};
    const conditionDetails = {};
    for (const layer of (clonedRouter.layers || [])) {
        conditionResults[layer.id] = evaluateCondition(layer.condition, clonedState, context);
        conditionDetails[layer.id] = evaluateConditionDetailed(layer.condition, clonedState, context);
    }
    const result = evaluatePromptRouters([{
        id: 'inspection-set',
        name: 'Inspection',
        enabled: true,
        bindMode: 'manual',
        events: [],
        scripts: [],
        stateTracks: [],
        promptRouters: [clonedRouter],
    }], clonedState, bindingContext, evaluationContext);
    return {
        activeLayerIds: result.active[0]?.layers?.map(layer => layer.id) || [],
        subject: result.active[0]?.subject || resolveSubject(clonedRouter.subject, context),
        conditionResults,
        conditionDetails,
    };
}

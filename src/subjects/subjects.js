export const SubjectMode = Object.freeze({
    ACTIVE_CARD: 'active-card',
    TRACKED: 'tracked',
    MANUAL: 'manual',
    STATE_SOURCE: 'state-source',
});

export function createSubject(overrides = {}) {
    return {
        mode: SubjectMode.ACTIVE_CARD,
        value: '',
        providerId: 'superagents',
        source: '',
        collectionPath: '',
        subjectPath: '',
        counterpartPath: '',
        selection: 'least-recent',
        ...(overrides && typeof overrides === 'object' ? overrides : {}),
    };
}

export function resolveSubject(subject, context = {}) {
    const binding = subject && typeof subject === 'object'
        ? subject
        : context.subject && typeof context.subject === 'object'
            ? context.subject
            : createSubject();
    if (binding.mode === SubjectMode.ACTIVE_CARD) return String(context.charName || '').trim();
    if (binding.mode === SubjectMode.TRACKED || binding.mode === SubjectMode.MANUAL) {
        return String(binding.value || '').trim();
    }
    if (binding.mode === SubjectMode.STATE_SOURCE) {
        return String(context.resolvedSubject || context.charName || '').trim();
    }
    return String(binding.value || context.charName || '').trim();
}

export function renderSubjectText(text, subject, context = {}) {
    const resolved = typeof subject === 'string' ? subject : resolveSubject(subject, context);
    const counterpart = String(context.resolvedCounterpart || context.counterpart || '').trim();
    const state = context.resolvedSubjectState || context.subjectState;
    return String(text || '')
        .replace(/\{\{subject\}\}/g, () => resolved)
        .replace(/\{\{counterpart\}\}/g, () => counterpart)
        .replace(/\{\{subjectState\.([^{}]+)\}\}/g, (_match, path) => formatStateValue(readStatePath(state, path)));
}

const BLOCKED_PATH_PARTS = new Set(['__proto__', 'prototype', 'constructor']);

function readStatePath(value, path) {
    let current = value;
    for (const part of String(path || '').split('.').filter(Boolean)) {
        if (BLOCKED_PATH_PARTS.has(part) || current === null || current === undefined) return undefined;
        current = current[part];
    }
    return current;
}

function formatStateValue(value) {
    if (value === undefined || value === null) return '';
    if (Array.isArray(value)) return value.map(item => String(item)).join(', ');
    if (typeof value === 'object') {
        try { return JSON.stringify(value); } catch { return ''; }
    }
    return String(value);
}

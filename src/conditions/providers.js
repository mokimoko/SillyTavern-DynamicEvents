/** Extensible synchronous condition-provider registry. */

import { SubjectMode, resolveSubject } from '../subjects/subjects.js';

export { SubjectMode };

const providers = new Map();
const BLOCKED_PATH_PARTS = new Set(['__proto__', 'prototype', 'constructor']);

export const ProviderOperator = Object.freeze({
    EXISTS: 'exists',
    EQ: 'eq',
    NEQ: 'neq',
    GT: 'gt',
    GTE: 'gte',
    LT: 'lt',
    LTE: 'lte',
    CONTAINS: 'contains',
});

export function registerConditionProvider(provider) {
    if (!provider?.id || typeof provider.read !== 'function') {
        throw new TypeError('Condition providers require an id and read() function.');
    }
    providers.set(provider.id, Object.freeze({ ...provider }));
}

export function listConditionProviders() {
    return [...providers.values()].map(provider => ({
        id: provider.id,
        label: (typeof provider.label === 'function' ? provider.label() : provider.label) || provider.id,
        available: provider.available?.() ?? true,
    }));
}

export function listConditionSources(providerId) {
    const provider = providers.get(providerId);
    if (!provider || provider.available?.() === false) return [];
    try {
        return provider.listSources?.() ?? [];
    } catch {
        return [];
    }
}

export function describeConditionSource(providerId, source, context = {}) {
    const provider = providers.get(providerId);
    if (!provider || provider.available?.() === false) return null;
    try {
        return provider.describeSource?.(source, context) ?? null;
    } catch {
        return null;
    }
}

export function listConditionSubjects(providerId, source, collectionPath = '', context = {}) {
    const description = describeConditionSource(providerId, source, context);
    const collections = description?.collections || [];
    const selected = collectionPath
        ? collections.filter(collection => collection.path === collectionPath)
        : collections;
    return [...new Set(selected.flatMap(collection => collection.subjects || [])
        .map(subject => String(subject || '').trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b));
}

export function listConditionSubjectEntries(providerId, source, collectionPath = '', context = {}) {
    const provider = providers.get(providerId);
    if (!provider || provider.available?.() === false) return [];
    try {
        const result = provider.read(source, context);
        if (!result?.found) return [];
        const collection = readPath(result.value, collectionPath);
        if (!collection || typeof collection !== 'object' || Array.isArray(collection)) return [];
        return Object.entries(collection)
            .filter(([, entry]) => entry?.attention !== 'dormant')
            .map(([key, value]) => ({ key, value }));
    } catch {
        return [];
    }
}

function resolveSubjectKey(subject, context = {}) {
    const binding = subject || context.subject;
    if (binding?.mode === SubjectMode.STATE_SOURCE && context.resolvedSubjectKey) {
        return String(context.resolvedSubjectKey).trim();
    }
    return resolveSubject(subject || context.subject, context);
}

function readPath(value, path, subjectKey = '') {
    if (!path) return value;
    const parts = String(path).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
    let current = value;
    for (const rawPart of parts) {
        const part = rawPart === '$subject' ? subjectKey : rawPart;
        if (!part) return undefined;
        if (BLOCKED_PATH_PARTS.has(part) || current === null || current === undefined) return undefined;
        current = current[part];
    }
    return current;
}

function parseExpected(value) {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (!trimmed) return '';
    try {
        return JSON.parse(trimmed);
    } catch {
        return value;
    }
}

function compare(actual, operator, expected) {
    switch (operator) {
        case ProviderOperator.EXISTS: return actual !== undefined && actual !== null;
        case ProviderOperator.EQ: return actual === expected;
        case ProviderOperator.NEQ: return actual !== expected;
        case ProviderOperator.GT: return Number(actual) > Number(expected);
        case ProviderOperator.GTE: return Number(actual) >= Number(expected);
        case ProviderOperator.LT: return Number(actual) < Number(expected);
        case ProviderOperator.LTE: return Number(actual) <= Number(expected);
        case ProviderOperator.CONTAINS:
            return Array.isArray(actual)
                ? actual.includes(expected)
                : String(actual ?? '').includes(String(expected));
        default: return false;
    }
}

export function evaluateProviderCondition(condition, context = {}) {
    return inspectProviderCondition(condition, context).result;
}

export function inspectProviderCondition(condition, context = {}) {
    const provider = providers.get(condition?.providerId);
    if (!provider || provider.available?.() === false) {
        return { result: false, found: false, actual: undefined, expected: undefined, subject: '' };
    }
    try {
        const result = provider.read(condition.source, context);
        if (!result?.found) {
            return { result: false, found: false, actual: undefined, expected: parseExpected(condition.value), subject: '' };
        }
        const subjectKey = resolveSubjectKey(condition.subject, context);
        const actual = readPath(result.value, condition.path, subjectKey);
        const expected = parseExpected(condition.value);
        return {
            result: compare(actual, condition.operator || ProviderOperator.EXISTS, expected),
            found: actual !== undefined,
            actual,
            expected,
            subject: subjectKey,
            path: condition.path,
        };
    } catch {
        return { result: false, found: false, actual: undefined, expected: undefined, subject: '' };
    }
}

registerConditionProvider({
    id: 'superagents',
    label: 'SuperAgents validated state',
    available: () => Boolean(globalThis.SuperAgents?.integration?.apiVersion >= 1),
    listSources: () => {
        const api = globalThis.SuperAgents?.integration;
        if (!api) return [];
        return (api.listStateSources?.() || [])
            .filter(source => source.validated && source.enabled !== false)
            .map(source => ({
                id: source.variableName,
                label: source.agentName || source.variableName,
                schemaVersion: source.schemaVersion ?? null,
            }));
    },
    describeSource: (source, context) => {
        const api = globalThis.SuperAgents?.integration;
        return api?.describeStateSource?.(source, {
            messageIndex: context.messageIndex,
            swipeId: context.swipeId,
        }) ?? null;
    },
    read: (source, context) => {
        const api = globalThis.SuperAgents?.integration;
        const metadata = (api?.listStateSources?.() || [])
            .find(item => item.variableName === source);
        if (!metadata?.validated || metadata.enabled === false) return { found: false, value: null };
        const result = api.getState(source, {
            messageIndex: context.messageIndex,
            swipeId: context.swipeId,
            preferLive: context.preferLiveSuperAgentsState === true,
        });
        return result?.found
            ? { found: true, value: result.value, schemaVersion: result.schemaVersion }
            : { found: false, value: null };
    },
});

function knowledgeCandidateEntries(source, context = {}) {
    const api = globalThis.SuperAgents?.integration?.knowledge;
    if (!api || api.apiVersion < 1) return [];
    return api.listCandidates?.({
        source,
        messageIndex: context.messageIndex,
        swipeId: context.swipeId,
    }) || [];
}

registerConditionProvider({
    id: 'superagents-knowledge',
    label: 'SuperAgents safe knowledge opportunities',
    available: () => Boolean(globalThis.SuperAgents?.integration?.knowledge?.apiVersion >= 1),
    listSources: () => {
        const api = globalThis.SuperAgents?.integration?.knowledge;
        return (api?.listSources?.() || [])
            .filter(source => source.enabled !== false)
            .map(source => ({
                id: source.variableName,
                label: source.agentName || source.variableName,
                schemaVersion: source.schemaVersion ?? null,
            }));
    },
    describeSource: (source, context) => {
        const entries = knowledgeCandidateEntries(source, context);
        const prefix = 'candidates.$subject.';
        const stringFields = [
            ['recordId', 'Knowledge record'],
            ['character', 'Perspective holder'],
            ['capability', 'Safe capability'],
            ['position', 'Information position'],
            ['access', 'Access path'],
            ['disclosureIntent', 'Disclosure intent'],
            ['visibility', 'Visibility'],
            ['sensitivity', 'Sensitivity'],
            ['recordType', 'Record type'],
        ];
        return {
            fields: [
                ...stringFields.map(([key, label]) => ({ path: `${prefix}${key}`, key, label, type: 'string' })),
                { path: `${prefix}hasCoverStory`, key: 'hasCoverStory', label: 'Has cover story', type: 'boolean' },
                { path: `${prefix}prerequisiteCount`, key: 'prerequisiteCount', label: 'Prerequisite count', type: 'number', minimum: 0 },
            ],
            collections: [{
                path: 'candidates',
                label: 'Disclosure-safe knowledge opportunities',
                placeholder: '$subject',
                itemPath: 'candidates.$subject',
                subjects: entries.map(entry => entry.key),
            }],
        };
    },
    read: (source, context) => {
        const api = globalThis.SuperAgents?.integration?.knowledge;
        const available = (api?.listSources?.() || [])
            .some(item => item.variableName === source && item.enabled !== false);
        if (!available) return { found: false, value: null };
        const entries = knowledgeCandidateEntries(source, context);
        return {
            found: true,
            value: { candidates: Object.fromEntries(entries.map(entry => [entry.key, entry.value])) },
            schemaVersion: api.apiVersion,
        };
    },
});

const CALENDAR_SOURCE_ID = 'calendar';

function commitmentTimeLabel(time = {}) {
    return String(time.label || time.date || time.nextLabel || time.rule
        || time.anchorLabel || time.trigger || time.startLabel || '').trim();
}

function calendarCommitmentEntries(context = {}) {
    const api = globalThis.SuperAgents?.integration?.calendar;
    if (!api || api.apiVersion < 1) return [];
    const commitments = api.list?.({
        messageIndex: context.messageIndex,
        swipeId: context.swipeId,
    }) || [];
    return commitments.filter(item => item?.id && item?.title).map(item => ({
        key: String(item.id),
        value: {
            commitmentId: String(item.id),
            title: String(item.title),
            type: String(item.type || 'appointment'),
            status: String(item.status || 'scheduled'),
            timeKind: String(item.time?.kind || 'unscheduled'),
            calendarId: String(item.time?.calendarId || ''),
            timeLabel: commitmentTimeLabel(item.time),
            participants: Array.isArray(item.participants) ? item.participants.map(String) : [],
            location: String(item.location || ''),
            visibility: String(item.visibility || 'persona'),
            source: String(item.source || ''),
        },
    }));
}

registerConditionProvider({
    id: 'superagents-calendar',
    label: () => {
        const surface = globalThis.SuperAgents?.integration?.presentation?.getSurface?.('calendar');
        return `SuperAgents ${surface?.title || 'Calendar'} ${surface?.entryPluralLabel || 'commitments'}`;
    },
    available: () => Boolean(globalThis.SuperAgents?.integration?.calendar?.apiVersion >= 1),
    listSources: () => {
        const api = globalThis.SuperAgents?.integration?.calendar;
        return api?.apiVersion >= 1 ? [{
            id: CALENDAR_SOURCE_ID,
            label: globalThis.SuperAgents?.integration?.presentation?.getSurface?.('calendar')?.settingsLabel || 'Calendar / Commitments',
            schemaVersion: api.apiVersion,
        }] : [];
    },
    describeSource: (source, context) => {
        if (source !== CALENDAR_SOURCE_ID) return null;
        const entries = calendarCommitmentEntries(context);
        const prefix = 'commitments.$subject.';
        return {
            fields: [
                ...[
                    ['commitmentId', 'Commitment ID'],
                    ['title', 'Title'],
                    ['type', 'Type'],
                    ['status', 'Explicit status'],
                    ['timeKind', 'Time expression kind'],
                    ['calendarId', 'Calendar ID'],
                    ['timeLabel', 'Authored time label'],
                    ['location', 'Location'],
                    ['visibility', 'Visibility'],
                    ['source', 'Source'],
                ].map(([key, label]) => ({ path: `${prefix}${key}`, key, label, type: 'string' })),
                { path: `${prefix}participants`, key: 'participants', label: 'Participants', type: 'array' },
            ],
            collections: [{
                path: 'commitments',
                label: 'Visible branch commitments',
                placeholder: '$subject',
                itemPath: 'commitments.$subject',
                subjects: entries.map(entry => entry.key),
            }],
        };
    },
    read: (source, context) => {
        if (source !== CALENDAR_SOURCE_ID) return { found: false, value: null };
        const api = globalThis.SuperAgents?.integration?.calendar;
        if (!api || api.apiVersion < 1) return { found: false, value: null };
        const entries = calendarCommitmentEntries(context);
        return {
            found: true,
            value: { commitments: Object.fromEntries(entries.map(entry => [entry.key, entry.value])) },
            schemaVersion: api.apiVersion,
        };
    },
});

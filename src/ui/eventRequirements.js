import { ConditionGroupOperator, ConditionType } from '../../eventEngine.js';
import { SubjectMode } from '../subjects/subjects.js';

const SOURCE_NAMES = Object.freeze({
    sa_state_card: 'Scene State',
    sa_world_state: 'World State',
    sa_parallel: 'Parallel Off-Screen',
    sa_relationship_ledger: 'Relationship Ledger',
    sa_social_web: 'Social Web Ledger',
    sa_knowledge: 'Knowledge Ledger',
    sa_prompt_base: 'Prompt Base',
    sa_prompt_nsfw: 'Prompt NSFW',
    sa_after_dark: 'After Dark',
});

const esc = value => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const isSuperAgents = providerId => String(providerId || '').startsWith('superagents');

function addSource(sources, providerId, source, use) {
    if (!isSuperAgents(providerId)) return;
    const key = `${providerId}:${source || ''}`;
    if (!sources.has(key)) sources.set(key, { providerId, source: source || '', uses: new Set() });
    sources.get(key).uses.add(use);
}

function collectCondition(condition, sources, use) {
    if (!condition) return;
    if (condition.type === ConditionType.PROVIDER_STATE) {
        addSource(sources, condition.providerId, condition.source, use);
    }
    for (const child of condition.conditions || []) collectCondition(child, sources, use);
}

// Treat local conditions as unknown, but an unavailable SA provider as false.
// This answers whether any path through an OR/AND tree can activate without SA.
function outcomesWithoutSuperAgents(condition) {
    if (!condition || condition.type === ConditionType.NONE) return new Set([true]);
    let outcomes;
    if (condition.type === ConditionType.GROUP) {
        const children = (condition.conditions || []).map(outcomesWithoutSuperAgents);
        if (!children.length) outcomes = new Set([false]);
        else if (condition.operator === ConditionGroupOperator.ANY) {
            outcomes = new Set();
            if (children.some(child => child.has(true))) outcomes.add(true);
            if (children.every(child => child.has(false))) outcomes.add(false);
        } else {
            outcomes = new Set();
            if (children.every(child => child.has(true))) outcomes.add(true);
            if (children.some(child => child.has(false))) outcomes.add(false);
        }
    } else {
        outcomes = condition.type === ConditionType.PROVIDER_STATE && isSuperAgents(condition.providerId)
            ? new Set([false]) : new Set([true, false]);
    }
    return condition.invert ? new Set([...outcomes].map(value => !value)) : outcomes;
}

function addActions(actions, sources, use) {
    for (const action of actions || []) {
        if (action?.enabled === false) continue;
        if (action.type === 'superagents.phone') addSource(sources, 'superagents-phone', '', use);
        if (action.type === 'superagents.feed') addSource(sources, 'superagents-feed', '', use);
    }
}

export function getEventRequirements(event) {
    const trigger = new Map();
    const extras = new Map();
    collectCondition(event.condition, trigger, 'Trigger condition');
    const subject = event.subject || {};
    const stateSubject = subject.mode === SubjectMode.STATE_SOURCE || subject.mode === SubjectMode.STATE_VALUE;
    if (stateSubject) addSource(trigger, subject.providerId, subject.source, 'Subject selection');
    for (const phase of event.phases || []) {
        collectCondition(phase.condition, extras, 'Later phase');
        addActions(phase.actions, extras, 'Later phase action');
    }
    addActions(event.actions, extras, 'After-event action');

    const sources = new Map(trigger);
    for (const [key, entry] of extras) {
        if (!sources.has(key)) sources.set(key, { ...entry, uses: new Set() });
        for (const use of entry.uses) sources.get(key).uses.add(use);
    }
    const needsSA = (stateSubject && isSuperAgents(subject.providerId))
        || (trigger.size > 0 && !outcomesWithoutSuperAgents(event.condition).has(true));
    return {
        kind: needsSA ? 'required' : sources.size ? 'optional' : 'standalone',
        trigger: [...trigger.values()],
        extras: [...extras.values()],
    };
}

const BADGE_LABELS = Object.freeze({ required: 'SA required', optional: 'SA optional', standalone: 'Standalone' });
export function renderEventRequirementBadge(event) {
    const { kind } = getEventRequirements(event);
    return `<button type="button" class="dynevt-requirement-badge is-${kind}" data-requirements="${esc(event.id)}" aria-label="Requirements for ${esc(event.name)}: ${BADGE_LABELS[kind]}" aria-expanded="false">${BADGE_LABELS[kind]}</button>`;
}

export function refreshEventRequirementBadge(badge, event) {
    if (!badge || !event) return;
    const { kind } = getEventRequirements(event);
    badge.classList.remove('is-required', 'is-optional', 'is-standalone');
    badge.classList.add(`is-${kind}`);
    badge.textContent = BADGE_LABELS[kind];
    badge.setAttribute('aria-label', `Requirements for ${event.name}: ${BADGE_LABELS[kind]}`);
}

function sourceInfo(entry) {
    const api = globalThis.SuperAgents?.integration;
    const { providerId, source } = entry;
    if (providerId === 'superagents-phone' || providerId === 'superagents-feed') {
        const type = providerId.slice('superagents-'.length);
        const label = api?.presentation?.getSurface?.(type)?.label || (type === 'phone' ? 'Phone' : 'Social Feed');
        return { name: label, detail: 'SuperAgents action', status: api?.[type]?.isEnabled?.() ? 'Ready' : api ? 'Not enabled' : 'Unavailable' };
    }
    if (providerId === 'superagents-calendar') {
        return { name: api?.presentation?.getSurface?.('calendar')?.title || 'Calendar', detail: 'SuperAgents calendar', status: api?.calendar?.apiVersion >= 1 ? 'Ready' : 'Unavailable' };
    }
    if (providerId === 'superagents-knowledge') {
        return { name: 'Knowledge Ledger', detail: source || 'Safe knowledge', status: api?.knowledge?.apiVersion >= 1 ? 'Ready' : 'Unavailable' };
    }
    const state = (api?.listStateSources?.() || []).find(item => item.variableName === source);
    const status = !state ? api ? 'Missing' : 'Unavailable'
        : !state.enabled ? 'Disabled' : !state.validated ? 'Validation off' : 'Ready';
    return { name: state?.agentName || SOURCE_NAMES[source] || source || 'SuperAgents state', detail: source || 'State source', status };
}

function renderSources(entries, heading) {
    if (!entries.length) return '';
    return `<div class="dynevt-requirements-section"><div class="dynevt-requirements-section-title">${heading}</div>${entries.map(entry => {
        const info = sourceInfo(entry);
        return `<div class="dynevt-requirements-source"><span class="dynevt-requirements-source-name">${esc(info.name)}<small>${esc([...entry.uses].join(' · '))} · ${esc(info.detail)}</small></span><span class="dynevt-requirements-status ${info.status === 'Ready' ? 'is-ready' : 'is-unready'}">${esc(info.status)}</span></div>`;
    }).join('')}</div>`;
}

let openPopover = null;
let closeTimer = null;

export function closeEventRequirements() {
    clearTimeout(closeTimer);
    if (!openPopover) return;
    const { element, badge, outside, escape, scroll } = openPopover;
    badge?.setAttribute('aria-expanded', 'false');
    badge?.removeAttribute('aria-describedby');
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', escape, true);
    document.removeEventListener('scroll', scroll, true);
    element.remove();
    openPopover = null;
}

function scheduleClose() {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
        if (!openPopover?.pinned) closeEventRequirements();
    }, 160);
}

function showRequirements(badge, event, pinned = false) {
    refreshEventRequirementBadge(badge, event);
    if (openPopover?.badge === badge) {
        openPopover.pinned ||= pinned;
        clearTimeout(closeTimer);
        return;
    }
    closeEventRequirements();
    const requirements = getEventRequirements(event);
    const title = BADGE_LABELS[requirements.kind];
    const explanation = requirements.kind === 'required'
        ? 'Automatic activation needs SuperAgents state for subject selection or every available trigger path.'
        : requirements.kind === 'optional'
            ? 'This event can activate without SuperAgents. State-based paths or follow-up actions can use it when available.'
            : 'No SuperAgents source is configured for this event. Its schedule and local conditions still apply.';
    const element = document.createElement('div');
    element.className = `dynevt-requirements-popover is-${requirements.kind}`;
    element.id = 'dynevt-requirements-popover';
    element.setAttribute('role', 'tooltip');
    element.innerHTML = `<div class="dynevt-requirements-heading"><span class="dynevt-requirements-kicker">Event requirements</span><strong>${title}</strong></div><p>${explanation}</p>${renderSources(requirements.trigger, 'Trigger / subject')}${renderSources(requirements.extras.filter(item => !requirements.trigger.some(other => other.providerId === item.providerId && other.source === item.source)), 'Later phases / actions')}`;
    document.body.appendChild(element);
    const rect = badge.getBoundingClientRect();
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    element.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
    element.style.top = `${rect.bottom + 8 + height > window.innerHeight ? Math.max(8, rect.top - height - 8) : rect.bottom + 8}px`;
    badge.setAttribute('aria-expanded', 'true');
    badge.setAttribute('aria-describedby', element.id);
    const outside = evt => {
        if (!badge.contains(evt.target) && !element.contains(evt.target)) closeEventRequirements();
    };
    const escape = evt => { if (evt.key === 'Escape') closeEventRequirements(); };
    const scroll = () => closeEventRequirements();
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    document.addEventListener('scroll', scroll, true);
    element.addEventListener('mouseenter', () => clearTimeout(closeTimer));
    element.addEventListener('mouseleave', scheduleClose);
    openPopover = { element, badge, outside, escape, scroll, pinned };
}

export function wireEventRequirementBadge(badge, event) {
    if (!badge || !event) return;
    badge.addEventListener('mouseenter', () => showRequirements(badge, event));
    badge.addEventListener('mouseleave', scheduleClose);
    badge.addEventListener('focus', () => showRequirements(badge, event));
    badge.addEventListener('blur', scheduleClose);
    badge.addEventListener('click', evt => {
        evt.stopPropagation();
        if (openPopover?.badge === badge && openPopover.pinned) closeEventRequirements();
        else showRequirements(badge, event, true);
    });
}

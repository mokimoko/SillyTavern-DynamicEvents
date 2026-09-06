import { createEventSet, isSetActive, SetRole } from '../../eventEngine.js';
import { getSettings, saveSettings } from '../config/settings.js';
import { getBindingContext, setBindLabel } from '../runtime/bindingContext.js';
import { clearAllInjections, primeInjections } from '../runtime/injectionManager.js';
import { clearComponentSelection } from './componentSelection.js';

const escapeHtml = value => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

export function getGroupedSets(eventSets) {
    const primaries = eventSets.filter(set => set.role !== SetRole.SECONDARY || !set.parentSetId);
    const secondaryMap = new Map();
    for (const set of eventSets) {
        if (set.role !== SetRole.SECONDARY || !set.parentSetId) continue;
        if (!secondaryMap.has(set.parentSetId)) secondaryMap.set(set.parentSetId, []);
        secondaryMap.get(set.parentSetId).push(set);
    }

    const result = [];
    for (const primary of primaries) {
        result.push(primary);
        const children = secondaryMap.get(primary.id);
        if (children) result.push(...children);
    }
    return result;
}

function cleanupOrphanedSecondaries(settings) {
    let changed = false;
    for (const set of settings.eventSets) {
        if (set.role !== SetRole.SECONDARY || set.parentSetId) continue;
        set.role = SetRole.PRIMARY;
        changed = true;
    }
    if (changed) saveSettings();
}

export function createSetPanel({
    state,
    confirm,
    renderRightPanel,
    updateEventButtons,
}) {
    function selectSet(id) {
        state.selectedSetId = id;
        clearComponentSelection(state);
        state.selectedEventId = null;
        state.selectedScriptId = null;
        state.selectedTrackId = null;
        state.selectedRouterId = null;
    }

    function renderSetRow(set, bindingContext, { childCount = 0, expanded = false } = {}) {
        const active = isSetActive(set, bindingContext);
        const eventCount = set.events.length;
        const trackCount = (set.stateTracks || []).length;
        const routerCount = (set.promptRouters || []).length;
        const isSecondary = set.role === SetRole.SECONDARY && set.parentSetId;
        const bindLabel = setBindLabel(set);
        const groupToggle = isSecondary
            ? ''
            : childCount
                ? `<button class="dynevt-set-group-toggle" data-action="toggle-secondary-sets" title="${expanded ? 'Collapse' : 'Expand'} ${childCount} secondary set${childCount === 1 ? '' : 's'}" aria-expanded="${expanded}"><i class="fa-solid fa-chevron-${expanded ? 'down' : 'right'}"></i></button>`
                : '<span class="dynevt-set-group-spacer"></span>';

        return `
            <div class="dynevt-set-row ${set.id === state.selectedSetId ? 'selected' : ''} ${active ? '' : 'inactive'} ${isSecondary ? 'dynevt-set-secondary' : ''}" data-id="${escapeHtml(set.id)}">
                ${groupToggle}
                <label class="dynevt-set-toggle" onclick="event.stopPropagation()">
                    <input type="checkbox" ${set.enabled ? 'checked' : ''} data-action="toggle-set" />
                </label>
                <div class="dynevt-set-info">
                    <span class="dynevt-set-name">${isSecondary ? '<i class="fa-solid fa-turn-up fa-flip-horizontal dynevt-secondary-icon"></i> ' : ''}${escapeHtml(set.name)}</span>
                    <span class="dynevt-set-meta">
                        ${eventCount} event${eventCount !== 1 ? 's' : ''}${trackCount ? ` · ${trackCount} track${trackCount !== 1 ? 's' : ''}` : ''}${routerCount ? ` · ${routerCount} router${routerCount !== 1 ? 's' : ''}` : ''}
                        ${childCount ? ` · ${childCount} secondary set${childCount === 1 ? '' : 's'}` : ''}
                        ${bindLabel ? ` · <i class="fa-solid fa-link"></i> ${escapeHtml(bindLabel)}` : ''}
                    </span>
                </div>
                <button class="dynevt-btn-icon" data-action="delete-set" title="Delete" onclick="event.stopPropagation()">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        `;
    }

    function renderSetList() {
        const panel = document.getElementById('dynevt-panel-left');
        if (!panel) return;

        const settings = getSettings();
        const bindingContext = getBindingContext();
        const orderedSets = getGroupedSets(settings.eventSets);
        const expandedPrimarySetIds = state.expandedPrimarySetIds instanceof Set
            ? state.expandedPrimarySetIds
            : (state.expandedPrimarySetIds = new Set());
        const secondaryCounts = new Map();
        for (const set of settings.eventSets) {
            if (set.role !== SetRole.SECONDARY || !set.parentSetId) continue;
            secondaryCounts.set(set.parentSetId, (secondaryCounts.get(set.parentSetId) || 0) + 1);
        }
        for (const id of expandedPrimarySetIds) {
            if (!secondaryCounts.has(id)) expandedPrimarySetIds.delete(id);
        }
        const selectedSet = settings.eventSets.find(set => set.id === state.selectedSetId);
        if (selectedSet?.role === SetRole.SECONDARY && selectedSet.parentSetId) {
            expandedPrimarySetIds.add(selectedSet.parentSetId);
        }
        const visibleSets = orderedSets.filter(set => set.role !== SetRole.SECONDARY
            || !set.parentSetId
            || expandedPrimarySetIds.has(set.parentSetId));
        panel.innerHTML = `
            <div class="dynevt-set-list-header">
                <span class="dynevt-set-list-title">Event Sets</span>
                <button class="dynevt-btn dynevt-btn-accent" id="dynevt-add-set"><i class="fa-solid fa-plus"></i></button>
            </div>
            <div class="dynevt-set-list" id="dynevt-set-list">
                ${settings.eventSets.length === 0
                    ? '<div class="dynevt-empty">No event sets yet.</div>'
                    : visibleSets.map(set => renderSetRow(set, bindingContext, {
                        childCount: secondaryCounts.get(set.id) || 0,
                        expanded: expandedPrimarySetIds.has(set.id),
                    })).join('')}
            </div>
        `;

        panel.querySelector('#dynevt-add-set')?.addEventListener('click', () => {
            const newSet = createEventSet();
            settings.eventSets.push(newSet);
            saveSettings();
            selectSet(newSet.id);
            renderSetList();
            renderRightPanel();
        });

        panel.querySelectorAll('.dynevt-set-row').forEach(row => {
            const id = row.dataset.id;
            row.querySelector('[data-action="toggle-secondary-sets"]')?.addEventListener('click', event => {
                event.stopPropagation();
                const collapsing = expandedPrimarySetIds.has(id);
                if (collapsing) expandedPrimarySetIds.delete(id);
                else expandedPrimarySetIds.add(id);
                const selected = settings.eventSets.find(set => set.id === state.selectedSetId);
                if (collapsing && selected?.parentSetId === id) {
                    selectSet(id);
                    renderRightPanel();
                }
                renderSetList();
            });
            row.addEventListener('click', event => {
                if (event.target.closest('input, button, [data-action]')) return;
                cleanupOrphanedSecondaries(settings);
                selectSet(id);
                renderSetList();
                renderRightPanel();
            });

            row.querySelector('[data-action="toggle-set"]')?.addEventListener('change', function () {
                const set = settings.eventSets.find(item => item.id === id);
                if (!set) return;
                set.enabled = this.checked;
                saveSettings();
                clearAllInjections(settings);
                primeInjections();
                renderSetList();
                updateEventButtons();
            });

            row.querySelector('[data-action="delete-set"]')?.addEventListener('click', async () => {
                const set = settings.eventSets.find(item => item.id === id);
                if (!set || !await confirm(`Delete "${set.name}" and all its events, state tracks, prompt routers, and scripts?`)) return;
                if (set.role === SetRole.PRIMARY) {
                    for (const child of settings.eventSets) {
                        if (child.parentSetId !== id) continue;
                        child.role = SetRole.PRIMARY;
                        child.parentSetId = null;
                    }
                }
                settings.eventSets = settings.eventSets.filter(item => item.id !== id);
                if (state.selectedSetId === id) selectSet(settings.eventSets[0]?.id || null);
                saveSettings();
                renderSetList();
                renderRightPanel();
            });
        });
    }

    return { renderSetList, selectSet };
}

import {
    BindMode,
    ConditionType,
    generateId,
    SetRole,
} from '../../eventEngine.js';
import { getSettings, saveSettings } from '../config/settings.js';
import { describeConditionSource, listConditionSources } from '../conditions/providers.js';
import {
    BUILT_IN_PRESETS,
    getPreset,
    instantiatePreset,
    instantiatePresetEvents,
    instantiatePresetRouters,
    instantiatePresetScripts,
    instantiatePresetSharedInstructions,
    instantiatePresetTracks,
    resolvePresetEventKeys,
} from '../presets/catalog.js';
import { setBindLabel } from '../runtime/bindingContext.js';
import {
    closeEventRequirements,
    renderEventRequirementBadge,
    wireEventRequirementBadge,
} from './eventRequirements.js';

const services = {
    getGroupedSets: sets => sets,
    getSelectedSetId: () => null,
    selectSet: () => {},
    refreshAll: () => {},
    refreshPanels: () => {},
};

export function configurePresetTools(nextServices = {}) {
    Object.assign(services, nextServices);
}

const esc = value => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const AGENT_NAMES = Object.freeze({
    sa_state_card: 'Scene State',
    sa_world_state: 'World State',
    sa_parallel: 'Parallel Off-Screen',
    sa_relationship_ledger: 'Relationship Ledger',
    sa_social_web: 'Social Web Ledger',
    sa_knowledge: 'Knowledge Ledger',
    sa_prompt_base: 'Prompt Base',
    sa_prompt_nsfw: 'Prompt NSFW',
    sa_prompt_profile: 'Prompt Profile (legacy)',
});

function walkPresetCondition(condition, callback) {
    if (!condition) return;
    callback(condition);
    for (const child of condition.conditions || []) walkPresetCondition(child, callback);
}

function componentStateBindingKeys(component) {
    const keys = new Set();
    const inspect = condition => {
        const prefix = '$stateSource:';
        if (String(condition?.source || '').startsWith(prefix)) {
            keys.add(String(condition.source).slice(prefix.length));
        }
    };
    walkPresetCondition(component.condition, inspect);
    for (const phase of component.phases || []) walkPresetCondition(phase.condition, inspect);
    for (const state of component.states || []) {
        walkPresetCondition(state.condition, inspect);
        walkPresetCondition(state.exitCondition, inspect);
    }
    for (const layer of component.layers || []) walkPresetCondition(layer.condition, inspect);
    return keys;
}

function componentActions(component) {
    return [
        ...(component.actions || []),
        ...(component.states || []).flatMap(state => state.onEnterActions || []),
    ];
}

function presentedSurface(kind) {
    try {
        return globalThis.SuperAgents?.integration?.presentation?.getSurface?.(kind) || null;
    } catch {
        return null;
    }
}

function dependencyStatus(dependency) {
    const api = globalThis.SuperAgents?.integration;
    if (dependency.kind === 'state') {
        const source = (api?.listStateSources?.() || [])
            .find(item => item.variableName === dependency.source);
        if (!source) return { label: api ? 'Missing' : 'SuperAgents unavailable', tone: 'missing' };
        if (source.enabled === false) return { label: 'Disabled', tone: 'warning' };
        if (!source.validated) return { label: 'Validation off', tone: 'warning' };
        return { label: 'Ready', tone: 'ready' };
    }
    try {
        if (dependency.kind === 'phone' && api?.phone?.isEnabled?.()) {
            return { label: 'Ready', tone: 'ready' };
        }
        if (dependency.kind === 'feed' && api?.feed?.isEnabled?.()) {
            return { label: 'Ready', tone: 'ready' };
        }
        if (dependency.kind === 'calendar' && api?.calendar?.apiVersion >= 1) {
            return { label: 'Ready', tone: 'ready' };
        }
    } catch {
        // Treat integration errors as unavailable in this read-only status display.
    }
    return { label: api ? 'Not enabled' : 'SuperAgents unavailable', tone: 'warning' };
}

function presetDependencies(preset, components, selectedKeys) {
    const resolved = new Set(resolvePresetEventKeys(preset, selectedKeys));
    const selected = components.filter(component => resolved.has(component.key));
    const bindingKeys = new Set(selected.flatMap(component => [...componentStateBindingKeys(component)]));
    const dependencies = [];
    for (const dependency of preset.dependencies || []) {
        dependencies.push({ ...dependency });
    }
    for (const binding of preset.stateBindings || []) {
        if (!bindingKeys.has(binding.key)) continue;
        const source = binding.preferredSources?.[0];
        if (!source) continue;
        const existing = dependencies.find(item => item.kind === 'state' && item.source === source);
        if (existing) {
            existing.fields.push(binding.label || binding.key);
        } else {
            dependencies.push({
                kind: 'state',
                source,
                name: AGENT_NAMES[source] || source,
                fields: [binding.label || binding.key],
            });
        }
    }
    const actions = selected.flatMap(component => componentActions(component));
    if (actions.some(action => action.type === 'superagents.phone')) {
        const surface = presentedSurface('phone');
        const name = surface?.label || 'Phone';
        dependencies.push({
            kind: 'phone',
            name,
            detail: `Required by the selected ${name} action components.`,
        });
    }
    if (actions.some(action => action.type === 'superagents.feed')) {
        const surface = presentedSurface('feed');
        const name = surface?.label || 'Social Feed';
        dependencies.push({
            kind: 'feed',
            name,
            detail: `Required by the selected ${name} action components.`,
        });
    }
    return dependencies;
}

function renderPresetDependencies(preset, components, selectedKeys) {
    const dependencies = presetDependencies(preset, components, selectedKeys);
    if (!dependencies.length) {
        return '<div class="dynevt-preset-dependency-empty">No SuperAgents dependencies for the selected components.</div>';
    }
    return dependencies.map(dependency => {
        const status = dependencyStatus(dependency);
        const detail = dependency.kind === 'state'
            ? `Provides validated data for: ${dependency.fields.join(', ')}.`
            : dependency.detail;
        return `<div class="dynevt-preset-dependency">
            <i class="fa-solid ${status.tone === 'ready' ? 'fa-circle-check' : 'fa-circle-exclamation'}"></i>
            <span><strong>${esc(dependency.name)}</strong><small>${esc(detail)}</small></span>
            <em class="${status.tone}">${esc(status.label)}</em>
        </div>`;
    }).join('');
}

export function showPresetPicker() {
    const categories = [
        { key: 'events', label: 'Events', singular: 'Event', setField: 'events' },
        { key: 'routers', label: 'Prompt Routers', singular: 'Prompt Router', setField: 'promptRouters' },
        { key: 'tracks', label: 'State Tracks', singular: 'State Track', setField: 'stateTracks' },
        { key: 'scripts', label: 'Scripts', singular: 'Script', setField: 'scripts' },
    ];
    let activeCategory = 'events';
    document.getElementById('dynevt-preset-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'dynevt-preset-overlay';
    overlay.className = 'dynevt-confirm-overlay';
    overlay.innerHTML = '<div class="dynevt-confirm-box dynevt-preset-box" id="dynevt-preset-content"></div>';
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('dynevt-visible'));

    const close = () => {
        closeEventRequirements();
        overlay.classList.remove('dynevt-visible');
        setTimeout(() => overlay.remove(), 200);
    };
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    const presetComponents = preset => [
        ...(preset.events || []).map(definition => ({ ...definition, componentType: 'event' })),
        ...(preset.tracks || []).map(definition => ({ ...definition, componentType: 'state track' })),
        ...(preset.routers || []).map(definition => ({ ...definition, componentType: 'prompt router' })),
        ...(preset.scripts || []).map(definition => ({ ...definition, componentType: 'script' })),
    ];

    const renderCatalog = () => {
        closeEventRequirements();
        const content = overlay.querySelector('#dynevt-preset-content');
        const category = categories.find(item => item.key === activeCategory);
        const visiblePresets = BUILT_IN_PRESETS.filter(preset => (preset[activeCategory] || []).length);
        content.innerHTML = `
            <div class="dynevt-preset-heading">
                <div>
                    <div class="dynevt-confirm-msg">Presets</div>
                    <div class="dynevt-preset-intro">Choose a preset, then select its components and destination. Added components start disabled.</div>
                </div>
                <button class="dynevt-btn-icon" id="dynevt-preset-close" title="Close"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="dynevt-preset-tabs" role="tablist" aria-label="Preset types">
                ${categories.map(item => `<button class="dynevt-preset-tab ${item.key === activeCategory ? 'active' : ''}" type="button" role="tab" id="dynevt-preset-tab-${item.key}" aria-controls="dynevt-preset-grid" aria-selected="${item.key === activeCategory}" data-preset-category="${item.key}">${item.label}<span>${BUILT_IN_PRESETS.filter(preset => (preset[item.key] || []).length).length}</span></button>`).join('')}
            </div>
            <div class="dynevt-preset-grid" id="dynevt-preset-grid" role="tabpanel" aria-labelledby="dynevt-preset-tab-${activeCategory}">
                ${visiblePresets.length ? visiblePresets.map(preset => {
                    const categoryCount = (preset[activeCategory] || []).length;
                    const otherTypes = categories.filter(item => item.key !== activeCategory && (preset[item.key] || []).length).map(item => item.label);
                    const installedCount = getSettings().eventSets.reduce((count, set) => count
                        + (set[category.setField] || []).filter(component => component.sourcePresetId === preset.id).length, 0);
                    return `<article class="dynevt-preset-card" data-preset-id="${esc(preset.id)}">
                        <div class="dynevt-preset-card-top">
                            <strong>${esc(preset.name)}</strong>
                            <span>${categoryCount} ${category.singular}${categoryCount === 1 ? '' : 's'}</span>
                        </div>
                        <p>${esc(preset.description)}</p>
                        ${otherTypes.length ? `<div class="dynevt-preset-other-types">Also includes ${esc(otherTypes.join(', '))}</div>` : ''}
                        <div class="dynevt-preset-tags">${preset.tags.map(tag => `<span>${esc(tag)}</span>`).join('')}</div>
                        ${installedCount ? `<div class="dynevt-preset-installed">${installedCount} ${category.singular}${installedCount === 1 ? '' : 's'} already added</div>` : ''}
                        <button class="dynevt-btn dynevt-btn-accent" data-action="configure-preset">
                            <i class="fa-solid fa-sliders"></i> Choose components and destination
                        </button>
                    </article>`;
                }).join('') : `<div class="dynevt-preset-empty">No ${category.singular.toLowerCase()} presets yet. You can add ${category.label.toLowerCase()} directly in an event set.</div>`}
            </div>
        `;
        content.querySelector('#dynevt-preset-close').addEventListener('click', close);
        content.querySelectorAll('[data-preset-category]').forEach(button => {
            button.addEventListener('click', () => {
                activeCategory = button.dataset.presetCategory;
                renderCatalog();
                content.querySelector(`#dynevt-preset-tab-${activeCategory}`)?.focus();
            });
        });
        content.querySelectorAll('[data-action="configure-preset"]').forEach(button => {
            button.addEventListener('click', () => {
                const presetId = button.closest('[data-preset-id]')?.dataset.presetId;
                const preset = getPreset(presetId);
                if (preset) renderInstaller(preset, activeCategory);
            });
        });
    };

    const renderInstaller = (preset, initialCategory) => {
        closeEventRequirements();
        const content = overlay.querySelector('#dynevt-preset-content');
        const settings = getSettings();
        const components = presetComponents(preset);
        const initiallySelected = new Set(resolvePresetEventKeys(preset,
            (preset[initialCategory] || []).map(component => component.key)));
        const hasTracks = (preset.tracks || []).length > 0;
        const hasSubjectBinding = hasTracks || Boolean(preset.subjectBinding);
        const stateSources = listConditionSources('superagents');
        const stateBindings = (hasTracks || preset.stateBindings?.length)
            ? (preset.stateBindings?.length ? preset.stateBindings : [{
                key: 'default',
                label: 'State source',
                path: '',
                preferredSources: ['sa_relationship_ledger'],
            }])
            : [];
        const sourcesForBinding = binding => {
            if (!binding.path) return stateSources;
            return stateSources.filter(source => (describeConditionSource('superagents', source.id)?.fields || [])
                .some(field => field.path === binding.path));
        };
        const preferredSourceFor = (binding, sources) => {
            for (const preferred of binding.preferredSources || []) {
                if (sources.some(source => source.id === preferred)) return preferred;
            }
            return sources[0]?.id || binding.preferredSources?.[0] || 'sa_relationship_ledger';
        };
        const defaultStateSources = Object.fromEntries(stateBindings.map(binding => {
            const compatibleSources = sourcesForBinding(binding);
            return [binding.key, preferredSourceFor(binding, compatibleSources)];
        }));
        // Preview the same resolved subject and state-source bindings that Add will install.
        const installOptions = (hasTracks || stateBindings.length || hasSubjectBinding) ? {
            stateSources: defaultStateSources,
            stateSource: Object.values(defaultStateSources)[0] || 'sa_relationship_ledger',
            ...(hasSubjectBinding ? { subject: preset.subjectBinding?.default } : {}),
        } : {};
        const previewEvents = instantiatePresetEvents(preset, null, installOptions);
        const previewByKey = new Map((preset.events || []).map((event, index) => [event.key, previewEvents[index]]));
        const orderedSets = services.getGroupedSets(settings.eventSets);
        const selectedSetId = services.getSelectedSetId();
        const contextualSetId = orderedSets.some(set => set.id === selectedSetId) ? selectedSetId : '__new__';
        content.innerHTML = `
            <div class="dynevt-preset-heading">
                <div>
                    <button class="dynevt-btn dynevt-btn-sm" id="dynevt-preset-back"><i class="fa-solid fa-arrow-left"></i> Presets</button>
                    <div class="dynevt-confirm-msg dynevt-preset-detail-title">${esc(preset.name)}</div>
                    <div class="dynevt-preset-intro">${esc(preset.description)}</div>
                </div>
                <button class="dynevt-btn-icon" id="dynevt-preset-close" title="Close"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="dynevt-preset-installer">
                <section>
                    <div class="dynevt-preset-section-title">
                        <span>1. Choose components</span>
                        <button class="dynevt-toolbar-btn dynevt-preset-select-all" id="dynevt-preset-select-all" title="Deselect all components" aria-label="Deselect all components"><i class="fa-solid fa-square-minus" aria-hidden="true"></i></button>
                    </div>
                    <div class="dynevt-preset-event-list">
                        ${categories.filter(category => (preset[category.key] || []).length).map(category => `<div class="dynevt-preset-component-group">
                            <div class="dynevt-preset-component-heading">${category.label}<span>${(preset[category.key] || []).length}</span></div>
                            ${components.filter(definition => definition.componentType === category.singular.toLowerCase()).map(definition => {
                            const requirements = (definition.requires || [])
                                .map(key => components.find(component => component.key === key)?.name || key);
                            const preview = definition.componentType === 'event' ? previewByKey.get(definition.key) : null;
                            return `<div class="dynevt-preset-event-row" data-preset-key="${esc(definition.key)}">
                                <label class="dynevt-preset-event-choice">
                                    <input type="checkbox" data-preset-event="${esc(definition.key)}" ${initiallySelected.has(definition.key) ? 'checked' : ''} />
                                    <span class="dynevt-preset-event-details">
                                        <strong>${esc(definition.name)}</strong>
                                        <small>${esc(definition.description || '')}</small>
                                        ${requirements.length ? `<em>Also requires: ${esc(requirements.join(', '))}</em>` : ''}
                                    </span>
                                </label>
                                ${preview ? renderEventRequirementBadge(preview) : ''}
                            </div>`;
                            }).join('')}
                        </div>`).join('')}
                    </div>
                </section>
                <section>
                    <div class="dynevt-preset-section-title">2. Choose destination</div>
                    <label class="dynevt-field">
                        <span>Event set</span>
                        <select class="dynevt-select" id="dynevt-preset-destination">
                            <option value="__new__" ${contextualSetId === '__new__' ? 'selected' : ''}>Create a new event set</option>
                            ${orderedSets.map(set => `<option value="${esc(set.id)}" ${contextualSetId === set.id ? 'selected' : ''}>Add to: ${esc(set.name)}</option>`).join('')}
                        </select>
                    </label>
                    <label class="dynevt-field" id="dynevt-preset-new-name">
                        <span>New set name</span>
                        <input class="dynevt-input" value="${esc(preset.setName || preset.name)}" />
                        <small>The new set and all added components will start disabled.</small>
                    </label>
                    ${(hasTracks || (preset.routers || []).length) ? `<div class="dynevt-preset-existing-note"><strong>State Tracks and Prompt Routers are added disabled.</strong> Compatible state sources are selected automatically when available. Review their conditions and output placement before enabling.</div>` : ''}
                    ${components.some(component => component.componentType !== 'script') ? `<div class="dynevt-preset-dependencies">
                        <div class="dynevt-preset-dependencies-title">SuperAgents sources</div>
                        <div id="dynevt-preset-dependency-list"></div>
                    </div>
                    <div class="dynevt-preset-location-guide">
                        <strong>After adding</strong>
                        <span><b>Event / State Track / Prompt Router subject</b> chooses the character or runtime character pool.</span>
                        <span><b>Condition</b> chooses the validated state source used by each rule.</span>
                        <span><b>Actions</b> contains Phone or Feed behavior and recipient / author settings; connection profiles stay in SuperAgents.</span>
                    </div>` : `<div class="dynevt-preset-existing-note">Manual scripts appear by the send box once their script and destination set are enabled. Time Skip can use World State if it is active; no SuperAgents setup is required.</div>`}
                    <div class="dynevt-preset-existing-note" id="dynevt-preset-existing-note">Added components will start disabled. The destination set’s current enabled/binding settings will not change.</div>
                </section>
            </div>
            <div class="dynevt-confirm-buttons">
                <button class="dynevt-btn" id="dynevt-preset-cancel">Cancel</button>
                <button class="dynevt-btn dynevt-btn-accent" id="dynevt-preset-install"><i class="fa-solid fa-plus"></i> Add selected components</button>
            </div>
        `;

        const destination = content.querySelector('#dynevt-preset-destination');
        content.querySelectorAll('.dynevt-preset-event-row[data-preset-key]').forEach(row => {
            wireEventRequirementBadge(row.querySelector('[data-requirements]'), previewByKey.get(row.dataset.presetKey));
        });
        const newName = content.querySelector('#dynevt-preset-new-name');
        const existingNote = content.querySelector('#dynevt-preset-existing-note');
        const checkboxes = [...content.querySelectorAll('[data-preset-event]')];
        const selectAllButton = content.querySelector('#dynevt-preset-select-all');
        const updateDestination = () => {
            const creating = destination.value === '__new__';
            newName.classList.toggle('hidden', !creating);
            existingNote.classList.toggle('hidden', creating);
        };
        const updateInstallLabel = () => {
            const count = checkboxes.filter(box => box.checked).length;
            content.querySelector('#dynevt-preset-install').innerHTML = `<i class="fa-solid fa-plus"></i> Add ${count || ''} selected component${count === 1 ? '' : 's'}`;
            const allSelected = checkboxes.length > 0 && count === checkboxes.length;
            const selectAllLabel = allSelected ? 'Deselect all components' : 'Select all components';
            selectAllButton.title = selectAllLabel;
            selectAllButton.setAttribute('aria-label', selectAllLabel);
            selectAllButton.classList.toggle('active', count > 0);
            selectAllButton.classList.toggle('partial', count > 0 && !allSelected);
            selectAllButton.innerHTML = `<i class="fa-solid ${allSelected ? 'fa-square-minus' : 'fa-list-check'}" aria-hidden="true"></i>`;
            const selectedKeys = checkboxes.filter(box => box.checked).map(box => box.dataset.presetEvent);
            const dependencyList = content.querySelector('#dynevt-preset-dependency-list');
            if (dependencyList) dependencyList.innerHTML = renderPresetDependencies(preset, components, selectedKeys);
        };
        const syncDependencies = (changedBox) => {
            const boxesByKey = new Map(checkboxes.map(box => [box.dataset.presetEvent, box]));
            if (changedBox.checked) {
                const resolved = resolvePresetEventKeys(preset, [changedBox.dataset.presetEvent]);
                resolved.forEach(key => { if (boxesByKey.has(key)) boxesByKey.get(key).checked = true; });
            } else {
                let changed = true;
                while (changed) {
                    changed = false;
                    for (const definition of components) {
                        const box = boxesByKey.get(definition.key);
                        if (!box?.checked) continue;
                        if ((definition.requires || []).some(key => !boxesByKey.get(key)?.checked)) {
                            box.checked = false;
                            changed = true;
                        }
                    }
                }
            }
            updateInstallLabel();
        };

        content.querySelector('#dynevt-preset-back').addEventListener('click', renderCatalog);
        content.querySelector('#dynevt-preset-close').addEventListener('click', close);
        content.querySelector('#dynevt-preset-cancel').addEventListener('click', close);
        destination.addEventListener('change', updateDestination);
        checkboxes.forEach(box => box.addEventListener('change', () => syncDependencies(box)));
        selectAllButton.addEventListener('click', () => {
            const allSelected = checkboxes.length > 0 && checkboxes.every(box => box.checked);
            checkboxes.forEach(box => { box.checked = !allSelected; });
            updateInstallLabel();
        });
        updateDestination();
        updateInstallLabel();

        content.querySelector('#dynevt-preset-install').addEventListener('click', () => {
            const selectedKeys = checkboxes.filter(box => box.checked).map(box => box.dataset.presetEvent);
            if (!selectedKeys.length) {
                toastr.warning('Choose at least one component.', 'Dynamic Events');
                return;
            }
            let targetSet;
            if (destination.value === '__new__') {
                const setName = newName.querySelector('input').value.trim();
                if (!setName) {
                    toastr.warning('Enter a name for the new event set.', 'Dynamic Events');
                    return;
                }
                targetSet = instantiatePreset(preset, { selectedKeys, setName, ...installOptions });
                settings.eventSets.push(targetSet);
            } else {
                targetSet = settings.eventSets.find(set => set.id === destination.value);
                if (!targetSet) {
                    toastr.error('The selected destination set no longer exists.', 'Dynamic Events');
                    return;
                }
                targetSet.events ||= [];
                targetSet.sharedInstructions ||= [];
                targetSet.stateTracks ||= [];
                targetSet.promptRouters ||= [];
                targetSet.scripts ||= [];
                for (const block of instantiatePresetSharedInstructions(preset, selectedKeys)) {
                    if (!targetSet.sharedInstructions.some(existing => existing.id === block.id)) {
                        targetSet.sharedInstructions.push(block);
                    }
                }
                targetSet.events.push(...instantiatePresetEvents(preset, selectedKeys, installOptions));
                targetSet.stateTracks.push(...instantiatePresetTracks(preset, selectedKeys, installOptions));
                targetSet.promptRouters.push(...instantiatePresetRouters(preset, selectedKeys, installOptions));
                targetSet.scripts.push(...instantiatePresetScripts(preset, selectedKeys));
            }
            saveSettings();
            services.selectSet(targetSet.id);
            services.refreshAll();
            const addedCount = resolvePresetEventKeys(preset, selectedKeys).length;
            toastr.success(`Added ${addedCount} disabled component${addedCount === 1 ? '' : 's'} to ${targetSet.name}.`, 'Dynamic Events');
            close();
        });
    };

    renderCatalog();
}

export function exportAllSets() {
    const settings = getSettings();
    if (settings.eventSets.length === 0) {
        toastr.info('No event sets to export.');
        return;
    }
    // If only 1 set, skip the picker
    if (settings.eventSets.length === 1) {
        doExport(settings.eventSets);
        return;
    }
    showExportPicker();
}

function showExportPicker() {
    // Remove any existing
    document.getElementById('dynevt-export-overlay')?.remove();

    const settings = getSettings();
    const orderedSets = services.getGroupedSets(settings.eventSets);

    const overlay = document.createElement('div');
    overlay.id = 'dynevt-export-overlay';
    overlay.className = 'dynevt-confirm-overlay';
    overlay.innerHTML = `
        <div class="dynevt-confirm-box dynevt-export-box">
            <div class="dynevt-confirm-msg">Select sets to export together</div>
            <div class="dynevt-export-list">
                ${orderedSets.map(set => {
                    const isSecondary = set.role === SetRole.SECONDARY && set.parentSetId;
                    const rawBind = setBindLabel(set);
                    const bindLabel = set.bindMode === BindMode.MANUAL ? ' (manual)' : ` (${rawBind})`;
                    return `<label class="dynevt-export-row ${isSecondary ? 'dynevt-export-row-secondary' : ''}" data-parent="${set.parentSetId || ''}">
                        <input type="checkbox" value="${set.id}" checked />
                        <span class="dynevt-export-set-name">${isSecondary ? '↳ ' : ''}${esc(set.name)}</span>
                        <span class="dynevt-export-set-meta">${set.events.length} event${set.events.length !== 1 ? 's' : ''}${(set.promptRouters || []).length ? ` · ${(set.promptRouters || []).length} router${set.promptRouters.length === 1 ? '' : 's'}` : ''}${bindLabel}</span>
                    </label>`;
                }).join('')}
            </div>
            <div class="dynevt-export-actions">
                <button class="dynevt-btn dynevt-btn-sm" id="dynevt-export-toggle-all">Toggle All</button>
            </div>
            <div class="dynevt-confirm-buttons">
                <button class="dynevt-btn" id="dynevt-export-cancel">Cancel</button>
                <button class="dynevt-btn dynevt-btn-accent" id="dynevt-export-go"><i class="fa-solid fa-file-export"></i> Export Selected</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('dynevt-visible'));

    const close = () => {
        overlay.classList.remove('dynevt-visible');
        setTimeout(() => overlay.remove(), 200);
    };

    overlay.querySelector('#dynevt-export-cancel').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    overlay.querySelector('#dynevt-export-toggle-all').addEventListener('click', () => {
        const boxes = overlay.querySelectorAll('.dynevt-export-list input[type="checkbox"]');
        const allChecked = [...boxes].every(b => b.checked);
        boxes.forEach(b => b.checked = !allChecked);
    });

    overlay.querySelector('#dynevt-export-go').addEventListener('click', () => {
        const checked = [...overlay.querySelectorAll('.dynevt-export-list input[type="checkbox"]:checked')].map(b => b.value);
        if (checked.length === 0) { toastr.warning('Select at least one set.'); return; }
        const sets = settings.eventSets.filter(s => checked.includes(s.id));
        doExport(sets);
        close();
    });
}

function doExport(sets) {
    const payload = { version: 1, exportedAt: new Date().toISOString(), eventSets: sets };
    const name = sets.length === 1 ? sets[0].name.replace(/[^a-z0-9_-]/gi, '-').toLowerCase() : 'dynamic-events';
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${name}-export.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toastr.success(`Exported ${sets.length} set(s).`);
}

export function importSets(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (ev) {
        try {
            const data = JSON.parse(ev.target.result);
            if (!Array.isArray(data.eventSets)) { toastr.error('Invalid file: missing eventSets.'); return; }
            const settings = getSettings();

            // Build old→new ID map so condition references survive import
            const idMap = new Map();
            const sharedInstructionIdMaps = new Map();
            for (const set of data.eventSets) {
                const oldSetId = set.id;
                set.id = generateId('set');
                idMap.set(oldSetId, set.id);
                if (!Array.isArray(set.sharedInstructions)) set.sharedInstructions = [];
                const sharedInstructionIdMap = new Map();
                for (const block of set.sharedInstructions) {
                    const oldBlockId = block.id;
                    block.id = generateId('shared');
                    sharedInstructionIdMap.set(oldBlockId, block.id);
                }
                sharedInstructionIdMaps.set(set.id, sharedInstructionIdMap);
                for (const evt of set.events) {
                    const oldEvtId = evt.id;
                    evt.id = generateId('evt');
                    idMap.set(oldEvtId, evt.id);
                    evt.phases?.forEach(ph => {
                        const oldPhId = ph.id;
                        ph.id = generateId('ph');
                        idMap.set(oldPhId, ph.id);
                    });
                }
                for (const scr of (set.scripts || [])) {
                    const oldScrId = scr.id;
                    scr.id = generateId('scr');
                    idMap.set(oldScrId, scr.id);
                }
                if (!Array.isArray(set.stateTracks)) set.stateTracks = [];
                for (const track of set.stateTracks) {
                    const oldTrackId = track.id;
                    track.id = generateId('track');
                    idMap.set(oldTrackId, track.id);
                    for (const state of (track.states || [])) {
                        const oldStateId = state.id;
                        state.id = generateId('state');
                        idMap.set(oldStateId, state.id);
                    }
                }
                if (!Array.isArray(set.promptRouters)) set.promptRouters = [];
                for (const router of set.promptRouters) {
                    const oldRouterId = router.id;
                    router.id = generateId('router');
                    idMap.set(oldRouterId, router.id);
                    for (const layer of (router.layers || [])) {
                        const oldLayerId = layer.id;
                        layer.id = generateId('layer');
                        idMap.set(oldLayerId, layer.id);
                    }
                }
            }

            // Remap condition targetEventId and parentSetId references using the old→new map
            for (const set of data.eventSets) {
                // Remap parent set linkage
                if (set.parentSetId) {
                    const newParent = idMap.get(set.parentSetId);
                    set.parentSetId = newParent || null;
                    // If parent wasn't in this import, revert to primary
                    if (!newParent) set.role = SetRole.PRIMARY;
                }
                for (const evt of set.events) {
                    const sharedInstructionIdMap = sharedInstructionIdMaps.get(set.id) || new Map();
                    evt.sharedInstructionIds = (evt.sharedInstructionIds || [])
                        .map(id => sharedInstructionIdMap.get(id))
                        .filter(Boolean);
                    remapConditionTarget(evt.condition, idMap);
                    evt.phases?.forEach(ph => remapConditionTarget(ph.condition, idMap));
                }
                for (const scr of (set.scripts || [])) {
                    remapConditionTarget(scr.condition, idMap);
                }
                for (const track of (set.stateTracks || [])) {
                    for (const state of (track.states || [])) {
                        remapConditionTarget(state.condition, idMap);
                        remapConditionTarget(state.exitCondition, idMap);
                    }
                }
                for (const router of (set.promptRouters || [])) {
                    for (const layer of (router.layers || [])) {
                        remapConditionTarget(layer.condition, idMap);
                    }
                }
                settings.eventSets.push(set);
            }

            saveSettings();
            services.refreshPanels();
            toastr.success(`Imported ${data.eventSets.length} set(s).`);
        } catch (err) { toastr.error('Import failed: ' + err.message); }
    };
    reader.readAsText(file);
    $(e.target).val('');
}

/** Remap a condition's targetEventId using an old→new ID map */
function remapConditionTarget(condition, idMap) {
    if (!condition) return;
    if (condition.type === ConditionType.GROUP) {
        for (const child of (condition.conditions || [])) remapConditionTarget(child, idMap);
        return;
    }
    if (!condition.targetEventId) return;
    const newId = idMap.get(condition.targetEventId);
    if (newId) condition.targetEventId = newId;
}

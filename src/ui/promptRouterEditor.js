import {
    InjectionMode,
    PromptPosition,
    PromptRole,
    createConditionGroup,
} from '../../eventEngine.js';
import {
    PromptRouterMode,
    createPromptLayer,
    promptOutletMacroName,
    sanitizePromptOutletName,
} from '../routers/promptRouters.js';
import {
    createDefaultProviderCondition,
    renderConditionEditor,
    wireConditionEditor,
} from './conditionEditor.js';
import {
    availableSubjectsFromConditions,
    renderSubjectEditor,
    wireSubjectEditor,
} from './subjectEditor.js';

function esc(value) {
    const element = document.createElement('div');
    element.textContent = String(value ?? '');
    return element.innerHTML;
}

function availableSubjects(router) {
    return availableSubjectsFromConditions((router.layers || []).map(layer => layer.condition));
}

export function renderPromptRouterRow(router, inspection = {}, { bulkSelected = false, editing = false } = {}) {
    const activeNames = (router.layers || [])
        .filter(layer => inspection.activeLayerIds?.includes(layer.id))
        .map(layer => layer.name);
    return `
        <div class="dynevt-event-row dynevt-router-row ${bulkSelected ? 'bulk-selected' : ''} ${editing ? 'editing' : ''}" data-router-id="${esc(router.id)}" data-component-id="${esc(router.id)}" aria-selected="${bulkSelected}" ${editing ? 'aria-current="true"' : ''}>
            <span class="dynevt-drag-spacer" aria-hidden="true"></span>
            <label class="dynevt-event-select" onclick="event.stopPropagation()" title="Select this Prompt Router for bulk actions">
                <input type="checkbox" ${bulkSelected ? 'checked' : ''} data-action="select-component" aria-label="Select ${esc(router.name)} for bulk actions" />
            </label>
            <label class="dynevt-event-enable-toggle" onclick="event.stopPropagation()" title="${router.enabled ? 'Disable' : 'Enable'} this Prompt Router">
                <input type="checkbox" ${router.enabled ? 'checked' : ''} data-router-action="toggle" aria-label="${router.enabled ? 'Disable' : 'Enable'} ${esc(router.name)}" />
                <span aria-hidden="true"></span>
            </label>
            <i class="fa-solid fa-code-branch dynevt-event-icon"></i>
            <span class="dynevt-event-name">${esc(router.name)}</span>
            <span class="dynevt-event-type">${router.mode === PromptRouterMode.EXCLUSIVE ? 'exclusive router' : 'stacking router'}</span>
            <span class="dynevt-event-status">${activeNames.length ? esc(activeNames.join(' + ')) : 'No matching layers'}</span>
            <button class="dynevt-btn-icon" data-router-action="delete" title="Delete"><i class="fa-solid fa-trash"></i></button>
        </div>`;
}

function renderLayer(layer, router, inspection) {
    const matches = inspection.conditionResults?.[layer.id] === true;
    const active = inspection.activeLayerIds?.includes(layer.id);
    const status = layer.enabled === false
        ? 'Disabled'
        : active
            ? 'Active'
            : matches && router.mode === PromptRouterMode.EXCLUSIVE
                ? 'Matches · lower priority'
                : matches ? 'Matches' : 'Does not match';
    return `
        <section class="dynevt-track-state ${active ? 'active' : ''}" data-layer-id="${esc(layer.id)}">
            <div class="dynevt-track-state-head">
                <input class="dynevt-input dynevt-phase-name" data-layer-field="name" value="${esc(layer.name)}" placeholder="Layer name" />
                <span class="dynevt-track-state-status ${matches ? '' : 'unmet'}">${status}</span>
                <button class="dynevt-btn-icon" data-layer-action="delete" title="Delete layer"><i class="fa-solid fa-trash"></i></button>
            </div>
            <div class="dynevt-editor-row">
                <div class="dynevt-field"><label>Priority</label><input type="number" class="dynevt-input dynevt-input-sm" data-layer-field="priority" value="${Number(layer.priority) || 0}" /></div>
                <label class="dynevt-toggle-label"><input type="checkbox" data-layer-field="enabled" ${layer.enabled !== false ? 'checked' : ''} /><span>Enabled</span></label>
            </div>
            <div class="dynevt-track-condition-editor">
                <div class="dynevt-track-subheading"><span>Activate when</span></div>
                ${renderConditionEditor(layer.condition, {
                    prefix: `router-${router.id}-${layer.id}`,
                    providerOnly: true,
                    detail: inspection.conditionDetails?.[layer.id],
                })}
            </div>
            <div class="dynevt-field"><label>Prompt fragment <span class="dynevt-hint">Use {{subject}} for the mapped narrative character.</span></label>
                <textarea class="dynevt-textarea dynevt-phase-text" rows="5" data-layer-field="text" placeholder="Instructions injected whenever this layer matches…">${esc(layer.text)}</textarea></div>
        </section>`;
}
export function renderPromptRouterEditor(router, inspection = {}) {
    const injection = {
        mode: InjectionMode.EXTENSION_PROMPT,
        position: PromptPosition.IN_CHAT,
        depth: 1,
        role: PromptRole.SYSTEM,
        macroName: '',
        ...(router.injection || {}),
    };
    const isMacro = injection.mode === InjectionMode.MACRO;
    const outletMacro = promptOutletMacroName(injection.macroName);
    return `
        <div class="dynevt-editor dynevt-router-editor" data-router-editor="${esc(router.id)}">
            <div class="dynevt-editor-row">
                <div class="dynevt-field dynevt-field-grow"><label>Router name</label><input class="dynevt-input" data-router-field="name" value="${esc(router.name)}" /></div>
                <div class="dynevt-field"><label>Matching behavior</label><select class="dynevt-select" data-router-field="mode">
                    <option value="${PromptRouterMode.STACK}" ${router.mode !== PromptRouterMode.EXCLUSIVE ? 'selected' : ''}>Stack every matching layer</option>
                    <option value="${PromptRouterMode.EXCLUSIVE}" ${router.mode === PromptRouterMode.EXCLUSIVE ? 'selected' : ''}>Use highest-priority match</option>
                </select></div>
            </div>
            ${renderSubjectEditor(router.subject, {
                id: `router-${router.id}`,
                label: 'Prompt subject',
                suggestions: availableSubjects(router),
                hint: 'Optional. This resolves $subject paths and the {{subject}} macro used by matching layers.',
            })}
            <div class="dynevt-track-diagnostic">Resolved subject: <strong>${esc(inspection.subject || 'not available')}</strong> · Active layers: <strong>${inspection.activeLayerIds?.length || 0}</strong></div>
            <div class="dynevt-section-label">Injection</div>
            <div class="dynevt-editor-row dynevt-track-injection">
                <div class="dynevt-field"><label>Mode</label><select class="dynevt-select" data-router-injection-field="mode">
                    <option value="${InjectionMode.EXTENSION_PROMPT}" ${!isMacro ? 'selected' : ''}>Extension Prompt</option>
                    <option value="${InjectionMode.MACRO}" ${isMacro ? 'selected' : ''}>Macro {{dynamicEvents}}</option>
                </select></div>
                <div class="dynevt-field ${isMacro ? 'hidden' : ''}" data-router-show="ext-prompt"><label>Position</label><select class="dynevt-select" data-router-injection-field="position" data-number>
                    <option value="${PromptPosition.IN_PROMPT}" ${injection.position === PromptPosition.IN_PROMPT ? 'selected' : ''}>In Prompt (after story)</option>
                    <option value="${PromptPosition.IN_CHAT}" ${injection.position === PromptPosition.IN_CHAT ? 'selected' : ''}>In Chat (at depth)</option>
                    <option value="${PromptPosition.BEFORE_PROMPT}" ${injection.position === PromptPosition.BEFORE_PROMPT ? 'selected' : ''}>Before Prompt</option>
                </select></div>
                <div class="dynevt-field ${isMacro ? 'hidden' : ''}" data-router-show="ext-prompt"><label>Depth</label><input type="number" class="dynevt-input dynevt-input-sm" data-router-injection-field="depth" value="${injection.depth}" min="0" max="999" /></div>
                <div class="dynevt-field ${isMacro ? 'hidden' : ''}" data-router-show="ext-prompt"><label>Role</label><select class="dynevt-select" data-router-injection-field="role" data-number>
                    <option value="${PromptRole.SYSTEM}" ${injection.role === PromptRole.SYSTEM ? 'selected' : ''}>System</option>
                    <option value="${PromptRole.USER}" ${injection.role === PromptRole.USER ? 'selected' : ''}>User</option>
                    <option value="${PromptRole.ASSISTANT}" ${injection.role === PromptRole.ASSISTANT ? 'selected' : ''}>Assistant</option>
                </select></div>
                <div class="dynevt-field dynevt-field-grow ${isMacro ? '' : 'hidden'}" data-router-show="macro"><label>Named outlet <span class="dynevt-hint">optional</span></label>
                    <input class="dynevt-input" data-router-injection-field="macroName" value="${esc(sanitizePromptOutletName(injection.macroName))}" placeholder="scene_guidance" maxlength="48" />
                    <small class="dynevt-hint">Place <code data-router-macro-preview>${esc(outletMacro ? `{{${outletMacro}}}` : '{{dynamicEvents}}')}</code> in your preset. Leave blank to use the shared <code>{{dynamicEvents}}</code> outlet.</small>
                </div>
            </div>
            <p class="dynevt-hint">Stacking routers inject every match in priority order. Exclusive routers inject only the highest-priority match. Named macro outlets let different routers appear at different exact locations in your preset.</p>
            <div class="dynevt-track-states">
                ${(router.layers || []).map(layer => renderLayer(layer, router, inspection)).join('') || '<div class="dynevt-empty">No prompt layers yet.</div>'}
            </div>
            <button class="dynevt-btn dynevt-btn-accent" data-router-action="add-layer"><i class="fa-solid fa-plus"></i> Add Prompt Layer</button>
        </div>`;
}

export function wirePromptRouterEditor(container, router, callbacks) {
    container.querySelectorAll('[data-router-field]').forEach(input => {
        input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', () => {
            router[input.dataset.routerField] = input.value;
            callbacks.changed(input.tagName === 'SELECT');
        });
    });
    wireSubjectEditor(container, router, callbacks);
    router.injection ||= {
        mode: InjectionMode.EXTENSION_PROMPT,
        position: PromptPosition.IN_CHAT,
        depth: 1,
        role: PromptRole.SYSTEM,
        macroName: '',
    };
    container.querySelectorAll('[data-router-injection-field]').forEach(input => {
        const field = input.dataset.routerInjectionField;
        const eventName = input.tagName === 'SELECT' || field === 'macroName' ? 'change' : 'input';
        input.addEventListener(eventName, () => {
            router.injection[field] = input.type === 'number' || input.hasAttribute('data-number')
                ? Number(input.value)
                : field === 'macroName' ? sanitizePromptOutletName(input.value) : input.value;
            if (field === 'macroName') {
                input.value = router.injection[field];
                const macroName = promptOutletMacroName(router.injection[field]);
                const preview = container.querySelector('[data-router-macro-preview]');
                if (preview) preview.textContent = macroName ? `{{${macroName}}}` : '{{dynamicEvents}}';
            }
            if (field === 'mode') {
                const hide = input.value === InjectionMode.MACRO;
                container.querySelectorAll('[data-router-show="ext-prompt"]')
                    .forEach(element => element.classList.toggle('hidden', hide));
                container.querySelectorAll('[data-router-show="macro"]')
                    .forEach(element => element.classList.toggle('hidden', !hide));
            }
            callbacks.changed(false);
        });
    });
    container.querySelector('[data-router-action="add-layer"]')?.addEventListener('click', () => {
        router.layers.push(createPromptLayer({
            name: `Layer ${router.layers.length + 1}`,
            condition: createConditionGroup({ conditions: [createDefaultProviderCondition()] }),
        }));
        callbacks.changed(true);
    });

    container.querySelectorAll('[data-layer-id]').forEach(layerElement => {
        const layer = router.layers.find(item => item.id === layerElement.dataset.layerId);
        if (!layer) return;
        layerElement.querySelectorAll('[data-layer-field]').forEach(input => {
            const eventName = input.tagName === 'SELECT' || input.type === 'checkbox' ? 'change' : 'input';
            input.addEventListener(eventName, () => {
                const field = input.dataset.layerField;
                if (input.type === 'checkbox') layer[field] = input.checked;
                else if (input.type === 'number') layer[field] = Number(input.value) || 0;
                else layer[field] = input.value;
                callbacks.changed(field === 'enabled' || field === 'priority');
            });
        });
        layerElement.querySelector('[data-layer-action="delete"]')?.addEventListener('click', async () => {
            if (!await callbacks.confirmDelete(`Delete prompt layer "${layer.name}"?`)) return;
            router.layers = router.layers.filter(item => item.id !== layer.id);
            callbacks.changed(true);
        });
        const conditionRoot = layerElement.querySelector('.dynevt-condition');
        if (conditionRoot) {
            wireConditionEditor(conditionRoot, layer.condition, rerender => {
                callbacks.changed(rerender);
                return !rerender;
            }, { providerOnly: true });
        }
    });
}

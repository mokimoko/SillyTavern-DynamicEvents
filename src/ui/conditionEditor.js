import {
    ConditionBehavior,
    ConditionGroupOperator,
    ConditionType,
    createCondition,
    createConditionGroup,
} from '../../eventEngine.js';
import { getSettings } from '../config/settings.js';
import {
    ProviderOperator,
    describeConditionSource,
    listConditionSources,
} from '../conditions/providers.js';

function esc(value) {
    const element = document.createElement('div');
    element.textContent = String(value ?? '');
    return element.innerHTML;
}

function allEventOptions(excludeId = '') {
    const options = [];
    for (const set of getSettings().eventSets || []) {
        for (const event of set.events || []) {
            if (event.id === excludeId) continue;
            options.push({ id: event.id, label: `${set.name} → ${event.name}`, phases: event.phases });
        }
    }
    return options;
}

export function createDefaultProviderCondition() {
    const source = listConditionSources('superagents')[0]?.id || '';
    const fields = source ? describeConditionSource('superagents', source)?.fields || [] : [];
    const path = fields.find(field => field.path.includes('$subject'))?.path || fields[0]?.path || '';
    return createCondition({
        type: ConditionType.PROVIDER_STATE,
        providerId: 'superagents',
        source,
        path,
        operator: ProviderOperator.GTE,
        value: '0',
    });
}

function conditionAt(root, path) {
    let node = root;
    for (const index of path) node = node.conditions[index];
    return node;
}

function replaceNode(node, replacement) {
    for (const key of Object.keys(node)) delete node[key];
    Object.assign(node, replacement);
}

function renderTypeOptions(condition, providerOnly) {
    const definitions = providerOnly
        ? [
            [ConditionType.NONE, 'None (always eligible)'],
            [ConditionType.GROUP, 'All / any rule group'],
            [ConditionType.PROVIDER_STATE, 'Validated SuperAgents state'],
        ]
        : [
            [ConditionType.NONE, 'None (always eligible)'],
            [ConditionType.GROUP, 'All / any rule group'],
            [ConditionType.PHASE_REACHED, 'Phase reached'],
            [ConditionType.HAS_FIRED, 'Has fired'],
            [ConditionType.FIRE_COUNT, 'Fire count ≥'],
            [ConditionType.IS_SPENT, 'Is spent (one-shot)'],
            [ConditionType.NOT_SPENT, 'Not spent'],
            [ConditionType.PROVIDER_STATE, 'Validated SuperAgents state'],
        ];
    return definitions.map(([type, label]) =>
        `<option value="${type}" ${condition.type === type ? 'selected' : ''}>${label}</option>`).join('');
}

function renderProviderFields(condition) {
    const sources = listConditionSources(condition.providerId || 'superagents');
    if (condition.source && !sources.some(source => source.id === condition.source)) {
        sources.push({ id: condition.source, label: `${condition.source} (unavailable)` });
    }
    const fields = condition.source
        ? describeConditionSource(condition.providerId || 'superagents', condition.source)?.fields || []
        : [];
    const fieldKnown = fields.some(field => field.path === condition.path);
    const needsValue = condition.operator !== ProviderOperator.EXISTS;
    return `
        <div class="dynevt-field" data-cond-show="provider-source"><label>State source</label>
            <select class="dynevt-select" data-node-cond="source">
                <option value="">-- select validated source --</option>
                ${sources.map(source => `<option value="${esc(source.id)}" ${condition.source === source.id ? 'selected' : ''}>${esc(source.label)}</option>`).join('')}
            </select></div>
        <div class="dynevt-field" data-cond-show="provider-path"><label>Field path</label>
            ${fields.length ? `<select class="dynevt-select" data-node-cond="path">
                <option value="">-- select field --</option>
                ${!fieldKnown && condition.path ? `<option value="${esc(condition.path)}" selected>${esc(condition.path)} (custom)</option>` : ''}
                ${fields.map(field => `<option value="${esc(field.path)}" ${condition.path === field.path ? 'selected' : ''}>${esc(field.label)} · ${esc(field.path)}</option>`).join('')}
            </select>` : `<input class="dynevt-input" data-node-cond="path" value="${esc(condition.path || '')}" placeholder="characters.$subject.trust" />`}
        </div>
        <div class="dynevt-condition-comparison" data-cond-show="provider-comparison">
            <div class="dynevt-field"><label>Compare</label><select class="dynevt-select" data-node-cond="operator">
                <option value="${ProviderOperator.EXISTS}" ${condition.operator === ProviderOperator.EXISTS ? 'selected' : ''}>exists</option>
                <option value="${ProviderOperator.EQ}" ${condition.operator === ProviderOperator.EQ ? 'selected' : ''}>equals (=)</option>
                <option value="${ProviderOperator.NEQ}" ${condition.operator === ProviderOperator.NEQ ? 'selected' : ''}>not equal (!=)</option>
                <option value="${ProviderOperator.GT}" ${condition.operator === ProviderOperator.GT ? 'selected' : ''}>greater than (&gt;)</option>
                <option value="${ProviderOperator.GTE}" ${condition.operator === ProviderOperator.GTE ? 'selected' : ''}>at least (&gt;=)</option>
                <option value="${ProviderOperator.LT}" ${condition.operator === ProviderOperator.LT ? 'selected' : ''}>less than (&lt;)</option>
                <option value="${ProviderOperator.LTE}" ${condition.operator === ProviderOperator.LTE ? 'selected' : ''}>at most (&lt;=)</option>
                <option value="${ProviderOperator.CONTAINS}" ${condition.operator === ProviderOperator.CONTAINS ? 'selected' : ''}>contains</option>
            </select></div>
            <div class="dynevt-field ${needsValue ? '' : 'hidden'}" data-cond-show="provider-value"><label>Value</label>
                <input class="dynevt-input" data-node-cond="value" value="${esc(condition.value ?? '')}" placeholder="70" /></div>
        </div>`;
}

function renderNode(condition, path, options, detail = null) {
    const encodedPath = path.join('.');
    const root = path.length === 0;
    if (condition.type === ConditionType.GROUP) {
        return `<div class="dynevt-track-condition-group" data-cond-node-path="${encodedPath}">
            <div class="dynevt-track-condition-group-head">
                <select class="dynevt-select" data-node-cond="type">${renderTypeOptions(condition, options.providerOnly)}</select>
                <select class="dynevt-select dynevt-select-sm" data-node-cond="operator">
                    <option value="${ConditionGroupOperator.ALL}" ${condition.operator === ConditionGroupOperator.ALL ? 'selected' : ''}>All rules</option>
                    <option value="${ConditionGroupOperator.ANY}" ${condition.operator === ConditionGroupOperator.ANY ? 'selected' : ''}>Any rule</option>
                </select>
                <label class="dynevt-condition-invert"><input type="checkbox" data-node-cond="invert" ${condition.invert ? 'checked' : ''} /> Not</label>
                ${root && options.showBehavior ? `<div class="dynevt-field"><label>If unmet</label><select class="dynevt-select" data-node-cond="behavior">
                    <option value="${ConditionBehavior.STALL}" ${condition.behavior === ConditionBehavior.STALL ? 'selected' : ''}>Stall</option>
                    <option value="${ConditionBehavior.SKIP}" ${condition.behavior === ConditionBehavior.SKIP ? 'selected' : ''}>Skip phase</option>
                </select></div>` : ''}
                <button class="dynevt-btn dynevt-btn-sm" data-node-action="add-rule">+ Rule</button>
                <button class="dynevt-btn dynevt-btn-sm" data-node-action="add-group">+ Group</button>
                ${root ? '' : '<button class="dynevt-btn-icon" data-node-action="delete" title="Remove group"><i class="fa-solid fa-trash"></i></button>'}
            </div>
            <div class="dynevt-track-condition-children">
                ${(condition.conditions || []).map((child, index) => renderNode(child, [...path, index], options, detail?.children?.[index])).join('')
                    || '<div class="dynevt-hint">Add at least one rule.</div>'}
            </div>
        </div>`;
    }

    const events = allEventOptions(options.excludeEventId);
    const isNone = condition.type === ConditionType.NONE;
    const isProvider = condition.type === ConditionType.PROVIDER_STATE;
    const needsTarget = !isNone && !isProvider;
    const needsPhase = condition.type === ConditionType.PHASE_REACHED;
    const needsCount = condition.type === ConditionType.FIRE_COUNT;
    const targetEvents = needsPhase ? events.filter(event => event.phases?.length > 0) : events;
    const target = events.find(event => event.id === condition.targetEventId);
    const phases = target?.phases?.length
        ? target.phases.map((phase, index) => `<option value="${index}" ${condition.targetPhase === index ? 'selected' : ''}>${esc(phase.name || `Phase ${index + 1}`)}</option>`).join('')
        : '<option value="0">--</option>';

    return `<div class="dynevt-condition-row dynevt-track-condition-leaf" data-cond-node-path="${encodedPath}">
        <div class="dynevt-field"><label>Requires</label><select class="dynevt-select" data-node-cond="type">${renderTypeOptions(condition, options.providerOnly)}</select></div>
        ${needsTarget ? `<div class="dynevt-field"><label>Target Event</label><select class="dynevt-select" data-node-cond="targetEventId">
            <option value="">-- select --</option>${targetEvents.map(event => `<option value="${event.id}" ${condition.targetEventId === event.id ? 'selected' : ''}>${esc(event.label)}</option>`).join('')}
        </select></div>` : ''}
        ${needsPhase ? `<div class="dynevt-field"><label>Phase ≥</label><select class="dynevt-select" data-node-cond="targetPhase">${phases}</select></div>` : ''}
        ${needsCount ? `<div class="dynevt-field"><label>Count ≥</label><input type="number" class="dynevt-input dynevt-input-sm" data-node-cond="targetCount" value="${condition.targetCount}" min="1" /></div>` : ''}
        ${isProvider ? renderProviderFields(condition) : ''}
        ${isNone ? '' : '<label class="dynevt-condition-invert"><input type="checkbox" data-node-cond="invert" ' + (condition.invert ? 'checked' : '') + ' /> Invert</label>'}
        ${root && options.showBehavior && !isNone ? `<div class="dynevt-field"><label>If unmet</label><select class="dynevt-select" data-node-cond="behavior">
            <option value="${ConditionBehavior.STALL}" ${condition.behavior === ConditionBehavior.STALL ? 'selected' : ''}>Stall</option>
            <option value="${ConditionBehavior.SKIP}" ${condition.behavior === ConditionBehavior.SKIP ? 'selected' : ''}>Skip phase</option>
        </select></div>` : ''}
        ${detail ? `<span class="dynevt-track-rule-result ${detail.result ? 'met' : 'unmet'}">${detail.result ? '✓' : '✗'} ${esc(detail.found ? JSON.stringify(detail.actual) : 'missing')}</span>` : ''}
        ${root ? '' : '<button class="dynevt-btn-icon" data-node-action="delete" title="Remove rule"><i class="fa-solid fa-trash"></i></button>'}
    </div>`;
}

export function renderConditionEditor(condition, options = {}) {
    const normalized = {
        prefix: '',
        excludeEventId: '',
        showBehavior: false,
        providerOnly: false,
        detail: null,
        ...options,
    };
    return `<div class="dynevt-condition" data-prefix="${esc(normalized.prefix)}">${renderNode(condition || createCondition(), [], normalized, normalized.detail)}</div>`;
}

export function wireConditionEditor(container, condition, onChange, options = {}) {
    const normalized = { excludeEventId: '', showBehavior: false, providerOnly: false, ...options };
    const rerender = () => {
        const parent = container.parentElement;
        const prefix = container.dataset.prefix || '';
        parent.innerHTML = renderConditionEditor(condition, { ...normalized, prefix });
        wireConditionEditor(parent.querySelector('.dynevt-condition'), condition, onChange, normalized);
    };
    const commit = rerenderRequired => {
        const local = onChange?.(rerenderRequired);
        if (rerenderRequired && local !== false) rerender();
    };

    container.querySelectorAll('[data-cond-node-path]').forEach(element => {
        const path = element.dataset.condNodePath ? element.dataset.condNodePath.split('.').map(Number) : [];
        const node = conditionAt(condition, path);
        if (!node) return;
        element.querySelectorAll(':scope > [data-node-cond], :scope > .dynevt-track-condition-group-head [data-node-cond], :scope > .dynevt-field [data-node-cond], :scope > .dynevt-condition-comparison [data-node-cond], :scope > label [data-node-cond]')
            .forEach(input => {
                const handler = () => {
                    const field = input.dataset.nodeCond;
                    let rebuild = false;
                    if (field === 'type') {
                        const behavior = node.behavior || ConditionBehavior.STALL;
                        replaceNode(node, input.value === ConditionType.GROUP
                            ? createConditionGroup({ conditions: [createDefaultProviderCondition()], behavior })
                            : createCondition({ type: input.value, behavior }));
                        rebuild = true;
                    } else if (field === 'invert') node.invert = input.checked;
                    else if (field === 'targetPhase' || field === 'targetCount') node[field] = parseInt(input.value) || 0;
                    else {
                        node[field] = input.value;
                        if (field === 'targetEventId' && node.type === ConditionType.PHASE_REACHED) node.targetPhase = 0;
                        if (field === 'source') {
                            node.providerId = 'superagents';
                            const fields = describeConditionSource('superagents', node.source)?.fields || [];
                            node.path = fields.find(item => item.path.includes('$subject'))?.path || fields[0]?.path || '';
                        }
                        rebuild = ['targetEventId', 'operator', 'source'].includes(field);
                    }
                    commit(rebuild);
                };
                input.addEventListener(input.tagName === 'SELECT' || input.type === 'checkbox' ? 'change' : 'input', handler);
            });
        element.querySelectorAll(':scope > [data-node-action], :scope > .dynevt-track-condition-group-head [data-node-action]')
            .forEach(button => button.addEventListener('click', () => {
                const action = button.dataset.nodeAction;
                if (action === 'add-rule') node.conditions.push(createDefaultProviderCondition());
                if (action === 'add-group') node.conditions.push(createConditionGroup({ conditions: [createDefaultProviderCondition()] }));
                if (action === 'delete' && path.length) conditionAt(condition, path.slice(0, -1)).conditions.splice(path.at(-1), 1);
                commit(true);
            }));
    });
}

// Compatibility facade for the Event/Script editors while they are extracted.
export function renderConditionHTML(condition, prefix, excludeEventId = '', showBehavior = false) {
    return renderConditionEditor(condition, { prefix, excludeEventId, showBehavior });
}

export function wireConditionFields(container, condition, onSave, excludeEventId = '') {
    return wireConditionEditor(container, condition, () => { onSave(); }, {
        excludeEventId,
        showBehavior: Boolean(container.querySelector('[data-node-cond="behavior"]')),
    });
}

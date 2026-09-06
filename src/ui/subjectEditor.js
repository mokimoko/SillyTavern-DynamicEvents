import { ConditionType } from '../../eventEngine.js';
import { describeConditionSource, listConditionSources } from '../conditions/providers.js';
import { SubjectMode, createSubject } from '../subjects/subjects.js';

function esc(value) {
    const element = document.createElement('div');
    element.textContent = String(value ?? '');
    return element.innerHTML;
}

function walkConditions(condition, callback) {
    if (!condition) return;
    callback(condition);
    if (condition.type === ConditionType.GROUP) {
        for (const child of condition.conditions || []) walkConditions(child, callback);
    }
}

export function availableSubjectsFromConditions(conditions = []) {
    const subjects = new Set();
    for (const condition of conditions) {
        walkConditions(condition, node => {
            if (node.type !== ConditionType.PROVIDER_STATE || !node.source) return;
            for (const collection of describeConditionSource(
                node.providerId || 'superagents',
                node.source,
            )?.collections || []) {
                for (const subject of collection.subjects || []) subjects.add(subject);
            }
        });
    }
    return [...subjects].sort((a, b) => a.localeCompare(b));
}

function endpointFields(description, collectionPath) {
    const prefix = collectionPath ? `${collectionPath}.$subject.` : '$subject.';
    return (description?.fields || [])
        .filter(field => field.path?.startsWith(prefix)
            && (field.type === 'string' || field.type?.includes?.('string')))
        .map(field => ({ ...field, relativePath: field.path.slice(prefix.length) }));
}

function endpointOptions(fields, selected, emptyLabel) {
    const options = [{ relativePath: '', label: emptyLabel }, ...fields];
    if (selected && !options.some(option => option.relativePath === selected)) {
        options.push({ relativePath: selected, label: `${selected} (unavailable)` });
    }
    return options.map(option => `<option value="${esc(option.relativePath)}" ${option.relativePath === selected ? 'selected' : ''}>${esc(option.label || option.relativePath)}</option>`).join('');
}

export function renderSubjectEditor(subject, {
    id,
    label = 'Narrative subject',
    hint = 'Independent of the Event Set card binding. Use the actual narrative character name stored by SuperAgents.',
    suggestions = [],
    allowStateSource = false,
} = {}) {
    const binding = createSubject(subject);
    const listId = `dynevt-subjects-${id || 'editor'}`;
    const showStateSource = allowStateSource || binding.mode === SubjectMode.STATE_SOURCE;
    const sources = listConditionSources(binding.providerId || 'superagents');
    if (binding.source && !sources.some(source => source.id === binding.source)) {
        sources.push({ id: binding.source, label: `${binding.source} (unavailable)` });
    }
    const source = binding.source || sources[0]?.id || '';
    const description = describeConditionSource(binding.providerId || 'superagents', source);
    const collections = description?.collections || [];
    const collectionPath = binding.collectionPath || collections[0]?.path || '';
    const endpoints = endpointFields(description, collectionPath);
    const needsValue = binding.mode === SubjectMode.TRACKED || binding.mode === SubjectMode.MANUAL;
    const needsSource = binding.mode === SubjectMode.STATE_SOURCE;
    return `
        <div class="dynevt-track-subject-box" data-subject-editor>
            <div class="dynevt-subject-fields">
                <div class="dynevt-field"><label>${esc(label)}</label><select class="dynevt-select" data-subject-field="mode">
                    <option value="${SubjectMode.ACTIVE_CARD}" ${binding.mode === SubjectMode.ACTIVE_CARD ? 'selected' : ''}>Active card / current group speaker</option>
                    <option value="${SubjectMode.TRACKED}" ${binding.mode === SubjectMode.TRACKED ? 'selected' : ''}>Choose tracked narrative character</option>
                    <option value="${SubjectMode.MANUAL}" ${binding.mode === SubjectMode.MANUAL ? 'selected' : ''}>Manual state key</option>
                    ${showStateSource ? `<option value="${SubjectMode.STATE_SOURCE}" ${needsSource ? 'selected' : ''}>Choose an eligible state entry at runtime</option>` : ''}
                </select></div>
                <div class="dynevt-field dynevt-field-grow ${needsValue ? '' : 'hidden'}" data-subject-value-wrap>
                    <label>Subject key</label><input class="dynevt-input" list="${listId}" data-subject-field="value" value="${esc(binding.value)}" placeholder="Narrative character name exactly as tracked" />
                    <datalist id="${listId}">${suggestions.map(value => `<option value="${esc(value)}"></option>`).join('')}</datalist>
                </div>
                ${showStateSource ? `<div class="dynevt-field ${needsSource ? '' : 'hidden'}" data-subject-source-wrap>
                    <label>Runtime state source</label><select class="dynevt-select" data-subject-field="source">
                        ${sources.map(item => `<option value="${esc(item.id)}" ${item.id === source ? 'selected' : ''}>${esc(item.label || item.id)}</option>`).join('')}
                    </select>
                </div>
                <div class="dynevt-field ${needsSource ? '' : 'hidden'}" data-subject-source-wrap>
                    <label>Eligible collection</label><select class="dynevt-select" data-subject-field="collectionPath">
                        ${collections.map(collection => `<option value="${esc(collection.path)}" ${collection.path === collectionPath ? 'selected' : ''}>${esc(collection.label || collection.path)}</option>`).join('')}
                    </select>
                </div>
                <div class="dynevt-field ${needsSource ? '' : 'hidden'}" data-subject-source-wrap>
                    <label>Narrative subject field</label><select class="dynevt-select" data-subject-field="subjectPath">
                        ${endpointOptions(endpoints, binding.subjectPath, '(collection key)')}
                    </select>
                </div>
                <div class="dynevt-field ${needsSource ? '' : 'hidden'}" data-subject-source-wrap>
                    <label>Counterpart field</label><select class="dynevt-select" data-subject-field="counterpartPath">
                        ${endpointOptions(endpoints, binding.counterpartPath, '(none)')}
                    </select>
                </div>` : ''}
            </div>
            <div class="dynevt-hint">${esc(hint)}</div>
        </div>`;
}

export function wireSubjectEditor(container, owner, callbacks = {}) {
    owner.subject = createSubject(owner.subject);
    const editor = container.querySelector(':scope [data-subject-editor]');
    const sourceSelect = editor?.querySelector('[data-subject-field="source"]');
    const collectionSelect = editor?.querySelector('[data-subject-field="collectionPath"]');
    const refreshCollections = () => {
        if (!collectionSelect || !owner.subject.source) return;
        const collections = describeConditionSource(
            owner.subject.providerId || 'superagents',
            owner.subject.source,
        )?.collections || [];
        const current = owner.subject.collectionPath;
        collectionSelect.replaceChildren(...collections.map(collection => {
            const option = document.createElement('option');
            option.value = collection.path;
            option.textContent = collection.label || collection.path;
            return option;
        }));
        owner.subject.collectionPath = collections.some(collection => collection.path === current)
            ? current
            : collections[0]?.path || '';
        collectionSelect.value = owner.subject.collectionPath;
    };
    const syncStateSourceDefaults = () => {
        if (owner.subject.mode !== SubjectMode.STATE_SOURCE) return;
        if (!owner.subject.source) owner.subject.source = sourceSelect?.value || '';
        if (!owner.subject.collectionPath) owner.subject.collectionPath = collectionSelect?.value || '';
    };
    const updateVisibility = () => {
        const needsValue = owner.subject.mode === SubjectMode.TRACKED || owner.subject.mode === SubjectMode.MANUAL;
        editor?.querySelector('[data-subject-value-wrap]')?.classList.toggle('hidden', !needsValue);
        editor?.querySelectorAll('[data-subject-source-wrap]')
            .forEach(element => element.classList.toggle('hidden', owner.subject.mode !== SubjectMode.STATE_SOURCE));
    };
    container.querySelectorAll(':scope [data-subject-editor] [data-subject-field]').forEach(input => {
        input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', () => {
            owner.subject[input.dataset.subjectField] = input.value;
            if (input.dataset.subjectField === 'source') refreshCollections();
            syncStateSourceDefaults();
            updateVisibility();
            callbacks.changed?.(input.tagName === 'SELECT');
        });
    });
    syncStateSourceDefaults();
    updateVisibility();
}

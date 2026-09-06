import {
    ActionRecipientMode,
    DynamicActionType,
    FeedActionBehavior,
    PhoneActionBehavior,
    createDynamicAction,
} from '../actions/actionTypes.js';

function esc(value) {
    const div = document.createElement('div');
    div.textContent = value ?? '';
    return div.innerHTML;
}

function actionPresentation(kind) {
    const api = globalThis.SuperAgents?.integration?.presentation;
    if (api?.apiVersion < 1) return null;
    try { return api?.getAction?.(kind) || null; } catch { return null; }
}

function surfacePresentation(kind) {
    const api = globalThis.SuperAgents?.integration?.presentation;
    if (api?.apiVersion < 1) return null;
    try { return api?.getSurface?.(kind) || null; } catch { return null; }
}

function actionCard(action, index, { allowSubject, allowCounterpart, subjectLabel, phoneAvailable, feedAvailable }) {
    const isFeed = action.type === DynamicActionType.FEED;
    const available = isFeed ? feedAvailable : phoneAvailable;
    const manual = action.recipient?.mode === ActionRecipientMode.MANUAL;
    const kind = isFeed ? 'feed' : 'phone';
    const presentation = actionPresentation(kind) || {};
    const phoneSurface = surfacePresentation('phone') || {};
    const feedSurface = surfacePresentation('feed') || {};
    const label = presentation.label || (isFeed ? 'Feed post' : 'Phone message');
    const status = available
        ? (presentation.ready || `${presentation.serviceLabel || label} ready`)
        : (presentation.unavailable || `${presentation.serviceLabel || label} unavailable`);
    const behaviorOptions = isFeed
        ? `<option value="${FeedActionBehavior.CONSIDER}" ${action.behavior !== FeedActionBehavior.PUBLISH ? 'selected' : ''}>${esc(presentation.behaviors?.consider || 'Consider posting')}</option>
           <option value="${FeedActionBehavior.PUBLISH}" ${action.behavior === FeedActionBehavior.PUBLISH ? 'selected' : ''}>${esc(presentation.behaviors?.publish || 'Must publish')}</option>`
        : `<option value="${PhoneActionBehavior.CONSIDER}" ${action.behavior !== PhoneActionBehavior.SEND ? 'selected' : ''}>${esc(presentation.behaviors?.consider || 'Consider texting')}</option>
           <option value="${PhoneActionBehavior.SEND}" ${action.behavior === PhoneActionBehavior.SEND ? 'selected' : ''}>${esc(presentation.behaviors?.send || 'Must send')}</option>`;

    return `<div class="dynevt-action-card" data-action-index="${index}">
        <div class="dynevt-action-card-head">
            <label class="dynevt-toggle-label"><input type="checkbox" data-action-field="enabled" ${action.enabled !== false ? 'checked' : ''} /> Enabled</label>
            <strong>${esc(label)}</strong>
            <span class="dynevt-action-availability ${available ? 'available' : ''}">${esc(status)}</span>
            <button class="dynevt-btn-icon" data-action-command="delete" title="Delete action"><i class="fa-solid fa-trash"></i></button>
        </div>
        <div class="dynevt-editor-row">
            <div class="dynevt-field"><label>Surface</label><select class="dynevt-select" data-action-field="type">
                <option value="${DynamicActionType.PHONE}" ${!isFeed ? 'selected' : ''}>${esc(phoneSurface.label || 'Phone')}</option>
                <option value="${DynamicActionType.FEED}" ${isFeed ? 'selected' : ''}>${esc(feedSurface.label || 'Feed')}</option>
            </select></div>
            <div class="dynevt-field"><label>${esc(presentation.behaviorLabel || (isFeed ? 'Publication' : 'Delivery'))}</label><select class="dynevt-select" data-action-field="behavior">${behaviorOptions}</select></div>
            <div class="dynevt-field"><label>${esc(presentation.recipientLabel || (isFeed ? 'Author' : 'Recipient'))}</label><select class="dynevt-select" data-action-field="recipient.mode">
                ${allowSubject ? `<option value="${ActionRecipientMode.SUBJECT}" ${[ActionRecipientMode.SUBJECT, ActionRecipientMode.TRACK_SUBJECT].includes(action.recipient?.mode) ? 'selected' : ''}>${esc(subjectLabel)}</option>` : ''}
                ${allowCounterpart ? `<option value="${ActionRecipientMode.COUNTERPART}" ${action.recipient?.mode === ActionRecipientMode.COUNTERPART ? 'selected' : ''}>This Event's counterpart</option>` : ''}
                <option value="${ActionRecipientMode.ACTIVE_CHARACTER}" ${action.recipient?.mode === ActionRecipientMode.ACTIVE_CHARACTER ? 'selected' : ''}>Active character / speaker</option>
                <option value="${ActionRecipientMode.MANUAL}" ${manual ? 'selected' : ''}>Named character</option>
            </select></div>
            <div class="dynevt-field dynevt-field-grow ${manual ? '' : 'hidden'}" data-action-manual-recipient><label>Character name</label>
                <input class="dynevt-input" data-action-field="recipient.value" value="${esc(action.recipient?.value || '')}" placeholder="Exact character name" /></div>
        </div>
        <div class="dynevt-field"><label>${esc(presentation.reasonLabel || 'Reason / cue')}</label>
            <textarea class="dynevt-textarea" rows="3" data-action-field="reason" placeholder="${esc(presentation.reasonPlaceholder || `Why might this character ${isFeed ? 'share something' : 'text now'}?`)}">${esc(action.reason || '')}</textarea></div>
    </div>`;
}

export function renderActionEditor(actions, { title = 'Actions', allowSubject = false, allowCounterpart = false, subjectLabel = 'This component\'s subject' } = {}) {
    const phoneAvailable = Boolean(globalThis.SuperAgents?.integration?.phone?.isEnabled?.());
    const feedAvailable = Boolean(globalThis.SuperAgents?.integration?.feed?.isEnabled?.());
    const options = { allowSubject, allowCounterpart, subjectLabel, phoneAvailable, feedAvailable };
    return `
        <div class="dynevt-action-editor">
            <div class="dynevt-section-label">
                ${esc(title)}
                <button class="dynevt-btn dynevt-btn-sm" data-action-command="add"><i class="fa-solid fa-plus"></i> Action</button>
            </div>
            <div class="dynevt-hint">Actions ask a configured SuperAgents surface to respond in character. “Consider” may withhold; required delivery retries once.</div>
            <div class="dynevt-action-list">
                ${(actions || []).map((action, index) => actionCard(action, index, options)).join('') || '<div class="dynevt-empty">No actions. The ordinary prompt injection still works as before.</div>'}
            </div>
        </div>`;
}

function setPath(root, path, value) {
    const parts = path.split('.');
    let target = root;
    for (const part of parts.slice(0, -1)) target = target[part] ||= {};
    target[parts.at(-1)] = value;
}

export function wireActionEditor(container, owner, property, callbacks, { allowSubject = false } = {}) {
    owner[property] ||= [];
    container.querySelector('[data-action-command="add"]')?.addEventListener('click', () => {
        owner[property].push(createDynamicAction({
            recipient: {
                mode: allowSubject ? ActionRecipientMode.SUBJECT : ActionRecipientMode.ACTIVE_CHARACTER,
                value: '',
            },
        }));
        callbacks.changed(true);
    });

    container.querySelectorAll('[data-action-index]').forEach(card => {
        const action = owner[property][Number(card.dataset.actionIndex)];
        if (!action) return;
        card.querySelector('[data-action-command="delete"]')?.addEventListener('click', () => {
            owner[property].splice(Number(card.dataset.actionIndex), 1);
            callbacks.changed(true);
        });
        card.querySelectorAll('[data-action-field]').forEach(input => {
            const eventName = input.tagName === 'SELECT' || input.type === 'checkbox' ? 'change' : 'input';
            input.addEventListener(eventName, () => {
                const value = input.type === 'checkbox' ? input.checked : input.value;
                setPath(action, input.dataset.actionField, value);
                if (input.dataset.actionField === 'type') {
                    action.behavior = value === DynamicActionType.FEED
                        ? FeedActionBehavior.CONSIDER
                        : PhoneActionBehavior.CONSIDER;
                }
                callbacks.changed(['type', 'recipient.mode'].includes(input.dataset.actionField));
            });
        });
    });
}

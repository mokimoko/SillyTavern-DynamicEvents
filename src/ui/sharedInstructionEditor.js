import { createSharedInstruction } from '../../eventEngine.js';

const esc = value => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

export function renderSharedInstructionPicker(set, event) {
    const blocks = set.sharedInstructions || [];
    const attached = new Set(event.sharedInstructionIds || []);
    return `
        <div class="dynevt-section-label dynevt-shared-heading">
            <span><i class="fa-solid fa-layer-group"></i> Shared Instructions</span>
            <button type="button" class="dynevt-btn dynevt-btn-sm" data-action="manage-shared-instructions">
                <i class="fa-solid fa-pen"></i> Manage
            </button>
        </div>
        <div class="dynevt-shared-picker">
            ${blocks.length ? blocks.map(block => `
                <label class="dynevt-shared-choice" title="${esc(block.text)}">
                    <input type="checkbox" data-shared-id="${esc(block.id)}" ${attached.has(block.id) ? 'checked' : ''} />
                    <span>${esc(block.name || 'Shared Instruction')}</span>
                </label>
            `).join('') : '<div class="dynevt-hint">No shared instructions in this Event Set yet.</div>'}
        </div>
        <div class="dynevt-hint">Attached blocks are inserted once per injection destination when linked Events fire together. Keep Event-specific subject details in Event Text.</div>
    `;
}

export function wireSharedInstructionPicker(container, set, event, services = {}) {
    event.sharedInstructionIds = Array.isArray(event.sharedInstructionIds) ? event.sharedInstructionIds : [];
    container.querySelectorAll('[data-shared-id]').forEach(input => {
        input.addEventListener('change', function () {
            const ids = new Set(event.sharedInstructionIds);
            if (this.checked) ids.add(this.dataset.sharedId);
            else ids.delete(this.dataset.sharedId);
            event.sharedInstructionIds = [...ids];
            services.changed?.();
        });
    });
    container.querySelector('[data-action="manage-shared-instructions"]')?.addEventListener('click', () => {
        openSharedInstructionManager(set, services);
    });
}

export function openSharedInstructionManager(set, services = {}) {
    document.getElementById('dynevt-shared-overlay')?.remove();
    set.sharedInstructions = Array.isArray(set.sharedInstructions) ? set.sharedInstructions : [];

    const overlay = document.createElement('div');
    overlay.id = 'dynevt-shared-overlay';
    overlay.className = 'dynevt-confirm-overlay dynevt-shared-overlay';
    document.body.appendChild(overlay);

    const usageCount = id => (set.events || [])
        .filter(event => (event.sharedInstructionIds || []).includes(id)).length;

    const close = () => {
        overlay.classList.remove('dynevt-visible');
        setTimeout(() => overlay.remove(), 200);
        services.closed?.();
    };

    const render = () => {
        overlay.innerHTML = `
            <div class="dynevt-confirm-box dynevt-shared-box">
                <div class="dynevt-shared-manager-header">
                    <div>
                        <div class="dynevt-confirm-msg">Shared Instructions</div>
                        <div class="dynevt-hint">Reusable guidance for Events in “${esc(set.name)}”.</div>
                    </div>
                    <button type="button" class="dynevt-btn-icon" data-action="close-shared" title="Close"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="dynevt-shared-list">
                    ${set.sharedInstructions.length ? set.sharedInstructions.map(block => `
                        <div class="dynevt-shared-block" data-block-id="${esc(block.id)}">
                            <div class="dynevt-shared-block-header">
                                <input type="text" class="dynevt-input" data-field="name" value="${esc(block.name)}" placeholder="Instruction name" />
                                <span class="dynevt-shared-usage">Used by ${usageCount(block.id)} Event${usageCount(block.id) === 1 ? '' : 's'}</span>
                                <button type="button" class="dynevt-btn-icon dynevt-danger" data-action="delete-shared" title="Delete"><i class="fa-solid fa-trash"></i></button>
                            </div>
                            <textarea class="dynevt-textarea" data-field="text" rows="5" placeholder="Reusable guidance…">${esc(block.text)}</textarea>
                        </div>
                    `).join('') : '<div class="dynevt-empty">No shared instructions yet.</div>'}
                </div>
                <div class="dynevt-shared-manager-actions">
                    <button type="button" class="dynevt-btn dynevt-btn-accent" data-action="add-shared"><i class="fa-solid fa-plus"></i> Shared Instruction</button>
                    <button type="button" class="dynevt-btn" data-action="close-shared">Done</button>
                </div>
            </div>
        `;

        overlay.querySelectorAll('.dynevt-shared-block').forEach(row => {
            const block = set.sharedInstructions.find(item => item.id === row.dataset.blockId);
            if (!block) return;
            row.querySelector('[data-field="name"]')?.addEventListener('input', function () {
                block.name = this.value;
                services.changed?.();
            });
            row.querySelector('[data-field="text"]')?.addEventListener('input', function () {
                block.text = this.value;
                services.changed?.();
            });
            row.querySelector('[data-action="delete-shared"]')?.addEventListener('click', async () => {
                const count = usageCount(block.id);
                const message = count
                    ? `Delete “${block.name}” and detach it from ${count} Event${count === 1 ? '' : 's'}?`
                    : `Delete “${block.name}”?`;
                if (services.confirm && !await services.confirm(message)) return;
                set.sharedInstructions = set.sharedInstructions.filter(item => item.id !== block.id);
                for (const event of set.events || []) {
                    event.sharedInstructionIds = (event.sharedInstructionIds || []).filter(id => id !== block.id);
                }
                services.changed?.();
                render();
            });
        });
        overlay.querySelector('[data-action="add-shared"]')?.addEventListener('click', () => {
            set.sharedInstructions.push(createSharedInstruction());
            services.changed?.();
            render();
            overlay.querySelector('.dynevt-shared-block:last-child input')?.focus();
        });
        overlay.querySelectorAll('[data-action="close-shared"]').forEach(button => button.addEventListener('click', close));
    };

    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    render();
    requestAnimationFrame(() => overlay.classList.add('dynevt-visible'));
}


const escapeHtml = value => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

export function dynevtConfirm(message, {
    confirmText = 'Delete',
    cancelText = 'Cancel',
    danger = true,
} = {}) {
    return new Promise(resolve => {
        document.getElementById('dynevt-confirm-overlay')?.remove();

        const overlay = document.createElement('div');
        overlay.id = 'dynevt-confirm-overlay';
        overlay.className = 'dynevt-confirm-overlay';
        overlay.innerHTML = `
            <div class="dynevt-confirm-box">
                <div class="dynevt-confirm-msg">${escapeHtml(message)}</div>
                <div class="dynevt-confirm-buttons">
                    <button class="dynevt-btn" id="dynevt-confirm-cancel">${escapeHtml(cancelText)}</button>
                    <button class="dynevt-btn ${danger ? 'dynevt-btn-danger' : 'dynevt-btn-accent'}" id="dynevt-confirm-ok">${escapeHtml(confirmText)}</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('dynevt-visible'));

        const cleanup = result => {
            overlay.classList.remove('dynevt-visible');
            setTimeout(() => overlay.remove(), 200);
            resolve(result);
        };

        overlay.querySelector('#dynevt-confirm-ok').addEventListener('click', () => cleanup(true));
        overlay.querySelector('#dynevt-confirm-cancel').addEventListener('click', () => cleanup(false));
        overlay.addEventListener('click', event => {
            if (event.target === overlay) cleanup(false);
        });
    });
}

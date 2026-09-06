import {
    charLabelForBinding,
    getAvailableTags,
    getCharacterList,
    tagLabelById,
} from '../runtime/bindingContext.js';

function esc(value) {
    const element = document.createElement('div');
    element.textContent = String(value ?? '');
    return element.innerHTML;
}

export function renderCharPicker(set) {
    const characters = getCharacterList();
    const bindings = set.characterBindings || [];
    const pills = bindings.map(binding =>
        `<span class="dynevt-char-pill" data-binding="${esc(binding)}">${esc(charLabelForBinding(binding, characters))}<span class="dynevt-char-pill-x">&times;</span></span>`).join('');
    return `<div class="dynevt-char-picker" id="dynevt-char-picker">
        <div class="dynevt-char-pills">${pills}<input type="text" class="dynevt-char-search" id="dynevt-char-search"
            placeholder="${bindings.length ? '' : 'Type to search characters...'}" autocomplete="off" /></div>
        <div class="dynevt-char-dropdown" id="dynevt-char-dropdown"></div>
    </div>`;
}

export function wireCharPicker(panel, set, onChanged) {
    const picker = panel.querySelector('#dynevt-char-picker');
    if (!picker) return;
    const searchInput = picker.querySelector('#dynevt-char-search');
    const dropdown = picker.querySelector('#dynevt-char-dropdown');
    if (!searchInput || !dropdown) return;
    const characters = getCharacterList().filter(character => character.avatar);
    const isBound = avatar => set.characterBindings.some(binding => binding.toLowerCase() === avatar.toLowerCase());
    const changed = () => onChanged?.();

    const refreshPills = () => {
        const container = picker.querySelector('.dynevt-char-pills');
        container.querySelectorAll('.dynevt-char-pill').forEach(pill => pill.remove());
        set.characterBindings.forEach(binding => {
            const pill = document.createElement('span');
            pill.className = 'dynevt-char-pill';
            pill.dataset.binding = binding;
            pill.innerHTML = `${esc(charLabelForBinding(binding, characters))}<span class="dynevt-char-pill-x">&times;</span>`;
            pill.querySelector('.dynevt-char-pill-x').addEventListener('click', () => {
                set.characterBindings = set.characterBindings.filter(item => item !== binding);
                changed();
                refreshPills();
            });
            container.insertBefore(pill, searchInput);
        });
        searchInput.placeholder = set.characterBindings.length ? '' : 'Type to search characters...';
    };

    const showDropdown = (filter = '') => {
        const normalized = filter.toLowerCase();
        const available = characters.filter(character => {
            if (isBound(character.avatar)) return false;
            if (!filter) return true;
            const avatar = character.avatar.replace(/\.[^.]+$/, '');
            return character.name.toLowerCase().includes(normalized) || avatar.toLowerCase().includes(normalized);
        });
        if (!filter && available.length > 20) {
            dropdown.innerHTML = '';
            dropdown.classList.remove('visible');
            return;
        }
        if (!available.length) {
            dropdown.innerHTML = filter ? '<div class="dynevt-char-no-match">No matching characters</div>' : '';
            dropdown.classList.toggle('visible', Boolean(filter));
            return;
        }
        dropdown.innerHTML = available.slice(0, 15).map(character => {
            const avatar = character.avatar.replace(/\.[^.]+$/, '');
            return `<div class="dynevt-char-option" data-avatar="${esc(character.avatar)}">${esc(character.name)}${avatar ? ` <span class="dynevt-char-avatar">(${esc(avatar)})</span>` : ''}</div>`;
        }).join('');
        dropdown.classList.add('visible');
        dropdown.querySelectorAll('.dynevt-char-option').forEach(option => {
            option.addEventListener('mousedown', event => {
                event.preventDefault();
                const avatar = option.dataset.avatar;
                if (avatar && !isBound(avatar)) { set.characterBindings.push(avatar); changed(); }
                searchInput.value = '';
                refreshPills();
                showDropdown('');
                searchInput.focus();
            });
        });
    };

    searchInput.addEventListener('input', () => showDropdown(searchInput.value));
    searchInput.addEventListener('focus', () => showDropdown(searchInput.value));
    searchInput.addEventListener('blur', () => setTimeout(() => dropdown.classList.remove('visible'), 150));
    searchInput.addEventListener('keydown', event => {
        if (event.key === 'Backspace' && !searchInput.value && set.characterBindings.length) {
            set.characterBindings.pop();
            changed();
            refreshPills();
        }
    });
    picker.querySelectorAll('.dynevt-char-pill-x').forEach(remove => {
        remove.addEventListener('click', () => {
            const binding = remove.closest('.dynevt-char-pill').dataset.binding;
            set.characterBindings = set.characterBindings.filter(item => item !== binding);
            changed();
            refreshPills();
        });
    });
}

export function renderTagPicker(set) {
    const bindings = set.tagBindings || [];
    const pills = bindings.map(id =>
        `<span class="dynevt-char-pill dynevt-tag-pill" data-tagid="${esc(id)}">${esc(tagLabelById(id))}<span class="dynevt-char-pill-x">&times;</span></span>`).join('');
    return `<div class="dynevt-char-picker" id="dynevt-tag-picker">
        <div class="dynevt-char-pills">${pills}<input type="text" class="dynevt-char-search" id="dynevt-tag-search"
            placeholder="${bindings.length ? '' : 'Type to search tags...'}" autocomplete="off" /></div>
        <div class="dynevt-char-dropdown" id="dynevt-tag-dropdown"></div>
    </div>`;
}

export function wireTagPicker(panel, set, onChanged) {
    const picker = panel.querySelector('#dynevt-tag-picker');
    if (!picker) return;
    const searchInput = picker.querySelector('#dynevt-tag-search');
    const dropdown = picker.querySelector('#dynevt-tag-dropdown');
    if (!searchInput || !dropdown) return;
    if (!Array.isArray(set.tagBindings)) set.tagBindings = [];
    const tags = getAvailableTags().filter(tag => tag?.id && tag?.name);
    const isBound = id => set.tagBindings.includes(id);
    const changed = () => onChanged?.();

    const refreshPills = () => {
        const container = picker.querySelector('.dynevt-char-pills');
        container.querySelectorAll('.dynevt-char-pill').forEach(pill => pill.remove());
        set.tagBindings.forEach(id => {
            const pill = document.createElement('span');
            pill.className = 'dynevt-char-pill dynevt-tag-pill';
            pill.dataset.tagid = id;
            pill.innerHTML = `${esc(tagLabelById(id))}<span class="dynevt-char-pill-x">&times;</span>`;
            pill.querySelector('.dynevt-char-pill-x').addEventListener('click', () => {
                set.tagBindings = set.tagBindings.filter(item => item !== id);
                changed();
                refreshPills();
            });
            container.insertBefore(pill, searchInput);
        });
        searchInput.placeholder = set.tagBindings.length ? '' : 'Type to search tags...';
    };

    const showDropdown = (filter = '') => {
        const normalized = filter.toLowerCase();
        const available = tags.filter(tag => !isBound(tag.id) && (!filter || tag.name.toLowerCase().includes(normalized)));
        if (!filter && available.length > 20) {
            dropdown.innerHTML = '';
            dropdown.classList.remove('visible');
            return;
        }
        if (!available.length) {
            dropdown.innerHTML = filter ? '<div class="dynevt-char-no-match">No matching tags</div>' : '';
            dropdown.classList.toggle('visible', Boolean(filter));
            return;
        }
        dropdown.innerHTML = available.slice(0, 15).map(tag =>
            `<div class="dynevt-char-option" data-tagid="${esc(tag.id)}">${esc(tag.name)}</div>`).join('');
        dropdown.classList.add('visible');
        dropdown.querySelectorAll('.dynevt-char-option').forEach(option => {
            option.addEventListener('mousedown', event => {
                event.preventDefault();
                const id = option.dataset.tagid;
                if (id && !isBound(id)) { set.tagBindings.push(id); changed(); }
                searchInput.value = '';
                refreshPills();
                showDropdown('');
                searchInput.focus();
            });
        });
    };

    searchInput.addEventListener('input', () => showDropdown(searchInput.value));
    searchInput.addEventListener('focus', () => showDropdown(searchInput.value));
    searchInput.addEventListener('blur', () => setTimeout(() => dropdown.classList.remove('visible'), 150));
    searchInput.addEventListener('keydown', event => {
        if (event.key === 'Backspace' && !searchInput.value && set.tagBindings.length) {
            set.tagBindings.pop();
            changed();
            refreshPills();
        }
    });
    picker.querySelectorAll('.dynevt-char-pill-x').forEach(remove => {
        remove.addEventListener('click', () => {
            const id = remove.closest('.dynevt-char-pill').dataset.tagid;
            set.tagBindings = set.tagBindings.filter(item => item !== id);
            changed();
            refreshPills();
        });
    });
}

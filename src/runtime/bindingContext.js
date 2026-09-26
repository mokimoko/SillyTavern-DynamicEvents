import { characters, this_chid } from '../../../../../../script.js';
import { getContext } from '../../../../../extensions.js';
import { tags as stTags, tag_map as stTagMap } from '../../../../../tags.js';
import { BindMode } from '../../eventEngine.js';

/** Resolve the active card or enabled group members and their native tags. */
export function getBindingContext() {
    const ctx = getContext();
    const groupId = ctx.groupId ? String(ctx.groupId) : '';
    let avatar = '';
    let charName = '';
    if (this_chid !== undefined && characters[this_chid]) {
        avatar = characters[this_chid].avatar || '';
        charName = characters[this_chid].name || '';
    }

    const group = groupId && Array.isArray(ctx.groups)
        ? ctx.groups.find(item => String(item?.id) === groupId)
        : null;
    const disabled = new Set(group?.disabled_members || []);
    const cards = Array.isArray(ctx.characters) ? ctx.characters : characters;
    const groupMembers = (group?.members || [])
        .filter(memberAvatar => !disabled.has(memberAvatar))
        .map(memberAvatar => {
            const card = cards.find(item => item?.avatar === memberAvatar);
            return { avatar: memberAvatar, charName: card?.name || '' };
        });

    const tagIds = new Set();
    const addTags = entityId => {
        if (entityId && Array.isArray(stTagMap?.[entityId])) {
            for (const id of stTagMap[entityId]) tagIds.add(id);
        }
    };
    if (groupId) {
        addTags(groupId);
        for (const member of groupMembers) addTags(member.avatar);
    } else {
        addTags(avatar);
    }
    return { charName, avatar, groupId, groupMembers, tagIds: [...tagIds] };
}

/** Sorted unique character cards for binding pickers and migrations. */
export function getCharacterList() {
    const seen = new Set();
    const list = [];
    for (const character of characters || []) {
        if (!character?.name) continue;
        const key = `${character.name}|||${character.avatar || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        list.push({ name: character.name, avatar: character.avatar || '' });
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
}

export function getAvailableTags() {
    return [...(stTags || [])].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

export function tagLabelById(id) {
    const tag = stTags?.find(item => item.id === id);
    return tag ? tag.name : String(id || '');
}

export function charLabelForBinding(binding, allChars = getCharacterList()) {
    const normalized = String(binding || '').toLowerCase();
    const character = allChars.find(item => (item.avatar || '').toLowerCase() === normalized);
    if (!character) return String(binding || '');
    const duplicate = allChars.filter(item => item.name === character.name).length > 1;
    return duplicate ? `${character.name} (${character.avatar})` : character.name;
}

export function setBindLabel(set) {
    if (set.bindMode === BindMode.CHARACTER) {
        if (!set.characterBindings?.length) return 'unbound';
        const allChars = getCharacterList();
        return set.characterBindings.map(binding => charLabelForBinding(binding, allChars)).join(', ');
    }
    if (set.bindMode === BindMode.TAG) {
        if (!set.tagBindings?.length) return 'unbound';
        return set.tagBindings.map(tagLabelById).join(', ');
    }
    return '';
}

export function upgradeBindingToAvatar(binding, allChars) {
    const normalized = String(binding || '').toLowerCase();
    if (!normalized) return binding;
    if (allChars.some(character => (character.avatar || '').toLowerCase() === normalized)) return binding;
    const named = allChars.filter(character => (character.name || '').toLowerCase() === normalized);
    return named.length === 1 && named[0].avatar ? named[0].avatar : binding;
}

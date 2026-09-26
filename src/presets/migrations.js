export const PRESET_XML_TAG_MIGRATIONS = Object.freeze({
    'lives-beyond-the-scene': Object.freeze({
        characterInitiative: 'character_initiative',
        offscreenConsequence: 'offscreen_consequence',
        offscreenIntersection: 'offscreen_intersection',
    }),
    'staged-relationship-arc': Object.freeze({
        relationshipState: 'relationship_state',
    }),
    'layered-social-bond': Object.freeze({
        bondState: 'bond_state',
        bondTexture: 'bond_texture',
    }),
});

export const SEXUAL_AFTERMATH_SHARED_KEY = 'sexual-aftermath-guardrails';
export const SEXUAL_AFTERMATH_SHARED_ID = 'preset:aftermath-echoes:sexual-aftermath-guardrails';
export const SEXUAL_AFTERMATH_GUIDANCE = 'Continue from what actually happened after sex. DON\'T replay the encounter, invent an orgasm, or restart sex just because this fired. Never decide {{user}}\'s thoughts, satisfaction, regret, consent, dialogue, or actions. Keep established bodies, limits, protection, contraception, relationships, group participation, and setting facts intact. Sex is not automatically romantic, healing, forgiving, possessive, or life-changing. Don\'t default to cuddling, declarations, sudden tenderness, or “this changes everything.” Humor, silence, hunger, annoyance, pride, embarrassment, distance, another round, getting dressed, work, or simply moving on can all fit. If sex is still happening—or never was—don\'t force an ending. Use a small physical or practical detail that fits the current moment.';
export const SEXUAL_AFTERMATH_SHARED_TEXT = `<sexual_aftermath_guidance>\n${SEXUAL_AFTERMATH_GUIDANCE}\n</sexual_aftermath_guidance>`;

function rewriteTags(value, replacements) {
    let next = value;
    for (const [camelName, snakeName] of Object.entries(replacements)) {
        next = next
            .replaceAll(`<${camelName}`, `<${snakeName}`)
            .replaceAll(`</${camelName}>`, `</${snakeName}>`);
    }
    return next;
}

function migrateValue(value, replacements) {
    if (typeof value === 'string') return rewriteTags(value, replacements);
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index++) {
            value[index] = migrateValue(value[index], replacements);
        }
        return value;
    }
    for (const key of Object.keys(value)) value[key] = migrateValue(value[key], replacements);
    return value;
}

export function migratePresetXmlTags(component) {
    const replacements = PRESET_XML_TAG_MIGRATIONS[component?.sourcePresetId];
    if (!replacements) return false;
    const before = JSON.stringify(component);
    migrateValue(component, replacements);
    return JSON.stringify(component) !== before;
}

/** Move the legacy repeated Aftermath footer into one reusable set-level block. */
export function migrateAftermathSharedInstructions(set) {
    let changed = false;
    let linked = false;
    const legacySuffix = `\n\n${SEXUAL_AFTERMATH_GUIDANCE}\n</sexual_aftermath>`;
    for (const event of set?.events || []) {
        if (event.sourcePresetId !== 'aftermath-echoes' || !String(event.text || '').includes(legacySuffix)) continue;
        event.text = event.text.replace(legacySuffix, '\n</sexual_aftermath>');
        event.sharedInstructionIds = Array.isArray(event.sharedInstructionIds) ? event.sharedInstructionIds : [];
        if (!event.sharedInstructionIds.includes(SEXUAL_AFTERMATH_SHARED_ID)) {
            event.sharedInstructionIds.push(SEXUAL_AFTERMATH_SHARED_ID);
        }
        linked = true;
        changed = true;
    }
    if (!linked) return changed;
    set.sharedInstructions = Array.isArray(set.sharedInstructions) ? set.sharedInstructions : [];
    if (!set.sharedInstructions.some(block => block.id === SEXUAL_AFTERMATH_SHARED_ID)) {
        set.sharedInstructions.push({
            id: SEXUAL_AFTERMATH_SHARED_ID,
            name: 'Sexual Aftermath Guardrails',
            text: SEXUAL_AFTERMATH_SHARED_TEXT,
            sourcePresetId: 'aftermath-echoes',
        });
        changed = true;
    }
    return changed;
}

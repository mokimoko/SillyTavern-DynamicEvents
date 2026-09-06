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

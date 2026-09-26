const TARGET_VERSIONS = Object.freeze({
    'erotic-sparks': 5,
    'sexual-complications': 5,
    'aftermath-echoes': 6,
    'bodies-and-pairings': 2,
    'adaptive-prompt-starter': 4,
});

const EVENT_EDITS = [
    [' The NPC may ask, offer, move closer, position themself, or make the next move, but the invitation does not decide {{user}}’s response or grant permission for anything broader.', ' The NPC may ask, offer, move closer, position themself, or make the next move within the invitation’s terms.'],
    [' A dare does not create attraction, consent, dominance, submission, or romance.', ''],
    [' Privacy creates opportunity, not consent, and it does not make the moment romantic.', ' Use the opening within their established boundaries.'],
    [' Attraction explains why they try; it does not create love, mutual feelings, a relationship, or {{user}}’s response.', ''],
    [' Jealousy does not prove love, exclusivity, ownership, moral correctness, or any right to {{user}}. Keep it specific to {{subject}} and leave every response open.', ' Keep the choice specific to {{subject}}.'],
    [' DON’T turn it into a meet-cute, invent absurd clothing failure, or force {{user}} to join in.', ' Keep the accident small and plausible.'],
    [' DON’T invent history or decide {{user}}’s participation.', ''],
    [' DON’T spring a new injury on them or treat discomfort as consent.', ''],
    [' Control over one act is not blanket dominance, submission, ownership, or consent to anything else.', ' Keep the shift limited to this act.'],
    [' Desire can be blunt, selfish, playful, technical, shy, demanding, or strange without becoming love.', ' Desire can be blunt, selfish, playful, technical, shy, demanding, or strange.'],
    [' DON’T turn normal awkwardness into humiliation, rejection, romance, or total tonal collapse.', ' Keep the response proportionate.'],
    [' DON’T explain it as love, regret, shame, healing, or a newly discovered bond.', ''],
    [' DON’T turn it into a love confession, relationship talk, automatic reassurance, or a verdict on {{user}}’s experience unless that subject was already in play.', ''],
    [' DON’T restart sex, decide {{user}}’s interest, or call continued desire love.', ''],
    [' Dominance, submission, service, vulnerability, or yielding during sex does not create ownership, obedience afterward, blanket consent, or romance.', ' Let any shift in control end or continue according to the established dynamic.'],
    [' DON’T guarantee exposure, hand out impossible knowledge, force guilt or confession, choose {{user}}’s response, or turn sexual history into automatic romance, ownership, blackmail, punishment, or a relationship milestone.', ' Keep discovery and interpretation contingent on who can encounter the trace.'],
];

const BODY_LAYER_EDITS = [
    ["Sex/desire does NOT necessarily imply romance, love, trust, healing, or commitment. Never write {{user}}'s consent, pleasure, thoughts, dialogue, or actions.", ''],
    [" Never fill in {{user}}'s consent, choices, dialogue, feelings, or physical response.", ''],
    [" Never write {{user}}'s choices or consent.", ''],
    [' Do not write {{user}} joining in or responding.', ''],
];

const ADAPTIVE_COMPACT_EDITS = [
    [' Romance does not decide {{user}}’s feelings.', ''],
    [' Tension or desire alone does not force escalation, consent, or romance.', ''],
    [' Do not force tenderness: sex is not automatically romance.', ''],
];

function applyEdits(text, edits) {
    let result = text;
    for (const [oldText, newText] of edits) result = result.replace(oldText, newText);
    return result;
}

function stripLegacyFooter(text, tag, marker) {
    const normalized = String(text || '').replace(/\r\n/g, '\n');
    const splitAt = normalized.indexOf(`\n\n${marker}`);
    if (splitAt < 0 || !normalized.trimEnd().endsWith(`</${tag}>`)) return null;
    return `${normalized.slice(0, splitAt)}\n</${tag}>`;
}

function sharedId(presetId, key) {
    return `preset:${presetId}:${key}`;
}

function updateSharedBlocks(set, preset, keys) {
    if (!keys.size) return 0;
    set.sharedInstructions ||= [];
    let changed = 0;
    for (const key of keys) {
        const definition = (preset.sharedInstructions || []).find(block => block.key === key);
        if (!definition) continue;
        const id = sharedId(preset.id, key);
        const installed = set.sharedInstructions.find(block => block.id === id);
        if (!installed) {
            set.sharedInstructions.push({
                id,
                name: definition.name,
                text: definition.text,
                sourcePresetId: preset.id,
                sourcePresetVersion: preset.version,
            });
            changed++;
        } else if (installed.text === definition.text
            || (preset.id === 'aftermath-echoes'
                && installed.text.includes('Continue from what actually happened after sex'))) {
            if (installed.text !== definition.text || installed.sourcePresetVersion !== preset.version) {
                installed.text = definition.text;
                installed.name = definition.name;
                installed.sourcePresetVersion = preset.version;
                changed++;
            }
        }
    }
    return changed;
}

/** Update only the prompt-bearing parts of known installed snapshots. */
export function syncInstalledPromptSnapshots(settings, getPreset, { adaptiveMode = 'replace' } = {}) {
    const result = { events: 0, routers: 0, shared: 0, skipped: [], changed: false };
    for (const set of settings.eventSets || []) {
        const requestedBlocks = new Map();
        for (const event of set.events || []) {
            const targetVersion = TARGET_VERSIONS[event.sourcePresetId];
            if (!targetVersion || Number(event.sourcePresetVersion) >= targetVersion) continue;
            const preset = getPreset(event.sourcePresetId);
            const definition = preset?.events?.find(item => item.name === event.name);
            if (!definition || preset.version !== targetVersion) {
                result.skipped.push(`${set.name} / ${event.name}`);
                continue;
            }
            let nextText = event.text;
            if (preset.id === 'erotic-sparks') {
                nextText = stripLegacyFooter(nextText, 'erotic_spark', "Write the NPC's opportunity or initiative");
            } else if (preset.id === 'sexual-complications') {
                nextText = stripLegacyFooter(nextText, 'sexual_complication', 'Sex is already happening.');
            } else if (preset.id === 'aftermath-echoes') {
                nextText = String(nextText || '');
            } else {
                continue;
            }
            if (nextText === null) {
                result.skipped.push(`${set.name} / ${event.name}`);
                continue;
            }
            nextText = applyEdits(nextText, EVENT_EDITS);
            event.text = nextText;
            event.sourcePresetVersion = targetVersion;
            event.sharedInstructionIds ||= [];
            for (const key of definition.sharedInstructionKeys || []) {
                const id = sharedId(preset.id, key);
                if (!event.sharedInstructionIds.includes(id)) event.sharedInstructionIds.push(id);
                if (!requestedBlocks.has(preset.id)) requestedBlocks.set(preset.id, new Set());
                requestedBlocks.get(preset.id).add(key);
            }
            result.events++;
        }
        for (const router of set.promptRouters || []) {
            const targetVersion = TARGET_VERSIONS[router.sourcePresetId];
            if (!targetVersion || Number(router.sourcePresetVersion) >= targetVersion) continue;
            const preset = getPreset(router.sourcePresetId);
            const definition = preset?.routers?.find(item => item.name === router.name);
            if (!definition || preset.version !== targetVersion) {
                result.skipped.push(`${set.name} / ${router.name}`);
                continue;
            }
            for (const layer of router.layers || []) {
                const current = definition.layers?.find(item => item.name === layer.name);
                if (!current) continue;
                if (preset.id === 'bodies-and-pairings') {
                    layer.text = applyEdits(layer.text, BODY_LAYER_EDITS);
                } else if (adaptiveMode === 'replace') {
                    layer.text = current.text;
                } else {
                    layer.text = applyEdits(layer.text, ADAPTIVE_COMPACT_EDITS);
                }
            }
            router.sourcePresetVersion = targetVersion;
            result.routers++;
        }
        for (const [presetId, keys] of requestedBlocks) {
            result.shared += updateSharedBlocks(set, getPreset(presetId), keys);
        }
        if ((set.events || []).some(event => event.sourcePresetId === 'aftermath-echoes'
            && Number(event.sourcePresetVersion) === TARGET_VERSIONS['aftermath-echoes'])) {
            const preset = getPreset('aftermath-echoes');
            result.shared += updateSharedBlocks(set, preset, new Set((preset.sharedInstructions || []).map(block => block.key)));
        }
    }
    result.changed = result.events + result.routers + result.shared > 0;
    return result;
}

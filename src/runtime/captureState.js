/** Branch-aware storage and mirroring for values captured from AI responses. */

export const CAPTURE_BASELINES_KEY = 'dynamicEventsCaptureBaselines';
export const CAPTURE_ACTIVE_KEYS_KEY = 'dynamicEventsCaptureActiveKeys';

function owns(record, key) {
    return Boolean(record && Object.prototype.hasOwnProperty.call(record, key));
}

function ensureRecord(holder, key) {
    if (!holder[key] || typeof holder[key] !== 'object' || Array.isArray(holder[key])) {
        holder[key] = {};
    }
    return holder[key];
}

function setRecordValue(record, key, value) {
    if (owns(record, key) && Object.is(record[key], value)) return false;
    Object.defineProperty(record, key, {
        value,
        writable: true,
        enumerable: true,
        configurable: true,
    });
    return true;
}

function sameKeys(left, right) {
    return left.length === right.length && left.every((key, index) => key === right[index]);
}

/** Apply the selected branch's DE-owned variables to SillyTavern metadata. */
export function restoreCapturedVariables(metadata, chatState) {
    if (!metadata) return false;
    const captures = chatState?.capturedVariables && typeof chatState.capturedVariables === 'object'
        ? chatState.capturedVariables
        : {};
    const baselines = metadata[CAPTURE_BASELINES_KEY] && typeof metadata[CAPTURE_BASELINES_KEY] === 'object'
        ? metadata[CAPTURE_BASELINES_KEY]
        : {};
    const previousKeys = Array.isArray(metadata[CAPTURE_ACTIVE_KEYS_KEY])
        ? metadata[CAPTURE_ACTIVE_KEYS_KEY]
        : [];
    const managedKeys = new Set([...Object.keys(baselines), ...previousKeys]);
    const captureKeys = Object.keys(captures).sort();
    if (!managedKeys.size && !captureKeys.length) return false;

    const variables = ensureRecord(metadata, 'variables');
    let changed = false;
    for (const key of managedKeys) {
        if (owns(captures, key)) {
            changed = setRecordValue(variables, key, captures[key]) || changed;
            continue;
        }
        const baseline = owns(baselines, key) ? baselines[key] : null;
        if (baseline?.exists) {
            changed = setRecordValue(variables, key, baseline.value) || changed;
        } else if (owns(variables, key)) {
            delete variables[key];
            changed = true;
        }
    }
    for (const key of captureKeys) {
        changed = setRecordValue(variables, key, captures[key]) || changed;
    }
    if (!sameKeys(previousKeys, captureKeys)) {
        metadata[CAPTURE_ACTIVE_KEYS_KEY] = captureKeys;
        changed = true;
    }
    return changed;
}

/** Merge new captures into a runtime snapshot, retaining pre-DE values. */
export function recordCapturedVariables(metadata, chatState, capturedValues) {
    if (!metadata || !chatState || !capturedValues) return false;
    const variables = ensureRecord(metadata, 'variables');
    const baselines = ensureRecord(metadata, CAPTURE_BASELINES_KEY);
    const captures = ensureRecord(chatState, 'capturedVariables');
    let changed = false;

    for (const [key, value] of Object.entries(capturedValues)) {
        if (!owns(baselines, key)) {
            setRecordValue(baselines, key, {
                exists: owns(variables, key),
                value: owns(variables, key) ? variables[key] : null,
            });
            changed = true;
        }
        changed = setRecordValue(captures, key, value) || changed;
    }
    return restoreCapturedVariables(metadata, chatState) || changed;
}

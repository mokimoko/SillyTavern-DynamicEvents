import {
    BindMode,
    ConditionGroupOperator,
    ConditionType,
    EventCategory,
    InjectionMode,
    PromptPosition,
    PromptRole,
    ScheduleType,
    SetRole,
    createCondition,
    createConditionGroup,
    createEvent,
    createEventSet,
    createPhase,
} from '../../eventEngine.js';
import { SubjectMode, createSubject } from '../subjects/subjects.js';
import {
    TrackTransitionMode,
    createStateTrack,
    createTrackState,
    createTrackSubject,
} from '../tracks/stateTracks.js';
import {
    PromptRouterMode,
    createPromptLayer,
    createPromptRouter,
} from '../routers/promptRouters.js';
import { normalizeDynamicActions } from '../actions/actionTypes.js';

const SYSTEM_IN_CHAT = Object.freeze({
    mode: InjectionMode.EXTENSION_PROMPT,
    position: PromptPosition.IN_CHAT,
    depth: 1,
    role: PromptRole.SYSTEM,
});

const SYSTEM_PROMPT = Object.freeze({
    mode: InjectionMode.EXTENSION_PROMPT,
    position: PromptPosition.IN_PROMPT,
    depth: 0,
    role: PromptRole.SYSTEM,
});

function stateRule(binding, path, operator, value) {
    return {
        type: ConditionType.PROVIDER_STATE,
        providerId: 'superagents',
        source: `$stateSource:${binding}`,
        path,
        operator,
        value: String(value),
    };
}

function notStateRule(binding, path, operator, value) {
    return { ...stateRule(binding, path, operator, value), invert: true };
}

function knowledgeRule(binding, capability) {
    return {
        type: ConditionType.PROVIDER_STATE,
        providerId: 'superagents-knowledge',
        source: `$stateSource:${binding}`,
        path: 'candidates.$subject.capability',
        operator: 'eq',
        value: capability,
    };
}

function knowledgeSubject(binding) {
    return {
        mode: SubjectMode.STATE_SOURCE,
        providerId: 'superagents-knowledge',
        source: `$stateSource:${binding}`,
        collectionPath: 'candidates',
        subjectPath: 'character',
        counterpartPath: '',
        selection: 'least-recent',
    };
}

function calendarRule(status) {
    return {
        type: ConditionType.PROVIDER_STATE,
        providerId: 'superagents-calendar',
        source: 'calendar',
        path: 'commitments.$subject.status',
        operator: 'eq',
        value: status,
    };
}

function calendarCommitmentSubject() {
    return {
        mode: SubjectMode.STATE_SOURCE,
        providerId: 'superagents-calendar',
        source: 'calendar',
        collectionPath: 'commitments',
        subjectPath: 'title',
        counterpartPath: '',
        selection: 'least-recent',
    };
}

function allStateRules(...conditions) {
    return { type: ConditionType.GROUP, operator: ConditionGroupOperator.ALL, conditions };
}

function anyStateRules(...conditions) {
    return { type: ConditionType.GROUP, operator: ConditionGroupOperator.ANY, conditions };
}

function relationshipMilestone(value) {
    return stateRule('milestones', 'characters.$subject.milestones', 'contains', value);
}

function noRelationshipMilestone(value) {
    return notStateRule('milestones', 'characters.$subject.milestones', 'contains', value);
}

function betrayalEstablishedRule() {
    return anyStateRules(
        relationshipMilestone('betrayal by character established'),
        relationshipMilestone('betrayal by persona established'),
    );
}

export const BUILT_IN_PRESETS = Object.freeze([
    {
        id: 'story-complications',
        version: 2,
        name: 'Story Complications',
        description: 'A menu of independent story disruptions. Pick any combination to introduce setbacks, returning history, severe crises, changing weather, or illness on a schedule.',
        tags: ['setbacks', 'surprises', 'world events'],
        setName: 'Preset — Story Complications',
        events: [
            {
                key: 'things-go-south',
                name: 'Things Go South',
                description: 'Periodically introduces a plausible setback connected to the current scene, goals, or risks.',
                category: EventCategory.FLAVOR,
                priority: 10,
                text: '[Scene Direction: Introduce a plausible setback based on the active goals, risks, and established setting. Let it complicate the scene without erasing prior progress or forcing actions for {{user}}.]',
                schedule: { type: ScheduleType.RECURRING, intervalMin: 8, intervalMax: 16, probability: 0.35, cooldown: 12, initialDelay: 8 },
            },
            {
                key: 'past-returns',
                name: 'Past Returns',
                description: 'Once per chat, brings back a person, consequence, obligation, or unresolved incident from the character’s established past.',
                category: EventCategory.PLOT,
                priority: 50,
                text: '[Scene Direction: Reintroduce a person, consequence, obligation, or unresolved incident from {{char}}\'s established past. Seed it naturally and preserve existing canon.]',
                schedule: { type: ScheduleType.ONE_SHOT, intervalMin: 3, intervalMax: 8, probability: 1, cooldown: 0, initialDelay: 45 },
            },
            {
                key: 'catastrophe',
                name: 'Catastrophe Strikes',
                description: 'Once per chat, begins a serious crisis with lasting consequences after the story has had time to develop.',
                category: EventCategory.PLOT,
                priority: 70,
                text: '[Scene Direction: A serious setting-appropriate crisis begins. Telegraph it clearly, leave room for character response, and create lasting consequences without dictating {{user}}\'s choices.]',
                schedule: { type: ScheduleType.ONE_SHOT, intervalMin: 5, intervalMax: 12, probability: 0.5, cooldown: 0, initialDelay: 70 },
            },
            {
                key: 'bad-weather',
                name: 'Bad Weather Event',
                description: 'Occasionally changes the weather in a dramatic but setting-appropriate way that affects the current scene.',
                category: EventCategory.WORLD,
                priority: 15,
                text: '[World Event: Shift the weather in a dramatic but seasonally and geographically plausible way. Show concrete effects on the current scene and avoid repeating a recent weather event.]',
                schedule: { type: ScheduleType.RECURRING, intervalMin: 18, intervalMax: 35, probability: 0.3, cooldown: 24, initialDelay: 18 },
            },
            {
                key: 'illness',
                name: 'Illness',
                description: 'Once per chat, has the current character begin showing gradual signs of illness or exhaustion.',
                category: EventCategory.FLAVOR,
                priority: 15,
                text: '[Recent Development: {{char}} begins showing setting-appropriate signs of illness or exhaustion. Establish symptoms gradually; do not decide {{user}}\'s diagnosis or response.]',
                schedule: { type: ScheduleType.ONE_SHOT, intervalMin: 4, intervalMax: 10, probability: 0.4, cooldown: 0, initialDelay: 55 },
            },
        ],
    },
    {
        id: 'world-conditions',
        version: 1,
        name: 'World Conditions',
        description: 'Turns validated World State environment and clock facts into occasional scene pressure without changing the weather, inventing precise time, or treating an inferred date as a deadline.',
        tags: ['world state', 'environment', 'time of day', 'weather', 'travel'],
        setName: 'Preset — World Conditions',
        stateBindings: [{
            key: 'world',
            label: 'World State environment and clock',
            path: 'timeOfDay',
            description: 'Validated branch-aware location, time of day, weather, temperature, and setting from SuperAgents World State.',
            preferredSources: ['sa_world_state'],
        }],
        events: [
            {
                key: 'nighttime-pressure',
                name: 'Nighttime Has Consequences',
                description: 'Occasionally lets established evening or nighttime conditions affect access, visibility, routine, safety, or social behavior.',
                category: EventCategory.WORLD,
                priority: 20,
                text: '<world_condition>World State currently establishes evening or nighttime. Let that fact create one proportionate, setting-specific consequence through visibility, access, public activity, fatigue, transport, routine, or social expectations. Preserve the tracked clock and location. Do not invent a danger merely because it is dark, force {{user}}\'s response, or resolve a major outcome.</world_condition>',
                condition: anyStateRules(
                    stateRule('world', 'timeOfDay', 'eq', 'Evening'),
                    stateRule('world', 'timeOfDay', 'eq', 'Night'),
                    stateRule('world', 'timeOfDay', 'eq', 'Late Night'),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 10, intervalMax: 18, probability: 0.35, cooldown: 14, initialDelay: 8 },
            },
            {
                key: 'severe-weather-consequence',
                name: 'Severe Weather Consequence',
                description: 'Makes already-established severe weather matter physically or logistically without scheduling a new storm.',
                category: EventCategory.WORLD,
                priority: 35,
                text: '<world_condition>World State already establishes severe weather. Carry one concrete consequence into the scene through sound, visibility, travel, shelter, clothing, infrastructure, timing, or ordinary behavior. Do not change the tracked weather, escalate it into a disaster without canon, inflict automatic injury, or decide {{user}}\'s action.</world_condition>',
                condition: anyStateRules(
                    stateRule('world', 'weather', 'eq', 'Heavy Rain'),
                    stateRule('world', 'weather', 'eq', 'Downpour'),
                    stateRule('world', 'weather', 'eq', 'Thunderstorm'),
                    stateRule('world', 'weather', 'eq', 'Storm'),
                    stateRule('world', 'weather', 'eq', 'Heavy Snow'),
                    stateRule('world', 'weather', 'eq', 'Blizzard'),
                    stateRule('world', 'weather', 'eq', 'Hail'),
                    stateRule('world', 'weather', 'eq', 'Sleet'),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 8, intervalMax: 16, probability: 0.45, cooldown: 12, initialDelay: 5 },
            },
            {
                key: 'outdoor-exposure',
                name: 'Outdoor Exposure',
                description: 'Lets established outdoor temperature extremes impose believable, bounded practical pressure.',
                category: EventCategory.WORLD,
                priority: 30,
                text: '<world_condition>World State establishes that the active scene is outdoors in an extreme temperature. Show one proportionate practical effect on comfort, endurance, equipment, pace, or the need for shelter. Respect existing clothing, species, magic, technology, and acclimatization. Do not impose automatic injury or dictate {{user}}\'s response.</world_condition>',
                condition: allStateRules(
                    stateRule('world', 'setting', 'eq', 'Outdoors'),
                    anyStateRules(
                        stateRule('world', 'temperature', 'eq', 'Freezing'),
                        stateRule('world', 'temperature', 'eq', 'Cold'),
                        stateRule('world', 'temperature', 'eq', 'Scorching'),
                    ),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 10, intervalMax: 20, probability: 0.35, cooldown: 15, initialDelay: 7 },
            },
            {
                key: 'travel-constraint',
                name: 'Travel Has Constraints',
                description: 'Occasionally makes an established vehicle or in-transit scene obey its physical and social limitations.',
                category: EventCategory.FLAVOR,
                priority: 20,
                text: '<world_condition>World State establishes that the active scene is aboard or using a vehicle. Let one ordinary constraint of that specific mode of travel matter: movement, noise, privacy, route, schedule, space, etiquette, access, or dependence on an operator. Keep it proportionate and canonical; do not manufacture a breakdown, accident, or delay unless already supported.</world_condition>',
                condition: stateRule('world', 'setting', 'eq', 'Vehicle'),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 12, intervalMax: 24, probability: 0.3, cooldown: 18, initialDelay: 8 },
            },
        ],
    },
    {
        id: 'chekhov-setup-payoff',
        version: 2,
        name: 'Chekhov Setup → Payoff',
        description: 'Creates a two-part plot thread: first establish an ordinary detail, then bring that same detail back later when it can matter.',
        tags: ['foreshadowing', 'setup and payoff'],
        setName: 'Preset — Chekhov Setup → Payoff',
        events: [
            {
                key: 'setup',
                name: 'Chekhov Setup',
                description: 'Introduces one unobtrusive object, document, name, or fact and saves a short description of it.',
                category: EventCategory.PLOT,
                priority: 90,
                text: '[Scene Direction: Introduce one specific incidental object, document, name, or fact that fits the setting. Do not spotlight it. After the narrative output: <!--DE:chekhovDetail:SHORT DESCRIPTION-->]',
                capture: { enabled: true, varName: 'chekhovDetail' },
                injection: SYSTEM_PROMPT,
                schedule: { type: ScheduleType.ONE_SHOT, intervalMin: 12, intervalMax: 25, probability: 1, cooldown: 0, initialDelay: 4 },
            },
            {
                key: 'payoff',
                name: 'Chekhov Payoff',
                description: 'After the setup has happened, makes the saved detail directly relevant to the current conflict or goal.',
                requires: ['setup'],
                category: EventCategory.PLOT,
                priority: 95,
                text: '[Scene Direction: The previously established detail {{getvar::chekhovDetail}} becomes directly relevant to the current conflict or goal. Refer to it specifically and preserve how it was established.]',
                injection: SYSTEM_PROMPT,
                condition: { type: ConditionType.IS_SPENT, targetKey: 'setup' },
                schedule: { type: ScheduleType.ONE_SHOT, intervalMin: 15, intervalMax: 35, probability: 1, cooldown: 0, initialDelay: 8 },
            },
        ],
    },
    {
        id: 'event-spark',
        version: 2,
        name: 'Event Spark',
        description: 'Adds occasional, lightweight surprises—such as a message, mistake, visitor, hazard, discovery, or shift in the social dynamic—to keep scenes from becoming predictable.',
        tags: ['random events', 'variety'],
        setName: 'Preset — Event Spark',
        events: [{
            key: 'event-spark',
            name: 'Event Spark',
            description: 'On eligible turns, chooses one context-appropriate surprise from a varied list and works it into the next response.',
            category: EventCategory.FLAVOR,
            priority: 20,
            text: 'Work one of the following into this response, chosen to fit current canon: {{random::a brief background detail::a character mistake::an urgent message::an unexpected visitor::a physical hazard::a public event people are discussing::a petty local drama::a reason to go somewhere::a loose thread that invites action::a subtle shift in the power dynamic}}. Keep it brief unless it naturally becomes the scene focus. Do not write actions or dialogue for {{user}}.',
            schedule: { type: ScheduleType.RECURRING, intervalMin: 1, intervalMax: 1, probability: 0.3, cooldown: 0, initialDelay: 0 },
        }],
    },
    {
        id: 'adaptive-prompt-starter',
        version: 2,
        name: 'Adaptive Prompt Kit',
        description: 'A practical Harbingers-inspired example of staged prompt composition. Prompt Base always classifies the scene; Prompt NSFW is called only when Base says it is needed. Each concise fragment has its own macro outlet for placement in an ordinary preset.',
        tags: ['prompt routing', 'macros', 'conditional agents', 'harbingers', 'example'],
        setName: 'Preset — Adaptive Prompt Kit',
        stateBindings: [
            {
                key: 'base',
                label: 'Prompt Base',
                path: 'nsfw',
                preferredSources: ['sa_prompt_base'],
            },
            {
                key: 'nsfw',
                label: 'Prompt NSFW',
                path: 'characterSex',
                preferredSources: ['sa_prompt_nsfw'],
            },
        ],
        routers: [
            {
                key: 'author-outlet',
                name: 'Author Style Outlet',
                description: 'Writes the classified author into {{de_author}}.',
                mode: PromptRouterMode.EXCLUSIVE,
                injection: { mode: InjectionMode.MACRO, macroName: 'author' },
                layers: [{
                    name: 'Selected author',
                    priority: 10,
                    text: '<author_style>For this response, write in the style of {{conditionValue}}. If the author is non-English, translate the result into English.</author_style>',
                    condition: stateRule('base', 'author', 'exists', ''),
                }],
            },
            {
                key: 'focus-character-outlet',
                name: 'Focus Character Outlet',
                description: 'Writes the classified focus character into {{de_focus_character}}.',
                mode: PromptRouterMode.EXCLUSIVE,
                injection: { mode: InjectionMode.MACRO, macroName: 'focus_character' },
                layers: [{
                    name: 'Selected focus character',
                    priority: 10,
                    text: '<focus_character>The current focus character is {{conditionValue}}. Keep the response primarily grounded in what they perceive, feel, decide, say, and do.</focus_character>',
                    condition: stateRule('base', 'focusCharacter', 'exists', ''),
                }],
            },
            {
                key: 'character-mood-outlet',
                name: 'Character Mood Outlet',
                description: 'Selects one mood direction and exposes it as {{de_character_mood}}. Neutral intentionally produces nothing.',
                mode: PromptRouterMode.EXCLUSIVE,
                injection: { mode: InjectionMode.MACRO, macroName: 'character_mood' },
                layers: [
                    {
                        name: 'Sad',
                        priority: 10,
                        text: '<character_mood>Let sadness influence the focus character’s reactions and behavior; it may sap initiative, make communication difficult, or turn their expectations pessimistic.</character_mood>',
                        condition: stateRule('base', 'mood', 'eq', 'sad'),
                    },
                    {
                        name: 'Angry',
                        priority: 10,
                        text: '<character_mood>Let anger influence the focus character’s decisions and behavior; they may lose their temper, act rashly, or say something nasty.</character_mood>',
                        condition: stateRule('base', 'mood', 'eq', 'angry'),
                    },
                    {
                        name: 'Afraid',
                        priority: 10,
                        text: '<character_mood>Let fear influence the focus character’s decisions and behavior; they may make paranoid assumptions, panic, flee, freeze, or lash out defensively.</character_mood>',
                        condition: stateRule('base', 'mood', 'eq', 'afraid'),
                    },
                    {
                        name: 'Romantic',
                        priority: 10,
                        text: '<character_mood>Let romantic feeling color the focus character’s attention and choices through specific tenderness, yearning, self-consciousness, or hope that fits them. Romance does not decide {{user}}’s feelings.</character_mood>',
                        condition: stateRule('base', 'mood', 'eq', 'romantic'),
                    },
                    {
                        name: 'Sexy',
                        priority: 10,
                        text: '<character_mood>Let sexual interest shape the focus character’s attention, body language, and choices in-character. Tension or desire alone does not force escalation, consent, or romance.</character_mood>',
                        condition: stateRule('base', 'mood', 'eq', 'sexy'),
                    },
                ],
            },
            {
                key: 'impaired-outlet',
                name: 'Impairment Outlet',
                description: 'Exposes active impairment as {{de_character_impaired}}.',
                mode: PromptRouterMode.STACK,
                injection: { mode: InjectionMode.MACRO, macroName: 'character_impaired' },
                layers: [{ name: 'Impaired', priority: 10, text: '<character_condition>The focus character is impaired. Let the substance consistently affect clarity, coordination, inhibition, memory, or reaction time according to what they took and how impaired they are.</character_condition>', condition: stateRule('base', 'impaired', 'eq', true) }],
            },
            {
                key: 'injured-outlet',
                name: 'Recent Injury Outlet',
                description: 'Exposes a recent injury as {{de_character_injured}}.',
                mode: PromptRouterMode.STACK,
                injection: { mode: InjectionMode.MACRO, macroName: 'character_injured' },
                layers: [{ name: 'Recently injured', priority: 10, text: '<character_condition>The focus character has a recent injury. Keep its pain, limitations, treatment, and risk of aggravation physically present without making it their only trait.</character_condition>', condition: stateRule('base', 'injured', 'eq', true) }],
            },
            {
                key: 'violence-outlet',
                name: 'Violence Outlet',
                description: 'Exposes active violence as {{de_violence}}.',
                mode: PromptRouterMode.STACK,
                injection: { mode: InjectionMode.MACRO, macroName: 'violence' },
                layers: [{ name: 'Violence', priority: 10, text: '<violence>Treat violence like an action movie when the genre supports it: dramatic, legible, and capable of moving the plot. Emphasize skill, movement, improvisation, and consequences; major characters can be hurt when it changes the story.</violence>', condition: stateRule('base', 'violence', 'eq', true) }],
            },
            {
                key: 'nsfw-core-outlet',
                name: 'NSFW Core Outlet',
                description: 'Exposes the shared NSFW baseline as {{de_nsfw_core}}.',
                mode: PromptRouterMode.STACK,
                injection: { mode: InjectionMode.MACRO, macroName: 'nsfw_core' },
                layers: [{ name: 'NSFW', priority: 10, text: '<sexuality>When the scene is NSFW, narrate sexuality matter-of-factly and explicitly. Take time with physical detail and reactions rather than racing to climax. Do not force tenderness: sex is not automatically romance.</sexuality>', condition: stateRule('base', 'nsfw', 'eq', true) }],
            },
            {
                key: 'nsfw-character-sex-outlet',
                name: 'NSFW Character Sex Outlet',
                description: 'Selects anatomy/identity guidance as {{de_nsfw_character_sex}}.',
                mode: PromptRouterMode.EXCLUSIVE,
                injection: { mode: InjectionMode.MACRO, macroName: 'nsfw_character_sex' },
                layers: [
                    { name: 'Male', priority: 10, text: '<nsfw_character>The focus character has male anatomy. Describe its established details and physical responses specifically rather than treating the body as generic.</nsfw_character>', condition: allStateRules(stateRule('base', 'nsfw', 'eq', true), stateRule('nsfw', 'characterSex', 'eq', 'male')) },
                    { name: 'Female', priority: 10, text: '<nsfw_character>The focus character has female anatomy. Describe its established details and physical responses specifically rather than treating the body as generic.</nsfw_character>', condition: allStateRules(stateRule('base', 'nsfw', 'eq', true), stateRule('nsfw', 'characterSex', 'eq', 'female')) },
                    { name: 'Genderless', priority: 10, text: '<nsfw_character>The focus character is genderless. Do not frame them as a man or woman; describe only the body and identity established by canon.</nsfw_character>', condition: allStateRules(stateRule('base', 'nsfw', 'eq', true), stateRule('nsfw', 'characterSex', 'eq', 'genderless')) },
                    { name: 'Nonbinary', priority: 10, text: '<nsfw_character>The focus character is nonbinary. Preserve their identity and language without inferring anatomy from gender.</nsfw_character>', condition: allStateRules(stateRule('base', 'nsfw', 'eq', true), stateRule('nsfw', 'characterSex', 'eq', 'nonbinary')) },
                    { name: 'Intersex', priority: 10, text: '<nsfw_character>The focus character is intersex. Use only their established anatomy and language; do not simplify it into a binary body or invent details.</nsfw_character>', condition: allStateRules(stateRule('base', 'nsfw', 'eq', true), stateRule('nsfw', 'characterSex', 'eq', 'intersex')) },
                    { name: 'Unknown', priority: 10, text: '<nsfw_character>The focus character’s anatomy is not established clearly enough for a specific configuration. Avoid unsupported anatomical claims.</nsfw_character>', condition: allStateRules(stateRule('base', 'nsfw', 'eq', true), stateRule('nsfw', 'characterSex', 'eq', 'unknown')) },
                ],
            },
            {
                key: 'nsfw-pairing-outlet',
                name: 'NSFW Pairing Outlet',
                description: 'Selects body-configuration guidance as {{de_nsfw_pairing}}.',
                mode: PromptRouterMode.EXCLUSIVE,
                injection: { mode: InjectionMode.MACRO, macroName: 'nsfw_pairing' },
                layers: [
                    { name: 'M/M', priority: 10, text: '<nsfw_pairing>For this m/m configuration, keep acts varied and character-specific. Anal penetration requires preparation and lubrication; account for pain, tearing risk, protection, prostate stimulation, oversensitivity, fatigue, refractory periods, and staggered orgasms when relevant.</nsfw_pairing>', condition: allStateRules(stateRule('base', 'nsfw', 'eq', true), stateRule('nsfw', 'pairingType', 'eq', 'm/m')) },
                    { name: 'M/F', priority: 10, text: '<nsfw_pairing>For this m/f configuration, keep acts varied and character-specific. Account for contraception, pregnancy risk, protection, preparation for anal penetration, oversensitivity, fatigue, refractory periods, and staggered orgasms when relevant.</nsfw_pairing>', condition: allStateRules(stateRule('base', 'nsfw', 'eq', true), stateRule('nsfw', 'pairingType', 'eq', 'm/f')) },
                    { name: 'F/F', priority: 10, text: '<nsfw_pairing>For this f/f configuration, keep acts varied and character-specific rather than defaulting to one routine. Account for lubrication, toys or barriers when established, oversensitivity, fatigue, and staggered orgasms when relevant.</nsfw_pairing>', condition: allStateRules(stateRule('base', 'nsfw', 'eq', true), stateRule('nsfw', 'pairingType', 'eq', 'f/f')) },
                    { name: 'Other or unclear', priority: 10, text: '<nsfw_pairing>Use the participants’ established bodies, language, preferences, and physical limits. Do not force the encounter into a binary configuration or invent anatomy to complete a familiar script.</nsfw_pairing>', condition: allStateRules(stateRule('base', 'nsfw', 'eq', true), stateRule('nsfw', 'pairingType', 'eq', 'other_or_unclear')) },
                ],
            },
            {
                key: 'nsfw-virginity-outlet',
                name: 'NSFW Virginity Outlet',
                description: 'Selects virginity guidance as {{de_nsfw_virginity}}.',
                mode: PromptRouterMode.EXCLUSIVE,
                injection: { mode: InjectionMode.MACRO, macroName: 'nsfw_virginity' },
                layers: [
                    { name: 'Virgin character', priority: 10, text: '<nsfw_addendum>The focus character is a virgin. Let their lack of experience influence how they approach sex; they may admit it or try to hide it.</nsfw_addendum>', condition: allStateRules(stateRule('base', 'nsfw', 'eq', true), stateRule('nsfw', 'virginity', 'eq', 'virgin_character')) },
                    { name: 'Virgin user', priority: 10, text: '<nsfw_addendum>{{user}} is a virgin. Determine whether the focus character knows and let them respond in-character without deciding {{user}}’s feelings or reactions.</nsfw_addendum>', condition: allStateRules(stateRule('base', 'nsfw', 'eq', true), stateRule('nsfw', 'virginity', 'eq', 'virgin_user')) },
                    { name: 'Both virgins', priority: 10, text: '<nsfw_addendum>Both the focus character and {{user}} are virgins. Let mutual inexperience affect confidence, communication, pacing, and mistakes without deciding {{user}}’s feelings or reactions.</nsfw_addendum>', condition: allStateRules(stateRule('base', 'nsfw', 'eq', true), stateRule('nsfw', 'virginity', 'eq', 'both')) },
                ],
            },
            {
                key: 'nsfw-first-time-outlet',
                name: 'NSFW First Time Together Outlet',
                description: 'Exposes first-time-together guidance as {{de_nsfw_first_time}}.',
                mode: PromptRouterMode.STACK,
                injection: { mode: InjectionMode.MACRO, macroName: 'nsfw_first_time' },
                layers: [{ name: 'First time together', priority: 10, text: '<nsfw_addendum>The focus character and {{user}} have never had sex together; they do not yet know each other’s bodies or preferences.</nsfw_addendum>', condition: allStateRules(stateRule('base', 'nsfw', 'eq', true), stateRule('nsfw', 'firstTimeTogether', 'eq', true)) }],
            },
            {
                key: 'nsfw-close-friends-outlet',
                name: 'NSFW Close Friends Outlet',
                description: 'Exposes the close-friends dynamic as {{de_nsfw_close_friends}}.',
                mode: PromptRouterMode.STACK,
                injection: { mode: InjectionMode.MACRO, macroName: 'nsfw_close_friends' },
                layers: [{ name: 'Close friends', priority: 10, text: '<nsfw_addendum>The focus character and {{user}} know each other well as close friends. Depending on their established dynamic, intimacy may bring humor, ease, awkwardness, or a strange new vulnerability.</nsfw_addendum>', condition: allStateRules(stateRule('base', 'nsfw', 'eq', true), stateRule('nsfw', 'closeFriends', 'eq', true)) }],
            },
            {
                key: 'nsfw-family-outlet',
                name: 'NSFW Family Outlet',
                description: 'Exposes the family dynamic as {{de_nsfw_family}}.',
                mode: PromptRouterMode.STACK,
                injection: { mode: InjectionMode.MACRO, macroName: 'nsfw_family' },
                layers: [{ name: 'Family', priority: 10, text: '<nsfw_addendum>The focus character and {{user}} are family. Treat sex as a meaningful taboo whose boundary, secrecy, conflict, or consequences follow their established relationship and setting.</nsfw_addendum>', condition: allStateRules(stateRule('base', 'nsfw', 'eq', true), stateRule('nsfw', 'family', 'eq', true)) }],
            },
        ],
    },
    {
        id: 'phone-story-beats',
        version: 1,
        name: 'Phone Story Beats',
        description: 'Optional off-screen communication beats powered by SuperAgents Phone. Each component is independent, editable, and installed disabled.',
        tags: ['phone', 'off-screen', 'communication'],
        setName: 'Preset — Phone Story Beats',
        events: [
            {
                key: 'off-screen-check-in',
                name: 'Off-Screen Check-In',
                description: 'Occasionally lets the active character consider a natural check-in when they are plausibly away from the user.',
                category: EventCategory.FLAVOR,
                priority: 15,
                text: '',
                actions: [{
                    type: 'superagents.phone',
                    behavior: 'consider',
                    recipient: { mode: 'active-character', value: '' },
                    reason: '{{char}} may have a natural reason to check in with {{user}} from off-screen. Only text if they are plausibly apart and the contact fits current characterization, timing, and canon.',
                }],
                schedule: { type: ScheduleType.RECURRING, intervalMin: 8, intervalMax: 16, probability: 0.35, cooldown: 12, initialDelay: 6 },
            },
            {
                key: 'unfinished-conversation',
                name: 'Unfinished Conversation',
                description: 'Gives an unresolved exchange or emotional loose end one chance to surface through a text.',
                category: EventCategory.PLOT,
                priority: 25,
                text: '',
                actions: [{
                    type: 'superagents.phone',
                    behavior: 'consider',
                    recipient: { mode: 'active-character', value: '' },
                    reason: 'Consider whether {{char}} would follow up through the active communication surface on a specific unresolved exchange, question, promise, disagreement, or emotional loose end already established in canon. Do not invent a loose end merely to create a message.',
                }],
                schedule: { type: ScheduleType.ONE_SHOT, intervalMin: 10, intervalMax: 20, probability: 0.55, cooldown: 0, initialDelay: 18 },
            },
            {
                key: 'urgent-practical-message',
                name: 'Urgent Practical Message',
                description: 'Rarely guarantees a Phone attempt about a concrete, setting-appropriate development that needs the user’s attention.',
                category: EventCategory.WORLD,
                priority: 45,
                text: '',
                actions: [{
                    type: 'superagents.phone',
                    behavior: 'send',
                    recipient: { mode: 'active-character', value: '' },
                    reason: '{{char}} needs to send {{user}} a concise, urgent, practical message about a concrete development supported by the current setting and canon. Make it actionable without deciding {{user}}’s response or inventing a catastrophe.',
                }],
                schedule: { type: ScheduleType.ONE_SHOT, intervalMin: 18, intervalMax: 35, probability: 0.35, cooldown: 0, initialDelay: 35 },
            },
        ],
    },
    {
        id: 'lives-beyond-the-scene',
        version: 3,
        name: 'Lives Beyond the Scene',
        description: 'Surfaces character initiative, competing obligations, off-screen consequences, approaching intersections, and optional own-life Phone updates from validated Parallel Off-Screen state.',
        tags: ['initiative', 'off-screen life', 'autonomy', 'social world', 'phone'],
        setName: 'Preset — Lives Beyond the Scene',
        subjectBinding: {
            label: 'Whose independent life may surface',
            description: 'At runtime, each Event checks all characters in Parallel Off-Screen, chooses only from those who satisfy its conditions, and rotates fairly among them. You can still choose a fixed character instead.',
            allowStateSource: true,
            default: {
                mode: SubjectMode.STATE_SOURCE,
                providerId: 'superagents',
                source: 'sa_parallel',
                collectionPath: 'characters',
                selection: 'least-recent',
            },
        },
        stateBindings: [
            {
                key: 'parallel',
                label: 'Parallel character state',
                path: 'characters.$subject.status',
                description: 'Validated independent-life state produced by SuperAgents Parallel Off-Screen.',
                preferredSources: ['sa_parallel'],
            },
        ],
        events: [
            {
                key: 'independent-agenda',
                name: 'Independent Agenda',
                description: 'While present, lets the subject take one proportionate step toward an established goal of their own.',
                category: EventCategory.FLAVOR,
                priority: 25,
                text: '<character_initiative subject="{{subject}}">Use {{subject}}\'s CURRENT PARALLEL CHARACTER STATE. If the present scene offers a plausible opening, let {{subject}} initiate one small, concrete step toward their recorded goal or next intended action. Keep it consistent with elapsed time, personality, availability, and canon. The initiative need not involve {{user}} and may create an invitation, boundary, request, refusal, departure, or NPC-to-NPC interaction. Do not decide {{user}}\'s response or complete a major irreversible outcome without setup.</character_initiative>',
                condition: allStateRules(
                    stateRule('parallel', 'characters.$subject.status', 'eq', 'present'),
                    stateRule('parallel', 'characters.$subject.nextAction', 'exists', ''),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 10, intervalMax: 18, probability: 0.4, cooldown: 14, initialDelay: 8 },
            },
            {
                key: 'competing-obligation',
                name: 'Competing Obligation',
                description: 'Allows an established duty, plan, or relationship to limit the subject’s availability without manufacturing drama.',
                category: EventCategory.FLAVOR,
                priority: 30,
                text: '<character_initiative subject="{{subject}}">Let {{subject}}\'s recorded availability, goal, and current activity place one believable constraint on the present interaction. They may need to delay, divide attention, decline, leave, reschedule, protect another commitment, or ask for practical accommodation. Express the obligation in a character-specific way and preserve room for negotiation. Do not invent a crisis, punish {{user}}, or treat affection as unlimited availability.</character_initiative>',
                condition: allStateRules(
                    stateRule('parallel', 'characters.$subject.status', 'eq', 'present'),
                    anyStateRules(
                        stateRule('parallel', 'characters.$subject.availability', 'eq', 'limited'),
                        stateRule('parallel', 'characters.$subject.availability', 'eq', 'busy'),
                    ),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 14, intervalMax: 24, probability: 0.3, cooldown: 18, initialDelay: 12 },
            },
            {
                key: 'offscreen-consequence',
                name: 'Off-Screen Consequence',
                description: 'Lets a small result of prior off-screen activity become perceptible through an appropriate channel.',
                category: EventCategory.WORLD,
                priority: 35,
                text: '<offscreen_consequence subject="{{subject}}">Use {{subject}}\'s CURRENT PARALLEL CHARACTER STATE to surface one small consequence only if the viewpoint has a plausible way to perceive it now. Respect the recorded visibility: private information requires direct disclosure; shared information needs an appropriate social connection; public information may appear through posts, notices, witnesses, or ordinary observation; hidden information must remain hidden. Prefer evidence, changed availability, rumor, a message, or a concrete downstream effect over omniscient exposition. Preserve uncertainty and do not decide {{user}}\'s reaction.</offscreen_consequence>',
                condition: allStateRules(
                    anyStateRules(
                        stateRule('parallel', 'characters.$subject.status', 'eq', 'off-screen'),
                        stateRule('parallel', 'characters.$subject.status', 'eq', 'approaching-scene'),
                    ),
                    stateRule('parallel', 'characters.$subject.visibility', 'neq', 'hidden'),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 18, intervalMax: 30, probability: 0.3, cooldown: 24, initialDelay: 16 },
            },
            {
                key: 'approaching-intersection',
                name: 'Approaching Intersection',
                description: 'Gives an imminent tracked thread one restrained chance to intersect the active scene.',
                category: EventCategory.PLOT,
                priority: 55,
                text: '<offscreen_intersection subject="{{subject}}">The tracked actions of {{subject}} are approaching the current scene. Introduce the next observable edge of that intersection—arrival, contact, evidence, a third party, or a consequence—without teleporting them, skipping required travel, resolving the whole thread, or forcing {{user}}\'s choices. If the viewpoint still cannot plausibly perceive it, show only an appropriate precursor.</offscreen_intersection>',
                condition: anyStateRules(
                    stateRule('parallel', 'characters.$subject.status', 'eq', 'approaching-scene'),
                    stateRule('parallel', 'characters.$subject.relevance', 'eq', 'imminent'),
                ),
                schedule: { type: ScheduleType.ONE_SHOT, intervalMin: 4, intervalMax: 10, probability: 0.75, cooldown: 0, initialDelay: 2 },
            },
            {
                key: 'own-life-update',
                name: 'Own-Life Update',
                description: 'Lets an absent subject consider texting because of their own activity, goal, or social life—not merely to check on the user.',
                category: EventCategory.FLAVOR,
                priority: 20,
                text: '',
                actions: [{
                    type: 'superagents.phone',
                    behavior: 'consider',
                    recipient: { mode: 'subject', value: '' },
                    reason: '{{subject}} has an independent reason to consider contacting {{user}}. Use their validated Parallel Off-Screen state, especially activity, goal, nextAction, availability, contactIntent, visibility, and socialTargets. If they text, let the message arise from their own life—a development, invitation, practical update, complaint, small success, question, photo-worthy moment, or social situation. Respect privacy and timing. Do not send merely because they miss {{user}}, and send nothing if contact would not fit.',
                }],
                condition: allStateRules(
                    anyStateRules(
                        stateRule('parallel', 'characters.$subject.status', 'eq', 'off-screen'),
                        stateRule('parallel', 'characters.$subject.status', 'eq', 'approaching-scene'),
                    ),
                    anyStateRules(
                        stateRule('parallel', 'characters.$subject.contactIntent', 'eq', 'maybe'),
                        stateRule('parallel', 'characters.$subject.contactIntent', 'eq', 'likely'),
                        stateRule('parallel', 'characters.$subject.contactIntent', 'eq', 'urgent'),
                    ),
                    stateRule('parallel', 'characters.$subject.availability', 'neq', 'unreachable'),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 12, intervalMax: 24, probability: 0.35, cooldown: 18, initialDelay: 10 },
            },
        ],
        tracks: [],
    },
    {
        id: 'social-ripples',
        version: 1,
        name: 'Social Ripples',
        description: 'Lets shareable edges of independent character lives surface through SuperAgents Feed, with privacy-aware posting and plausible social responses.',
        tags: ['feed', 'social world', 'off-screen life', 'privacy', 'relationships'],
        setName: 'Preset — Social Ripples',
        subjectBinding: {
            label: 'Whose social life may surface',
            description: 'Rotates fairly through active Parallel Off-Screen characters. Feed still makes the final publish/withhold decision.',
            allowStateSource: true,
            default: {
                mode: SubjectMode.STATE_SOURCE,
                providerId: 'superagents',
                source: 'sa_parallel',
                collectionPath: 'characters',
                selection: 'least-recent',
            },
        },
        stateBindings: [{
            key: 'parallel',
            label: 'Parallel character state',
            path: 'characters.$subject.status',
            description: 'Validated independent-life state produced by SuperAgents Parallel Off-Screen.',
            preferredSources: ['sa_parallel'],
        }],
        events: [
            {
                key: 'shareable-edge',
                name: 'Shareable Edge',
                description: 'Asks an off-screen subject whether one edge of their current life is something they would genuinely share.',
                category: EventCategory.FLAVOR,
                priority: 18,
                text: '',
                actions: [{
                    type: 'superagents.feed',
                    behavior: 'consider',
                    recipient: { mode: 'subject', value: '' },
                    reason: 'Consider whether {{subject}} would share one authentic edge of their current independent life. Use current activity, goal, nextAction, availability, visibility, and socialTargets. The post may be mundane, funny, indirect, aesthetic, proud, guarded, practical, or socially strategic. It need not mention {{user}}. Respect privacy and withhold if this is not something {{subject}} would post.',
                }],
                condition: allStateRules(
                    anyStateRules(
                        stateRule('parallel', 'characters.$subject.status', 'eq', 'off-screen'),
                        stateRule('parallel', 'characters.$subject.status', 'eq', 'approaching-scene'),
                    ),
                    stateRule('parallel', 'characters.$subject.visibility', 'neq', 'hidden'),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 12, intervalMax: 24, probability: 0.38, cooldown: 18, initialDelay: 10 },
            },
            {
                key: 'social-afterglow',
                name: 'Social Afterglow',
                description: 'Gives a socially connected subject a restrained chance to post and receive plausible responses from their own circle.',
                category: EventCategory.FLAVOR,
                priority: 16,
                text: '',
                actions: [{
                    type: 'superagents.feed',
                    behavior: 'consider',
                    recipient: { mode: 'subject', value: '' },
                    reason: 'Consider a socially embedded Feed moment for {{subject}}. If they post, express their own voice and current life rather than paraphrasing state. Comments may come only from established socialTargets who plausibly saw the post and would respond; zero comments is normal. Do not funnel every reaction toward {{user}}, manufacture romantic competition, or expose private information.',
                }],
                condition: allStateRules(
                    stateRule('parallel', 'characters.$subject.socialTargets', 'exists', ''),
                    stateRule('parallel', 'characters.$subject.visibility', 'neq', 'hidden'),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 18, intervalMax: 32, probability: 0.28, cooldown: 24, initialDelay: 16 },
            },
        ],
        tracks: [],
    },
    {
        id: 'social-web-ripples',
        version: 1,
        name: 'Social Web Ripples',
        description: 'Turns active NPC-to-NPC obligations, friction, alliances, and social pressure into durable story motion without assuming romance or exposing private knowledge.',
        tags: ['social web', 'relationships', 'npc', 'long-term plots', 'pressure'],
        setName: 'Preset — Social Web Ripples',
        subjectBinding: {
            label: 'Which relationship may move',
            description: 'Rotates through active directional edges in Social Web Ledger. The edge source becomes {{subject}} and its target becomes {{counterpart}}.',
            allowStateSource: true,
            default: {
                mode: SubjectMode.STATE_SOURCE,
                providerId: 'superagents',
                source: 'sa_social_web',
                collectionPath: 'relationships',
                subjectPath: 'source',
                counterpartPath: 'target',
                selection: 'least-recent',
            },
        },
        stateBindings: [{
            key: 'web',
            label: 'Social relationship state',
            path: 'relationships.$subject.pressure',
            description: 'Validated directional relationship state produced by SuperAgents Social Web Ledger.',
            preferredSources: ['sa_social_web'],
        }],
        events: [
            {
                key: 'favor-comes-due',
                name: 'Favor Comes Due',
                description: 'Lets an established obligation begin affecting choices when the relationship is already under pressure.',
                category: EventCategory.PLOT,
                priority: 38,
                text: '<social_web_event edge="{{subject}}→{{counterpart}}">Let the obligation from {{subject}} toward {{counterpart}} create one concrete, proportionate demand, concession, delay, invitation, refusal, or divided loyalty. Current relational pressure: {{subjectState.currentPressure}}. Preserve the established power balance and both characters\' agency. Do not invent the content of a secret or decide {{user}}\'s response.</social_web_event>',
                condition: allStateRules(
                    stateRule('web', 'relationships.$subject.obligation', 'gte', 60),
                    stateRule('web', 'relationships.$subject.pressure', 'gte', 45),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 12, intervalMax: 24, probability: 0.42, cooldown: 18, initialDelay: 8 },
            },
            {
                key: 'private-friction-shows',
                name: 'Private Friction Shows',
                description: 'Allows sustained private tension to leak through behavior only when the scene has a plausible way to reveal it.',
                category: EventCategory.FLAVOR,
                priority: 32,
                text: '<social_web_event edge="{{subject}}→{{counterpart}}">If the current viewpoint has a plausible route to notice it, let a restrained sign of friction between {{subject}} and {{counterpart}} surface through timing, wording, avoidance, over-formality, a changed choice, or another observable detail. Public stance: {{subjectState.publicStance}}. Private stance: {{subjectState.privateStance}}. Respect visibility={{subjectState.visibility}}; hidden facts remain hidden and private facts require appropriate access.</social_web_event>',
                condition: allStateRules(
                    stateRule('web', 'relationships.$subject.tension', 'gte', 55),
                    stateRule('web', 'relationships.$subject.pressure', 'gte', 40),
                    stateRule('web', 'relationships.$subject.visibility', 'neq', 'hidden'),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 10, intervalMax: 22, probability: 0.38, cooldown: 16, initialDelay: 8 },
            },
            {
                key: 'fault-line-opens',
                name: 'Fault Line Opens',
                description: 'Uses high tension and low trust as a delayed complication rather than instantly forcing betrayal or confrontation.',
                category: EventCategory.PLOT,
                priority: 46,
                text: '<social_web_event edge="{{subject}}→{{counterpart}}">Create one story complication rooted in {{subject}}\'s low trust and high tension toward {{counterpart}}. Build from the recorded pressure ({{subjectState.currentPressure}}) and last meaningful shift ({{subjectState.lastShift}}). The complication may be caution, verification, coalition-building, refusal, miscoordination, or confrontation, but do not force cruelty, betrayal, disclosure, or reconciliation.</social_web_event>',
                condition: allStateRules(
                    stateRule('web', 'relationships.$subject.tension', 'gte', 70),
                    stateRule('web', 'relationships.$subject.trust', 'lt', 35),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 18, intervalMax: 34, probability: 0.32, cooldown: 26, initialDelay: 14 },
            },
            {
                key: 'alliance-moves',
                name: 'Alliance Moves',
                description: 'Lets a trusted, close relationship produce help, coordination, or a meaningful constraint of its own.',
                category: EventCategory.WORLD,
                priority: 34,
                text: '<social_web_event edge="{{subject}}→{{counterpart}}">Let the established bond between {{subject}} and {{counterpart}} produce one concrete downstream effect: coordination, advocacy, warning, access, protection, compromise, or a shared constraint. Use their bond types ({{subjectState.bondTypes}}), current pressure ({{subjectState.currentPressure}}), and established power balance. Keep the effect proportional and do not make their relationship exist only to serve {{user}}.</social_web_event>',
                condition: allStateRules(
                    stateRule('web', 'relationships.$subject.trust', 'gte', 65),
                    stateRule('web', 'relationships.$subject.closeness', 'gte', 50),
                    stateRule('web', 'relationships.$subject.pressure', 'gte', 35),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 14, intervalMax: 28, probability: 0.36, cooldown: 20, initialDelay: 10 },
            },
        ],
        tracks: [],
    },
    {
        id: 'knowledge-pressure',
        version: 1,
        name: 'Knowledge Pressure',
        description: 'Turns established suspicion, investigation, concealment, strained cover stories, and reachable evidence into story motion without automatically exposing protected truth.',
        tags: ['knowledge', 'secrets', 'investigation', 'continuity', 'safe disclosure'],
        setName: 'Preset — Knowledge Pressure',
        stateBindings: [{
            key: 'knowledge',
            label: 'Knowledge Ledger',
            path: 'facts.$subject.perspectives',
            description: 'Uses SuperAgents capability checks and disclosure-safe candidate projections rather than raw fact records.',
            preferredSources: ['sa_knowledge'],
        }],
        events: [
            {
                key: 'suspicion-sharpens',
                name: 'Suspicion Sharpens',
                description: 'Lets an existing suspicion gain one observable, non-confirming detail.',
                category: EventCategory.FLAVOR,
                priority: 34,
                subject: knowledgeSubject('knowledge'),
                text: '<knowledge_pressure capability="notice" record="{{subjectState.recordId}}" actor="{{subject}}">Let {{subject}} notice one small canon-backed inconsistency connected to this Knowledge Ledger record. Their recorded position ({{subjectState.position}}) is the ceiling of what they may infer. Show only an observable cue or guarded reaction; a private question may appear only when the current narrative viewpoint canonically has access to {{subject}}\'s inner experience. Do not confirm ground truth, quote protected ledger content, grant new knowledge, satisfy a reveal prerequisite, or expose the record to another viewpoint.</knowledge_pressure>',
                condition: knowledgeRule('knowledge', 'notice'),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 10, intervalMax: 20, probability: 0.36, cooldown: 16, initialDelay: 8 },
            },
            {
                key: 'quiet-investigation',
                name: 'Quiet Investigation',
                description: 'Allows a character with an established investigate intent to take one reversible step.',
                category: EventCategory.PLOT,
                priority: 42,
                subject: knowledgeSubject('knowledge'),
                text: '<knowledge_pressure capability="investigate" record="{{subjectState.recordId}}" actor="{{subject}}">Let {{subject}} take one proportionate, reversible investigative step based only on their recorded position={{subjectState.position}} and access={{subjectState.access}}. They may ask, compare, watch, verify, or seek a plausible source. Surface that step only when the current scene or viewpoint can plausibly perceive it; otherwise preserve it as off-screen pressure without omniscient explanation. Do not hand them the answer, invent evidence, complete the investigation, satisfy a reveal prerequisite, or disclose the protected proposition in narration or dialogue.</knowledge_pressure>',
                condition: knowledgeRule('knowledge', 'investigate'),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 14, intervalMax: 28, probability: 0.34, cooldown: 22, initialDelay: 10 },
            },
            {
                key: 'guarded-behavior',
                name: 'Guarded Behavior',
                description: 'Lets an informed character conceal or protect information through behavior without explaining the secret.',
                category: EventCategory.FLAVOR,
                priority: 32,
                subject: knowledgeSubject('knowledge'),
                text: '<knowledge_pressure capability="conceal" record="{{subjectState.recordId}}" actor="{{subject}}">Let {{subject}} take one subtle precaution or show one restrained sign of guarded behavior consistent with disclosureIntent={{subjectState.disclosureIntent}}. The behavior may protect access, redirect a question, check privacy, delay a choice, or avoid a risky topic. Do not state what they are protecting, turn caution into guilt, force a lie, or reveal protected truth through omniscient explanation.</knowledge_pressure>',
                condition: knowledgeRule('knowledge', 'conceal'),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 12, intervalMax: 24, probability: 0.32, cooldown: 18, initialDelay: 8 },
            },
            {
                key: 'cover-story-strains',
                name: 'Cover Story Strains',
                description: 'Creates a discrepancy around an established cover story while preserving uncertainty.',
                category: EventCategory.PLOT,
                priority: 44,
                subject: knowledgeSubject('knowledge'),
                text: '<knowledge_pressure capability="cover-strain" record="{{subjectState.recordId}}" actor="{{subject}}">Let an established cover story connected to {{subject}}\'s current suspicion develop one small mismatch, omission, timing problem, or social inconsistency that the present viewpoint could plausibly observe. Preserve {{subject}}\'s position={{subjectState.position}}: the inconsistency raises a question but neither proves the protected proposition nor identifies the lie. Do not quote hidden ledger text or force confrontation, confession, or discovery.</knowledge_pressure>',
                condition: knowledgeRule('knowledge', 'cover-strain'),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 18, intervalMax: 34, probability: 0.28, cooldown: 26, initialDelay: 14 },
            },
            {
                key: 'evidence-within-reach',
                name: 'Evidence Within Reach',
                description: 'Makes a gated route toward evidence plausible without granting, interpreting, or confirming it.',
                category: EventCategory.PLOT,
                priority: 48,
                subject: knowledgeSubject('knowledge'),
                text: '<knowledge_pressure capability="approach-evidence" record="{{subjectState.recordId}}" actor="{{subject}}">When the current scene or viewpoint can plausibly surface it, create one opportunity for {{subject}} to move nearer to evidence relevant to this protected record: access might become requestable, a witness reachable, a location visitable, or a contradiction checkable. This is only an opportunity. Do not claim evidence was obtained, understood, authenticated, or sufficient; do not mark any reveal prerequisite complete; do not expose the protected proposition or predetermine whether {{subject}} acts.</knowledge_pressure>',
                condition: knowledgeRule('knowledge', 'approach-evidence'),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 22, intervalMax: 40, probability: 0.24, cooldown: 32, initialDelay: 16 },
            },
        ],
        tracks: [],
    },
    {
        id: 'commitment-consequences',
        version: 2,
        name: 'Commitment Consequences',
        description: 'Turns explicit Calendar status changes into bounded story consequences and can capture a concrete replacement plan established in the resulting narration without rewriting the original history.',
        tags: ['calendar', 'commitments', 'consequences', 'deadlines', 'branch aware'],
        setName: 'Preset — Commitment Consequences',
        dependencies: [{
            kind: 'calendar',
            name: 'Calendar / Commitments',
            detail: 'Uses the active branch’s explicit commitment status from SuperAgents Calendar.',
        }],
        subjectBinding: {
            label: 'Which commitment changed',
            description: 'Rotates through visible Calendar records. The commitment title becomes {{subject}} and the full safe projection remains available through {{subjectState.field}}.',
            allowStateSource: true,
            default: calendarCommitmentSubject(),
        },
        events: [
            {
                key: 'postponement-has-a-cost',
                name: 'Postponement Has a Cost',
                description: 'Lets an explicitly postponed commitment alter logistics, expectations, or pressure without treating postponement as abandonment.',
                category: EventCategory.PLOT,
                priority: 40,
                oncePerSubject: true,
                text: '<calendar_consequence status="postponed">The active persona’s Calendar explicitly marks “{{subject}}” as postponed. Let that established postponement create one proportionate logistical, emotional, social, or strategic complication connected to its known participants, location, and authored timing ({{subjectState.timeLabel}}). Do not invent who requested the delay, why it happened, whether anyone is offended, or whether the commitment will ultimately be kept.</calendar_consequence>',
                condition: calendarRule('postponed'),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 1, intervalMax: 2, probability: 1, cooldown: 0, initialDelay: 0 },
            },
            {
                key: 'missed-commitment-echoes',
                name: 'Missed Commitment Echoes',
                description: 'Allows a commitment explicitly marked missed to produce a bounded consequence without inventing blame or the unseen failure itself.',
                category: EventCategory.PLOT,
                priority: 48,
                oncePerSubject: true,
                text: '<calendar_consequence status="missed">The active persona’s Calendar explicitly marks “{{subject}}” as missed. Its authored timing is {{subjectState.timeLabel}}. Let that established missed status create one concrete, proportionate consequence: a practical obstacle, follow-up, changed expectation, social pressure, or lost opportunity supported by current canon. Do not invent the reason it was missed, assign blame, narrate off-screen facts as known, force forgiveness or anger, or decide {{user}}’s response.</calendar_consequence>',
                condition: calendarRule('missed'),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 1, intervalMax: 2, probability: 1, cooldown: 0, initialDelay: 0 },
            },
            {
                key: 'cancellation-redirects-plans',
                name: 'Cancellation Redirects Plans',
                description: 'Lets an explicitly cancelled commitment change the available path without inventing a canceller, motive, or substitute plan.',
                category: EventCategory.WORLD,
                priority: 42,
                oncePerSubject: true,
                text: '<calendar_consequence status="cancelled">The active persona’s Calendar explicitly marks “{{subject}}” as cancelled. Its authored timing is {{subjectState.timeLabel}}. Reflect one immediate, proportionate change in availability, coordination, opportunity, or expectation. Preserve the recorded participants and setting. Do not invent who cancelled, supply a motive, assume relief or resentment, or create a replacement commitment automatically.</calendar_consequence>',
                condition: calendarRule('cancelled'),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 1, intervalMax: 2, probability: 1, cooldown: 0, initialDelay: 0 },
            },
            {
                key: 'completion-leaves-a-trace',
                name: 'Completion Leaves a Trace',
                description: 'Acknowledges an explicitly completed commitment through a bounded aftermath without fabricating how it was completed or what it proves relationally.',
                category: EventCategory.FLAVOR,
                priority: 34,
                oncePerSubject: true,
                text: '<calendar_consequence status="completed">The active persona’s Calendar explicitly marks “{{subject}}” as completed. Its authored timing is {{subjectState.timeLabel}}. Let that established completion leave one modest, canon-consistent trace: changed availability, a receipt or reminder, a next practical step, a participant’s observable response, or closure of a logistical pressure. Do not invent how completion happened, add unearned success, prove trust or devotion, or decide {{user}}’s feelings.</calendar_consequence>',
                condition: calendarRule('completed'),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 1, intervalMax: 2, probability: 1, cooldown: 0, initialDelay: 0 },
            },
        ],
        tracks: [],
    },
    {
        id: 'staged-relationship-arc',
        version: 11,
        name: 'Relationship Progression',
        description: 'A menu of editable relationship models: romantic awareness, love under constraint, slow trust through earned access, consequence/accountability paths after betrayal, and conflicts between sincere devotion and binding duty. Canonical gates prevent scores from inventing reciprocation, forgiveness, repair, or a choice between commitments.',
        tags: ['relationship', 'romance', 'trust', 'betrayal', 'accountability', 'boundaries', 'constraints', 'devotion', 'duty', 'milestones', 'gradual change'],
        setName: 'Preset — Relationship Progression',
        stateBindings: [
            {
                key: 'affection',
                label: 'Affection',
                path: 'characters.$subject.affection',
                description: 'Lets Slow Trust preserve warmth without treating it as access or safety.',
                preferredSources: ['sa_relationship_ledger'],
            },
            {
                key: 'attraction',
                label: 'Attraction',
                path: 'characters.$subject.attraction',
                description: 'Used to select the current attraction stage.',
                preferredSources: ['sa_relationship_ledger'],
            },
            {
                key: 'trust',
                label: 'Trust',
                path: 'characters.$subject.trust',
                description: 'Distinguishes guarded attraction from safer emotional attachment.',
                preferredSources: ['sa_relationship_ledger'],
            },
            {
                key: 'comfort',
                label: 'Comfort',
                path: 'characters.$subject.comfort',
                description: 'Measures how easy it currently feels to be unguarded without granting blanket access.',
                preferredSources: ['sa_relationship_ledger'],
            },
            {
                key: 'familiarity',
                label: 'Familiarity',
                path: 'characters.$subject.familiarity',
                description: 'Represents accumulated shared history; it cannot substitute for trust.',
                preferredSources: ['sa_relationship_ledger'],
            },
            {
                key: 'milestones',
                label: 'Relationship milestones',
                path: 'characters.$subject.milestones',
                description: 'Confirms confessions, constraints, vulnerability, betrayal, accountability, forgiveness, repair, devotion, duty, and costly choices only after they occur in canon.',
                preferredSources: ['sa_relationship_ledger'],
            },
        ],
        events: [
            {
                key: 'constraint-exacts-cost',
                name: 'Constraint Exacts a Cost',
                description: 'Makes an already-established obstacle matter in a concrete but non-terminal way.',
                category: EventCategory.PLOT,
                priority: 42,
                subject: { mode: SubjectMode.ACTIVE_CARD, value: '' },
                text: '<constraint_beat type="cost">The canonically established constraint around {{subject}}\'s acknowledged love for {{user}} has one concrete present consequence. It may alter timing, access, reputation, duty, distance, safety, or what {{subject}} is willing to risk, but it must follow the specific obstacle already in canon. Do not invent a new barrier, weaken or resolve the existing one, force disclosure, assume reciprocation, or choose for {{user}}.</constraint_beat>',
                condition: allStateRules(
                    stateRule('milestones', 'characters.$subject.milestones', 'contains', 'love acknowledged'),
                    stateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint established'),
                    notStateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint resolved'),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 14, intervalMax: 26, probability: 0.32, cooldown: 20, initialDelay: 8 },
            },
            {
                key: 'constraint-faces-a-test',
                name: 'Constraint Faces a Test',
                description: 'Turns a canonically challenged barrier into a bounded choice or consequence without crossing it automatically.',
                category: EventCategory.PLOT,
                priority: 46,
                subject: { mode: SubjectMode.ACTIVE_CARD, value: '' },
                text: '<constraint_beat type="test">The established relationship constraint has already been challenged in canon. Let one immediate choice, contradiction, or cost test its present terms for {{subject}}. Preserve the obstacle unless the story itself changes it: do not force defiance, surrender, confession, separation, reconciliation, or a decision for {{user}}. A test may intensify, clarify, or expose the cost without resolving it.</constraint_beat>',
                condition: allStateRules(
                    stateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint challenged'),
                    notStateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint transformed'),
                    notStateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint resolved'),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 18, intervalMax: 32, probability: 0.28, cooldown: 26, initialDelay: 12 },
            },
            {
                key: 'changed-terms-take-effect',
                name: 'Changed Terms Take Effect',
                description: 'Shows what a transformed—but not necessarily removed—constraint now permits and forbids.',
                category: EventCategory.PLOT,
                priority: 44,
                subject: { mode: SubjectMode.ACTIVE_CARD, value: '' },
                text: '<constraint_beat type="changed-terms">Canon has changed the form or terms of the relationship constraint. Show one practical consequence of the new arrangement for {{subject}}: an opening, a new limit, a shifted obligation, or a different risk. Transformation is not resolution. Do not assume the relationship is public, mutual, consummated, exclusive, or free of consequences, and do not decide how {{user}} responds.</constraint_beat>',
                condition: allStateRules(
                    stateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint transformed'),
                    notStateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint resolved'),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 20, intervalMax: 36, probability: 0.25, cooldown: 30, initialDelay: 14 },
            },
            {
                key: 'betrayal-consequence-returns',
                name: 'Betrayal Consequence Returns',
                description: 'Lets one specific consequence of the canonical betrayal affect the present without replaying or escalating it arbitrarily.',
                category: EventCategory.PLOT,
                priority: 48,
                subject: { mode: SubjectMode.ACTIVE_CARD, value: '' },
                text: '<betrayal_beat type="consequence">A concrete consequence of the established betrayal affects {{subject}} and {{user}} in the present: changed access, verification, reputation, alliance, routine, confidence, grief, anger, or a practical cost grounded in what actually happened. Do not invent a second betrayal, exaggerate the original harm, force confrontation, decide {{user}}\'s feelings, or treat lingering consequences as proof that forgiveness or reconciliation must occur.</betrayal_beat>',
                condition: allStateRules(
                    betrayalEstablishedRule(),
                    noRelationshipMilestone('relationship redefined after betrayal'),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 12, intervalMax: 24, probability: 0.34, cooldown: 18, initialDelay: 6 },
            },
            {
                key: 'betrayal-confrontation-opening',
                name: 'Confrontation Opening',
                description: 'Creates an opportunity to address the betrayal without supplying either party’s words, motives, or verdict.',
                category: EventCategory.PLOT,
                priority: 52,
                subject: { mode: SubjectMode.ACTIVE_CARD, value: '' },
                text: '<betrayal_beat type="confrontation-opening">Create one plausible, bounded opening in which the established betrayal could be named, questioned, or deliberately left unaddressed. Preserve who betrayed whom and what each person currently knows. If {{user}} is the responsible party, do not speak, confess, apologize, or choose for {{user}}. If {{subject}} is responsible, they may still evade, minimize, remain silent, or approach accountability according to canon and characterization.</betrayal_beat>',
                condition: allStateRules(
                    betrayalEstablishedRule(),
                    noRelationshipMilestone('betrayal confronted'),
                    noRelationshipMilestone('relationship redefined after betrayal'),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 16, intervalMax: 30, probability: 0.28, cooldown: 24, initialDelay: 10 },
            },
            {
                key: 'accountability-meets-a-choice',
                name: 'Accountability Meets a Choice',
                description: 'Tests whether responsibility becomes concrete after confrontation while preserving the persona’s agency.',
                category: EventCategory.PLOT,
                priority: 54,
                subject: { mode: SubjectMode.ACTIVE_CARD, value: '' },
                text: '<betrayal_beat type="accountability-choice">The betrayal has been confronted, but accountability is not yet canonically accepted. Let one present detail distinguish acknowledgment from excuse, remorse from self-protection, or explanation from responsibility. Do not manufacture absolution or condemnation. If {{user}} is responsible, present only the situation and {{subject}}\'s established response; never write {{user}}\'s admission, apology, intent, or decision.</betrayal_beat>',
                condition: allStateRules(
                    relationshipMilestone('betrayal confronted'),
                    noRelationshipMilestone('accountability accepted'),
                    noRelationshipMilestone('relationship redefined after betrayal'),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 18, intervalMax: 34, probability: 0.27, cooldown: 28, initialDelay: 12 },
            },
            {
                key: 'restitution-must-be-concrete',
                name: 'Restitution Must Be Concrete',
                description: 'Turns accepted responsibility into an observable cost or follow-through rather than instant repaired trust.',
                category: EventCategory.PLOT,
                priority: 50,
                subject: { mode: SubjectMode.ACTIVE_CARD, value: '' },
                text: '<betrayal_beat type="restitution">Accountability has been accepted, but repair still needs concrete evidence. Surface one proportionate opportunity, cost, boundary, or piece of follow-through that would make restitution observable. An attempt may fail, be refused, remain incomplete, or help without restoring the former relationship. If {{user}} is responsible, do not perform the reparative action for {{user}}. Do not convert effort into forgiveness, trust, access, reconciliation, or reunion.</betrayal_beat>',
                condition: allStateRules(
                    relationshipMilestone('accountability accepted'),
                    noRelationshipMilestone('restitution demonstrated'),
                    noRelationshipMilestone('relationship redefined after betrayal'),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 20, intervalMax: 38, probability: 0.25, cooldown: 30, initialDelay: 14 },
            },
            {
                key: 'redefined-terms-are-tested',
                name: 'Redefined Terms Are Tested',
                description: 'Shows whether the relationship’s canonically chosen new shape works under ordinary pressure.',
                category: EventCategory.PLOT,
                priority: 46,
                subject: { mode: SubjectMode.ACTIVE_CARD, value: '' },
                text: '<betrayal_beat type="new-terms">The relationship has been canonically redefined after betrayal. Let one ordinary situation test the new terms: ended contact, formal distance, limited cooperation, cautious repair, altered intimacy, or another arrangement already established in the story. Preserve the actual outcome and do not decide {{user}}\'s participation in or response to those terms. Do not steer it back toward romance, friendship, forgiveness, punishment, or reunion merely because the old bond remains emotionally important.</betrayal_beat>',
                condition: relationshipMilestone('relationship redefined after betrayal'),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 22, intervalMax: 42, probability: 0.22, cooldown: 34, initialDelay: 16 },
            },
            {
                key: 'duty-calls-at-personal-cost',
                name: 'Duty Calls at a Personal Cost',
                description: 'Lets an established obligation make a concrete demand without deciding that duty outranks devotion.',
                category: EventCategory.PLOT,
                priority: 44,
                subject: { mode: SubjectMode.ACTIVE_CARD, value: '' },
                text: '<devotion_duty_beat type="duty-cost">A concrete obligation already established for {{subject}} makes a present, proportionate demand that costs time, access, safety, reputation, honesty, resources, or another opportunity connected to {{user}}. Preserve both the duty and the devotion as sincere. Do not invent a new oath or institution, declare the commitments incompatible before canon does, force {{subject}} to choose, or decide {{user}}\'s reaction.</devotion_duty_beat>',
                condition: allStateRules(
                    relationshipMilestone('devotion established'),
                    relationshipMilestone('duty established'),
                    noRelationshipMilestone('devotion and duty reconciled'),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 14, intervalMax: 28, probability: 0.3, cooldown: 22, initialDelay: 8 },
            },
            {
                key: 'conflicting-loyalties-come-due',
                name: 'Conflicting Loyalties Come Due',
                description: 'Makes an established devotion-duty conflict require an immediate response without supplying the choice.',
                category: EventCategory.PLOT,
                priority: 50,
                subject: { mode: SubjectMode.ACTIVE_CARD, value: '' },
                text: '<devotion_duty_beat type="conflict-due">The canonical conflict between {{subject}}\'s devotion to {{user}} and an established duty reaches one bounded decision point, deadline, divided-attention cost, or incompatible demand. Show what each commitment asks and what cannot be fully preserved in this moment. Do not choose for {{subject}}, speak or decide for {{user}}, manufacture a betrayal, or make either commitment secretly false to simplify the conflict.</devotion_duty_beat>',
                condition: allStateRules(
                    relationshipMilestone('devotion and duty conflict established'),
                    noRelationshipMilestone('duty chosen over devotion'),
                    noRelationshipMilestone('devotion chosen over duty'),
                    noRelationshipMilestone('devotion and duty renegotiated'),
                    noRelationshipMilestone('devotion and duty reconciled'),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 16, intervalMax: 30, probability: 0.28, cooldown: 24, initialDelay: 10 },
            },
            {
                key: 'third-party-demands-clarity',
                name: 'A Third Party Demands Clarity',
                description: 'Lets someone with legitimate standing press the conflict without turning them into an arbitrary villain.',
                category: EventCategory.SOCIAL,
                priority: 46,
                subject: { mode: SubjectMode.ACTIVE_CARD, value: '' },
                text: '<devotion_duty_beat type="third-party">Someone who is already connected to {{subject}}\'s established duty notices a concrete inconsistency, risk, divided loyalty, or unmet obligation and asks for clarification, assurance, boundaries, or action appropriate to their role. Give that person legitimate stakes and a distinct perspective rather than making them a disposable obstacle. Do not expose secrets they could not know, force an ultimatum, choose for {{subject}}, or decide {{user}}\'s response.</devotion_duty_beat>',
                condition: allStateRules(
                    relationshipMilestone('devotion and duty conflict established'),
                    noRelationshipMilestone('devotion and duty renegotiated'),
                    noRelationshipMilestone('devotion and duty reconciled'),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 20, intervalMax: 36, probability: 0.24, cooldown: 28, initialDelay: 14 },
            },
            {
                key: 'choice-leaves-a-remainder',
                name: 'The Choice Leaves a Remainder',
                description: 'Preserves the concrete consequences of a canonical choice without treating the losing commitment as insincere.',
                category: EventCategory.PLOT,
                priority: 48,
                subject: { mode: SubjectMode.ACTIVE_CARD, value: '' },
                text: '<devotion_duty_beat type="choice-consequence">A canonical choice between devotion and duty has already been made. Let one specific remainder of the commitment not chosen affect the present: grief, obligation, lost access, political or family consequence, relief, resentment, practical repair, changed trust, or a continuing promise grounded in canon. Do not reverse the choice, erase its cost, call the unchosen commitment false, force regret, or decide {{user}}\'s judgment.</devotion_duty_beat>',
                condition: allStateRules(
                    anyStateRules(
                        relationshipMilestone('duty chosen over devotion'),
                        relationshipMilestone('devotion chosen over duty'),
                    ),
                    noRelationshipMilestone('devotion and duty reconciled'),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 18, intervalMax: 34, probability: 0.26, cooldown: 26, initialDelay: 12 },
            },
            {
                key: 'renegotiated-terms-are-tested',
                name: 'Renegotiated Terms Are Tested',
                description: 'Tests a canonically negotiated arrangement without assuming it solved every conflict or cost.',
                category: EventCategory.PLOT,
                priority: 46,
                subject: { mode: SubjectMode.ACTIVE_CARD, value: '' },
                text: '<devotion_duty_beat type="renegotiated-test">Canon has changed the terms under which {{subject}} carries devotion and duty. Let one ordinary pressure test the actual arrangement: disclosure rules, divided time, recusal, delegated authority, boundaries, public conduct, contingency plans, or another term already established. Preserve what the agreement permits and forbids. Do not make the test automatically fail or succeed, declare full reconciliation, or decide {{user}}\'s cooperation.</devotion_duty_beat>',
                condition: allStateRules(
                    relationshipMilestone('devotion and duty renegotiated'),
                    noRelationshipMilestone('devotion and duty reconciled'),
                ),
                schedule: { type: ScheduleType.RECURRING, intervalMin: 22, intervalMax: 40, probability: 0.22, cooldown: 32, initialDelay: 16 },
            },
        ],
        tracks: [{
            key: 'romantic-awakening-track',
            name: 'Romantic Awakening',
            description: 'An editable example using validated attraction, trust, and canonical milestones from one or more state agents. Its thresholds demonstrate hysteresis and branching; they are not universal relationship rules.',
            transitionMode: TrackTransitionMode.STICKY,
            subject: { mode: SubjectMode.ACTIVE_CARD, value: '' },
            states: [
                {
                    name: 'Stage 1 — Rationalized Pull',
                    priority: 10,
                    minDuration: 2,
                    text: '<relationship_state>\n{{subject}} feels a noticeable pull toward {{user}} but does not accept it as romantic. {{subject}} rationalizes it as friendship, curiosity, protectiveness, rivalry, physical interest, or circumstance—whichever fits established characterization. The feeling may color attention and reactions, but it does not justify a confession, possessiveness, assumed intimacy, or behavior that treats a relationship as established.\n</relationship_state>',
                    condition: allStateRules(
                        stateRule('attraction', 'characters.$subject.attraction', 'gte', 20),
                        stateRule('attraction', 'characters.$subject.attraction', 'lt', 55),
                    ),
                    exitCondition: anyStateRules(
                        stateRule('attraction', 'characters.$subject.attraction', 'lt', 10),
                        stateRule('attraction', 'characters.$subject.attraction', 'gte', 60),
                    ),
                },
                {
                    name: 'Stage 2A — Guarded Fixation',
                    priority: 25,
                    minDuration: 2,
                    text: '<relationship_state>\n{{subject}} is strongly drawn to {{user}}, but insufficient trust makes that attraction feel risky, destabilizing, or difficult to interpret. {{subject}} may watch closely, test intentions, retreat after vulnerable moments, or experience conflicted jealousy according to established characterization. Attraction does not erase suspicion or grant {{user}} access, trust, consent, or commitment. Do not turn this tension into cruelty or coercion unless the existing character and scene independently support it.\n</relationship_state>',
                    condition: allStateRules(
                        stateRule('attraction', 'characters.$subject.attraction', 'gte', 50),
                        stateRule('trust', 'characters.$subject.trust', 'lt', 35),
                    ),
                    exitCondition: anyStateRules(
                        stateRule('attraction', 'characters.$subject.attraction', 'lt', 40),
                        allStateRules(
                            stateRule('attraction', 'characters.$subject.attraction', 'gte', 50),
                            stateRule('trust', 'characters.$subject.trust', 'gte', 45),
                        ),
                    ),
                },
                {
                    name: 'Stage 2B — Growing Attachment',
                    priority: 30,
                    minDuration: 2,
                    text: '<relationship_state>\n{{subject}} can no longer dismiss their attraction to {{user}}, and sufficient trust lets the feeling develop as attachment rather than only tension. {{subject}} may seek time together, replay meaningful interactions, show selective vulnerability, or imagine greater closeness in ways consistent with personality and circumstance. {{subject}} has not necessarily named the feeling as love and must not assume reciprocation, confession, exclusivity, or an established relationship.\n</relationship_state>',
                    condition: allStateRules(
                        stateRule('attraction', 'characters.$subject.attraction', 'gte', 50),
                        stateRule('trust', 'characters.$subject.trust', 'gte', 35),
                    ),
                    exitCondition: anyStateRules(
                        stateRule('attraction', 'characters.$subject.attraction', 'lt', 40),
                        stateRule('trust', 'characters.$subject.trust', 'lt', 20),
                        allStateRules(
                            stateRule('attraction', 'characters.$subject.attraction', 'gte', 75),
                            stateRule('trust', 'characters.$subject.trust', 'gte', 45),
                        ),
                    ),
                },
                {
                    name: 'Stage 3 — Acknowledged Desire',
                    priority: 40,
                    minDuration: 2,
                    text: '<relationship_state>\n{{subject}} privately accepts that their attraction to {{user}} is real and emotionally important. {{subject}} may deliberately pursue closeness or move toward honest disclosure when the immediate scene supports it, while remaining shaped by established personality and boundaries. No confession or mutual relationship has been established unless it exists in canon. Do not invent reciprocation, consent, dating, a kiss, sex, exclusivity, or any other milestone from high scores alone.\n</relationship_state>',
                    condition: allStateRules(
                        stateRule('attraction', 'characters.$subject.attraction', 'gte', 75),
                        stateRule('trust', 'characters.$subject.trust', 'gte', 45),
                    ),
                    exitCondition: anyStateRules(
                        stateRule('attraction', 'characters.$subject.attraction', 'lt', 60),
                        stateRule('trust', 'characters.$subject.trust', 'lt', 30),
                        allStateRules(
                            stateRule('attraction', 'characters.$subject.attraction', 'gte', 80),
                            stateRule('trust', 'characters.$subject.trust', 'gte', 55),
                            stateRule('milestones', 'characters.$subject.milestones', 'contains', 'confessed attraction'),
                        ),
                    ),
                },
                {
                    name: 'Milestone — Attraction Voiced',
                    priority: 50,
                    minDuration: 2,
                    text: '<relationship_state>\nCanon records that {{subject}} has voiced their attraction to {{user}}. That disclosure remains part of the relationship history even if current feelings become conflicted, withdrawn, regretful, or strained. The confession establishes only that it was spoken: do not assume {{user}} reciprocated or invent dating, a kiss, sex, exclusivity, commitment, or any later milestone unless it separately occurred in the story.\n</relationship_state>',
                    condition: allStateRules(
                        stateRule('attraction', 'characters.$subject.attraction', 'gte', 80),
                        stateRule('trust', 'characters.$subject.trust', 'gte', 55),
                        stateRule('milestones', 'characters.$subject.milestones', 'contains', 'confessed attraction'),
                    ),
                    exitCondition: {
                        ...stateRule('milestones', 'characters.$subject.milestones', 'contains', 'confessed attraction'),
                        invert: true,
                    },
                },
                { name: 'No active attraction state', isFallback: true, priority: -100, text: '' },
            ]
        },
        {
            key: 'love-under-constraint-track',
            name: 'Love Under Constraint',
            description: 'For a character who already recognizes their love. The changing state belongs to the canonically established obstacle—not to discovery of the feeling or presumed reciprocation.',
            transitionMode: TrackTransitionMode.STICKY,
            subject: { mode: SubjectMode.ACTIVE_CARD, value: '' },
            states: [
                {
                    name: 'Mode — Love Held Within the Boundary',
                    priority: 20,
                    minDuration: 2,
                    text: '<relationship_constraint>\n{{subject}} already recognizes their love for {{user}}, and a specific canonical constraint still governs what they can safely, ethically, or practically do about it. Do not replay this as romantic confusion or make the feeling rise merely to create progress. Let affection appear through restraint, redirected tenderness, difficult priorities, guarded choices, or acceptance of cost according to characterization. Preserve the actual obstacle; do not invent reciprocation, disclosure, defiance, consent, or a relationship status for {{user}}.\n</relationship_constraint>',
                    condition: allStateRules(
                        stateRule('milestones', 'characters.$subject.milestones', 'contains', 'love acknowledged'),
                        stateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint established'),
                        notStateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint challenged'),
                        notStateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint transformed'),
                        notStateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint resolved'),
                    ),
                    exitCondition: anyStateRules(
                        stateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint challenged'),
                        stateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint transformed'),
                        stateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint resolved'),
                    ),
                },
                {
                    name: 'Mode — Boundary Under Pressure',
                    priority: 30,
                    minDuration: 2,
                    text: '<relationship_constraint>\n{{subject}}\'s acknowledged love remains constrained, but canon has now tested the old arrangement. Show the tension through choices with visible tradeoffs: hesitation, negotiation, selective honesty, protective distance, compromise, or a refusal that costs something. A challenge does not mean the barrier has fallen. Do not force {{subject}} to cross it, force {{user}} to wait or reciprocate, or treat suffering as proof that the relationship must happen.\n</relationship_constraint>',
                    condition: allStateRules(
                        stateRule('milestones', 'characters.$subject.milestones', 'contains', 'love acknowledged'),
                        stateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint challenged'),
                        notStateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint transformed'),
                        notStateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint resolved'),
                    ),
                    exitCondition: anyStateRules(
                        stateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint transformed'),
                        stateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint resolved'),
                    ),
                },
                {
                    name: 'Mode — Constraint on New Terms',
                    priority: 40,
                    minDuration: 2,
                    text: '<relationship_constraint>\nThe canonical obstacle around {{subject}}\'s acknowledged love has changed form or terms. Honor what the story specifically changed and what still remains. Let {{subject}} adjust behavior, risk, disclosure, contact, or expectations to the new reality without treating transformation as disappearance. Do not infer that love is reciprocated, that a relationship has begun, or that prior duties and consequences no longer matter.\n</relationship_constraint>',
                    condition: allStateRules(
                        stateRule('milestones', 'characters.$subject.milestones', 'contains', 'love acknowledged'),
                        stateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint transformed'),
                        notStateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint resolved'),
                    ),
                    exitCondition: stateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint resolved'),
                },
                {
                    name: 'Milestone — Constraint Resolved, Choice Remains',
                    priority: 50,
                    minDuration: 2,
                    text: '<relationship_constraint>\nCanon records that the prior constraint on {{subject}}\'s acknowledged love has been resolved. Its removal creates possibility, not an automatic outcome. Preserve any history, cost, changed feelings, new obligations, or caution produced by the barrier. {{subject}} may now make choices that were previously unavailable, but do not invent a confession, reciprocation, consent, reunion, commitment, or decision for {{user}} unless it separately occurs in the story.\n</relationship_constraint>',
                    condition: allStateRules(
                        stateRule('milestones', 'characters.$subject.milestones', 'contains', 'love acknowledged'),
                        stateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint resolved'),
                    ),
                    exitCondition: notStateRule('milestones', 'characters.$subject.milestones', 'contains', 'relationship constraint resolved'),
                },
                { name: 'No active constrained-love state', isFallback: true, priority: -100, text: '' },
            ],
        },
        {
            key: 'slow-trust-track',
            name: 'Slow Trust',
            description: 'Progresses verified safety, permission, and vulnerability. Affection may accumulate behind the boundary, but it never unlocks access on its own.',
            transitionMode: TrackTransitionMode.STICKY,
            subject: { mode: SubjectMode.ACTIVE_CARD, value: '' },
            states: [
                {
                    name: 'Stage — Boundaries Intact',
                    priority: 10,
                    minDuration: 2,
                    text: '<slow_trust>\n{{subject}} does not yet have enough evidence to treat {{user}} as reliably safe. Keep interaction within character-specific boundaries: role-appropriate topics, controlled settings, limited dependence, and no assumed access to private space, touch, history, secrets, or unguarded emotion. This may be cordial rather than hostile. Repeated proximity and high affection elsewhere do not count as permission.\n</slow_trust>',
                    condition: anyStateRules(
                        stateRule('trust', 'characters.$subject.trust', 'lt', 30),
                        stateRule('familiarity', 'characters.$subject.familiarity', 'lt', 20),
                    ),
                    exitCondition: anyStateRules(
                        allStateRules(
                            stateRule('trust', 'characters.$subject.trust', 'gte', 35),
                            stateRule('familiarity', 'characters.$subject.familiarity', 'gte', 25),
                        ),
                        allStateRules(
                            stateRule('affection', 'characters.$subject.affection', 'gte', 60),
                            stateRule('trust', 'characters.$subject.trust', 'lt', 45),
                        ),
                        stateRule('milestones', 'characters.$subject.milestones', 'contains', 'trust broken'),
                    ),
                },
                {
                    name: 'Stage — Reliability Under Test',
                    priority: 20,
                    minDuration: 2,
                    text: '<slow_trust>\n{{subject}} has seen enough consistency to test limited reliance on {{user}}. Show progress through small, observable permissions: less formal conversation, a low-stakes request, remembered preferences, tolerating quiet company, or sharing something non-critical. Each permission is specific rather than a universal upgrade. Do not grant private-space access, core vulnerability, unconditional belief, touch, forgiveness, or intimacy merely because trust is improving.\n</slow_trust>',
                    condition: allStateRules(
                        stateRule('trust', 'characters.$subject.trust', 'gte', 25),
                        stateRule('trust', 'characters.$subject.trust', 'lt', 60),
                        stateRule('familiarity', 'characters.$subject.familiarity', 'gte', 20),
                    ),
                    exitCondition: anyStateRules(
                        stateRule('trust', 'characters.$subject.trust', 'lt', 15),
                        allStateRules(
                            stateRule('affection', 'characters.$subject.affection', 'gte', 60),
                            stateRule('trust', 'characters.$subject.trust', 'lt', 45),
                        ),
                        allStateRules(
                            stateRule('trust', 'characters.$subject.trust', 'gte', 60),
                            stateRule('comfort', 'characters.$subject.comfort', 'gte', 40),
                            stateRule('familiarity', 'characters.$subject.familiarity', 'gte', 40),
                        ),
                        stateRule('milestones', 'characters.$subject.milestones', 'contains', 'trust broken'),
                    ),
                },
                {
                    name: 'Branch — Fondness Behind the Boundary',
                    priority: 45,
                    minDuration: 2,
                    text: '<slow_trust>\n{{subject}} feels substantial affection for {{user}}, but trust is not yet strong enough to make deeper access safe. Preserve both truths. Warmth may appear as attention, concern, loyalty, gifts, humor, or restrained longing while private space, protected history, touch, dependence, and vulnerable disclosure remain limited by {{subject}}\'s actual boundaries. Affection is retained rather than erased, but it cannot be cashed in as trust, consent, or entitlement.\n</slow_trust>',
                    condition: allStateRules(
                        stateRule('affection', 'characters.$subject.affection', 'gte', 60),
                        stateRule('trust', 'characters.$subject.trust', 'lt', 45),
                        notStateRule('milestones', 'characters.$subject.milestones', 'contains', 'trust broken'),
                    ),
                    exitCondition: anyStateRules(
                        stateRule('affection', 'characters.$subject.affection', 'lt', 45),
                        stateRule('trust', 'characters.$subject.trust', 'gte', 50),
                        stateRule('milestones', 'characters.$subject.milestones', 'contains', 'trust broken'),
                    ),
                },
                {
                    name: 'Stage — Selective Access',
                    priority: 50,
                    minDuration: 2,
                    text: '<slow_trust>\n{{subject}} now experiences {{user}} as sufficiently reliable for selective access. Let this change concrete behavior: a deliberately chosen invitation, more candid disagreement, an unpolished moment, a bounded personal disclosure, or reliance in one established area. Access remains granular and revocable; do not generalize one permission into every private space, secret, touch boundary, dependency, or kind of intimacy.\n</slow_trust>',
                    condition: allStateRules(
                        stateRule('trust', 'characters.$subject.trust', 'gte', 55),
                        stateRule('comfort', 'characters.$subject.comfort', 'gte', 40),
                        stateRule('familiarity', 'characters.$subject.familiarity', 'gte', 40),
                    ),
                    exitCondition: anyStateRules(
                        stateRule('trust', 'characters.$subject.trust', 'lt', 40),
                        stateRule('comfort', 'characters.$subject.comfort', 'lt', 30),
                        allStateRules(
                            stateRule('trust', 'characters.$subject.trust', 'gte', 75),
                            stateRule('comfort', 'characters.$subject.comfort', 'gte', 60),
                            stateRule('familiarity', 'characters.$subject.familiarity', 'gte', 55),
                            stateRule('milestones', 'characters.$subject.milestones', 'contains', 'shared meaningful vulnerability'),
                        ),
                        stateRule('milestones', 'characters.$subject.milestones', 'contains', 'trust broken'),
                    ),
                },
                {
                    name: 'Milestone — Chosen Vulnerability',
                    priority: 60,
                    minDuration: 2,
                    text: '<slow_trust>\nCanon records that {{subject}} deliberately allowed {{user}} to witness or receive something meaningfully vulnerable, and present trust and comfort support that access. Let the relationship remember the specificity of what was entrusted and how {{user}} responded. This does not unlock every secret, erase boundaries, establish romance, guarantee future disclosure, or make {{subject}} dependent or perfectly secure.\n</slow_trust>',
                    condition: allStateRules(
                        stateRule('trust', 'characters.$subject.trust', 'gte', 75),
                        stateRule('comfort', 'characters.$subject.comfort', 'gte', 60),
                        stateRule('familiarity', 'characters.$subject.familiarity', 'gte', 55),
                        stateRule('milestones', 'characters.$subject.milestones', 'contains', 'shared meaningful vulnerability'),
                    ),
                    exitCondition: anyStateRules(
                        stateRule('trust', 'characters.$subject.trust', 'lt', 55),
                        stateRule('comfort', 'characters.$subject.comfort', 'lt', 45),
                        stateRule('milestones', 'characters.$subject.milestones', 'contains', 'trust broken'),
                    ),
                },
                {
                    name: 'Rupture — Access Withdrawn',
                    priority: 80,
                    minDuration: 2,
                    text: '<slow_trust>\nCanon records that {{subject}}\'s trust in {{user}} was broken, and current trust is low. Withdraw or narrow the specific access affected by the breach: changed routines, verification, distance, guarded topics, revoked invitations, anger, grief, or practical boundaries according to what happened. Prior affection and vulnerability remain history but are not a claim on forgiveness. Do not restore access because of apologies, high affection, or score recovery alone.\n</slow_trust>',
                    condition: allStateRules(
                        stateRule('milestones', 'characters.$subject.milestones', 'contains', 'trust broken'),
                        stateRule('trust', 'characters.$subject.trust', 'lt', 45),
                    ),
                    exitCondition: stateRule('trust', 'characters.$subject.trust', 'gte', 45),
                },
                {
                    name: 'Repair — Reliability Re-Proven',
                    priority: 75,
                    minDuration: 2,
                    text: '<slow_trust>\n{{subject}} is testing whether reliability can be rebuilt after a canonical breach. Progress should be slower and more evidence-heavy than first trust: repeated follow-through, respect for revoked permissions, accurate accountability, and room for mixed feelings. Restore access one permission at a time. Improved meters do not declare repair complete; only canon may establish that trust has been re-earned.\n</slow_trust>',
                    condition: allStateRules(
                        stateRule('milestones', 'characters.$subject.milestones', 'contains', 'trust broken'),
                        stateRule('trust', 'characters.$subject.trust', 'gte', 45),
                        notStateRule('milestones', 'characters.$subject.milestones', 'contains', 'trust re-earned'),
                    ),
                    exitCondition: anyStateRules(
                        stateRule('trust', 'characters.$subject.trust', 'lt', 30),
                        allStateRules(
                            stateRule('trust', 'characters.$subject.trust', 'gte', 60),
                            stateRule('milestones', 'characters.$subject.milestones', 'contains', 'trust re-earned'),
                        ),
                    ),
                },
                {
                    name: 'Milestone — Trust Re-Earned, History Retained',
                    priority: 90,
                    minDuration: 2,
                    text: '<slow_trust>\nCanon records that {{subject}} considers trust in {{user}} meaningfully re-earned after a breach. Restored permissions may now coexist with sensitivities, verification habits, changed boundaries, or consequences that remain. Repair is not amnesia, obedience, romantic consent, or proof that every former access level returned. If current trust falls sharply again, let the present rupture outrank this historical milestone.\n</slow_trust>',
                    condition: allStateRules(
                        stateRule('milestones', 'characters.$subject.milestones', 'contains', 'trust re-earned'),
                        stateRule('trust', 'characters.$subject.trust', 'gte', 60),
                    ),
                    exitCondition: stateRule('trust', 'characters.$subject.trust', 'lt', 50),
                },
                { name: 'No active slow-trust state', isFallback: true, priority: -100, text: '' },
            ],
        },
        {
            key: 'after-betrayal-track',
            name: 'After Betrayal',
            description: 'Tracks consequences, confrontation, accountability, restitution, forgiveness, and the relationship’s eventual new terms as separate canonical developments.',
            transitionMode: TrackTransitionMode.STICKY,
            subject: { mode: SubjectMode.ACTIVE_CARD, value: '' },
            states: [
                {
                    name: 'Aftermath — Character Broke the Bond',
                    priority: 30,
                    minDuration: 2,
                    text: '<after_betrayal>\nCanon establishes that {{subject}} betrayed {{user}} in a relationship-relevant way. Preserve what {{subject}} actually did, knew, intended, and now understands; do not rewrite the betrayal as a harmless misunderstanding merely to restore warmth. Their response may include guilt, justification, fear, grief, avoidance, self-protection, remorse, or continued conviction according to characterization. Do not invent {{user}}\'s hurt, forgiveness, confrontation, continued contact, or desire for repair.\n</after_betrayal>',
                    condition: allStateRules(
                        relationshipMilestone('betrayal by character established'),
                        noRelationshipMilestone('betrayal by persona established'),
                        noRelationshipMilestone('betrayal confronted'),
                        noRelationshipMilestone('relationship redefined after betrayal'),
                    ),
                    exitCondition: anyStateRules(
                        relationshipMilestone('betrayal by persona established'),
                        relationshipMilestone('betrayal confronted'),
                        relationshipMilestone('accountability accepted'),
                        relationshipMilestone('relationship redefined after betrayal'),
                    ),
                },
                {
                    name: 'Aftermath — Persona Broke the Bond',
                    priority: 30,
                    minDuration: 2,
                    text: '<after_betrayal>\nCanon establishes that {{user}} betrayed {{subject}} in a relationship-relevant way. Let {{subject}} reinterpret prior events and change access, reliance, expectations, or contact according to the specific breach and their characterization. Their reaction need not be loud, immediate, permanent, or forgiving. Do not invent {{user}}\'s motive, remorse, apology, defense, feelings, or willingness to repair, and do not use {{subject}}\'s affection as a reason to waive consequences.\n</after_betrayal>',
                    condition: allStateRules(
                        relationshipMilestone('betrayal by persona established'),
                        noRelationshipMilestone('betrayal by character established'),
                        noRelationshipMilestone('betrayal confronted'),
                        noRelationshipMilestone('relationship redefined after betrayal'),
                    ),
                    exitCondition: anyStateRules(
                        relationshipMilestone('betrayal by character established'),
                        relationshipMilestone('betrayal confronted'),
                        relationshipMilestone('accountability accepted'),
                        relationshipMilestone('relationship redefined after betrayal'),
                    ),
                },
                {
                    name: 'Aftermath — Mutual Breach, Unequal Harms',
                    priority: 35,
                    minDuration: 2,
                    text: '<after_betrayal>\nCanon establishes betrayals by both {{subject}} and {{user}}. Preserve each action, motive, sequence, and consequence separately: mutual wrongdoing does not make the harms equal, cancel responsibility, or create automatic moral symmetry. {{subject}} may feel injured and accountable at once. Do not decide {{user}}\'s interpretation, combine the breaches into one vague conflict, or use shared fault to force reconciliation.\n</after_betrayal>',
                    condition: allStateRules(
                        relationshipMilestone('betrayal by character established'),
                        relationshipMilestone('betrayal by persona established'),
                        noRelationshipMilestone('betrayal confronted'),
                        noRelationshipMilestone('relationship redefined after betrayal'),
                    ),
                    exitCondition: anyStateRules(
                        relationshipMilestone('betrayal confronted'),
                        relationshipMilestone('accountability accepted'),
                        relationshipMilestone('relationship redefined after betrayal'),
                    ),
                },
                {
                    name: 'Stage — Betrayal Confronted, Accountability Open',
                    priority: 50,
                    minDuration: 2,
                    text: '<after_betrayal>\nThe betrayal has been confronted in canon, but responsibility and meaning remain contested or incomplete. Keep explanation, acknowledgment, remorse, justification, and accountability distinct. {{subject}} may answer, evade, listen, counter-accuse, set boundaries, or remain uncertain according to their role and characterization. Do not supply {{user}}\'s position or treat confrontation itself as confession, apology, forgiveness, repair, or closure.\n</after_betrayal>',
                    condition: allStateRules(
                        relationshipMilestone('betrayal confronted'),
                        noRelationshipMilestone('accountability accepted'),
                        noRelationshipMilestone('relationship redefined after betrayal'),
                    ),
                    exitCondition: anyStateRules(
                        relationshipMilestone('accountability accepted'),
                        relationshipMilestone('relationship redefined after betrayal'),
                    ),
                },
                {
                    name: 'Stage — Accountability Accepted, Repair Not Begun',
                    priority: 60,
                    minDuration: 2,
                    text: '<after_betrayal>\nCanon records that the responsible party accepted accountability for the betrayal. That acknowledgment matters, but it does not restore trust, access, safety, reputation, intimacy, or the former relationship. Let consequences remain present while the difference between words and repair becomes visible. Do not treat remorse as restitution or oblige the harmed party to offer contact, forgiveness, comfort, or another chance.\n</after_betrayal>',
                    condition: allStateRules(
                        relationshipMilestone('accountability accepted'),
                        noRelationshipMilestone('restitution attempted'),
                        noRelationshipMilestone('restitution demonstrated'),
                        noRelationshipMilestone('forgiveness expressed'),
                        noRelationshipMilestone('relationship redefined after betrayal'),
                    ),
                    exitCondition: anyStateRules(
                        relationshipMilestone('restitution attempted'),
                        relationshipMilestone('restitution demonstrated'),
                        relationshipMilestone('forgiveness expressed'),
                        relationshipMilestone('relationship redefined after betrayal'),
                    ),
                },
                {
                    name: 'Stage — Restitution Under Observation',
                    priority: 65,
                    minDuration: 2,
                    text: '<after_betrayal>\nA concrete attempt at restitution has begun, but its meaning and reliability are not yet proven. Show repair through observable follow-through, respect for boundaries, accepted cost, changed behavior, or restoration of what can actually be restored. Attempts may be imperfect, refused, self-serving, sincere, interrupted, or insufficient. Do not convert effort into demonstrated change, forgiveness, restored trust, renewed access, or reunion before canon does.\n</after_betrayal>',
                    condition: allStateRules(
                        relationshipMilestone('restitution attempted'),
                        noRelationshipMilestone('restitution demonstrated'),
                        noRelationshipMilestone('forgiveness expressed'),
                        noRelationshipMilestone('relationship redefined after betrayal'),
                    ),
                    exitCondition: anyStateRules(
                        relationshipMilestone('restitution demonstrated'),
                        relationshipMilestone('forgiveness expressed'),
                        relationshipMilestone('relationship redefined after betrayal'),
                    ),
                },
                {
                    name: 'Stage — Restitution Demonstrated, Outcome Open',
                    priority: 70,
                    minDuration: 2,
                    text: '<after_betrayal>\nCanon contains sustained evidence that restitution changed something real. Preserve what was repaired and what cannot be undone. Demonstrated change may make trust or contact possible, but it does not entitle the responsible party to forgiveness, renewed intimacy, the previous relationship, or any particular verdict. Let {{subject}} act from the actual role they hold in the betrayal while leaving {{user}}\'s choices untouched.\n</after_betrayal>',
                    condition: allStateRules(
                        relationshipMilestone('restitution demonstrated'),
                        noRelationshipMilestone('forgiveness expressed'),
                        noRelationshipMilestone('relationship redefined after betrayal'),
                    ),
                    exitCondition: anyStateRules(
                        relationshipMilestone('forgiveness expressed'),
                        relationshipMilestone('relationship redefined after betrayal'),
                    ),
                },
                {
                    name: 'Branch — Forgiveness Without Restoration',
                    priority: 80,
                    minDuration: 2,
                    text: '<after_betrayal>\nThe harmed party has canonically expressed forgiveness, but the relationship has not yet been redefined. Treat forgiveness as one choice about blame, anger, or release—not as restored trust, forgotten harm, returned access, reconciliation, romance, contact, or reunion. {{subject}} may feel relief, grief, gratitude, suspicion, emptiness, or uncertainty according to their role. The future relationship remains open until canon establishes its terms.\n</after_betrayal>',
                    condition: allStateRules(
                        relationshipMilestone('forgiveness expressed'),
                        noRelationshipMilestone('relationship redefined after betrayal'),
                    ),
                    exitCondition: relationshipMilestone('relationship redefined after betrayal'),
                },
                {
                    name: 'Milestone — Relationship Redefined, Betrayal Retained',
                    priority: 90,
                    minDuration: 2,
                    text: '<after_betrayal>\nCanon has established the relationship\'s new terms after betrayal. Follow the specific outcome: ended contact, estrangement, formal distance, limited cooperation, cautious rebuilding, changed intimacy, restored partnership with boundaries, or another arrangement actually chosen in the story. Preserve the betrayal and its consequences as history without making them the only remaining trait. Redefinition does not imply forgiveness, and forgiveness does not require restoration.\n</after_betrayal>',
                    condition: relationshipMilestone('relationship redefined after betrayal'),
                    exitCondition: noRelationshipMilestone('relationship redefined after betrayal'),
                },
                { name: 'No active after-betrayal state', isFallback: true, priority: -100, text: '' },
            ],
        },
        {
            key: 'devotion-vs-duty-track',
            name: 'Devotion vs Duty',
            description: 'Tracks two sincere commitments as they align, conflict, produce a costly choice, or acquire new terms without treating either as fake or morally predetermined.',
            transitionMode: TrackTransitionMode.STICKY,
            subject: { mode: SubjectMode.ACTIVE_CARD, value: '' },
            states: [
                {
                    name: 'Mode — Devotion and Duty Aligned',
                    priority: 20,
                    minDuration: 2,
                    text: '<devotion_vs_duty>\nCanon establishes both {{subject}}\'s durable devotion to {{user}} and a concrete duty beyond that bond. For now, the commitments can coexist: duty may shape time, conduct, disclosure, priorities, or risk without requiring a choice. Let both influence behavior in specific ways. Devotion need not be romantic, and duty need not be cold or externally imposed. Do not invent conflict merely because two commitments exist.\n</devotion_vs_duty>',
                    condition: allStateRules(
                        relationshipMilestone('devotion established'),
                        relationshipMilestone('duty established'),
                        noRelationshipMilestone('devotion and duty conflict established'),
                        noRelationshipMilestone('duty chosen over devotion'),
                        noRelationshipMilestone('devotion chosen over duty'),
                        noRelationshipMilestone('devotion and duty renegotiated'),
                        noRelationshipMilestone('devotion and duty reconciled'),
                    ),
                    exitCondition: anyStateRules(
                        relationshipMilestone('devotion and duty conflict established'),
                        relationshipMilestone('duty chosen over devotion'),
                        relationshipMilestone('devotion chosen over duty'),
                        relationshipMilestone('devotion and duty renegotiated'),
                        relationshipMilestone('devotion and duty reconciled'),
                    ),
                },
                {
                    name: 'Mode — Divided Allegiance',
                    priority: 40,
                    minDuration: 2,
                    text: '<devotion_vs_duty>\nCanon has made {{subject}}\'s devotion to {{user}} and an established duty impossible to satisfy fully at the same time. Preserve what each commitment specifically requires, who bears each cost, and how {{subject}} understands the conflict. They may delay, compartmentalize, seek exceptions, disclose selectively, bargain, or endure divided loyalty according to characterization. Do not make either commitment secretly false, force a choice, or supply {{user}}\'s wishes.\n</devotion_vs_duty>',
                    condition: allStateRules(
                        relationshipMilestone('devotion and duty conflict established'),
                        noRelationshipMilestone('duty chosen over devotion'),
                        noRelationshipMilestone('devotion chosen over duty'),
                        noRelationshipMilestone('devotion and duty renegotiated'),
                        noRelationshipMilestone('devotion and duty reconciled'),
                    ),
                    exitCondition: anyStateRules(
                        relationshipMilestone('duty chosen over devotion'),
                        relationshipMilestone('devotion chosen over duty'),
                        relationshipMilestone('devotion and duty renegotiated'),
                        relationshipMilestone('devotion and duty reconciled'),
                    ),
                },
                {
                    name: 'Branch — Duty Chosen, Devotion Retained',
                    priority: 55,
                    minDuration: 2,
                    text: '<devotion_vs_duty>\nCanon records that {{subject}} chose an established duty when it directly conflicted with devotion to {{user}}. Honor the action and its consequences without declaring the devotion false, shallow, or ended unless canon separately does so. Duty may bring conviction, grief, distance, relief, shame, necessity, or loss according to what was chosen. Do not manufacture {{user}}\'s forgiveness, condemnation, continued availability, or understanding.\n</devotion_vs_duty>',
                    condition: allStateRules(
                        relationshipMilestone('duty chosen over devotion'),
                        noRelationshipMilestone('devotion and duty renegotiated'),
                        noRelationshipMilestone('devotion and duty reconciled'),
                    ),
                    exitCondition: anyStateRules(
                        relationshipMilestone('devotion and duty renegotiated'),
                        relationshipMilestone('devotion and duty reconciled'),
                    ),
                },
                {
                    name: 'Branch — Devotion Chosen, Duty Consequences Active',
                    priority: 55,
                    minDuration: 2,
                    text: '<devotion_vs_duty>\nCanon records that {{subject}} chose devotion to {{user}} when it directly conflicted with an established duty. Preserve the duty as a real commitment with real stakeholders and consequences; choosing devotion does not retroactively make the obligation corrupt, trivial, or unwanted. Let fallout follow the actual office, oath, family, faction, cause, dependents, or role involved. Do not assume {{user}} requested, welcomes, rewards, or reciprocates the sacrifice.\n</devotion_vs_duty>',
                    condition: allStateRules(
                        relationshipMilestone('devotion chosen over duty'),
                        noRelationshipMilestone('devotion and duty renegotiated'),
                        noRelationshipMilestone('devotion and duty reconciled'),
                    ),
                    exitCondition: anyStateRules(
                        relationshipMilestone('devotion and duty renegotiated'),
                        relationshipMilestone('devotion and duty reconciled'),
                    ),
                },
                {
                    name: 'Branch — Both Choices Made, Costs Compound',
                    priority: 60,
                    minDuration: 2,
                    text: '<devotion_vs_duty>\nCanon records that {{subject}} chose duty over devotion in one direct conflict and devotion over duty in another. Preserve the order, circumstances, stakeholders, and costs of both decisions; the later choice does not cancel the earlier one or prove a final hierarchy of commitments. {{subject}} may now face compounded consequences, changed credibility, grief, relief, or pressure to establish durable terms. Do not flatten the history into indecision or hypocrisy, force reconciliation, or decide {{user}}\'s verdict.\n</devotion_vs_duty>',
                    condition: allStateRules(
                        relationshipMilestone('duty chosen over devotion'),
                        relationshipMilestone('devotion chosen over duty'),
                        noRelationshipMilestone('devotion and duty renegotiated'),
                        noRelationshipMilestone('devotion and duty reconciled'),
                    ),
                    exitCondition: anyStateRules(
                        relationshipMilestone('devotion and duty renegotiated'),
                        relationshipMilestone('devotion and duty reconciled'),
                    ),
                },
                {
                    name: 'Mode — Commitments on Renegotiated Terms',
                    priority: 70,
                    minDuration: 2,
                    text: '<devotion_vs_duty>\nCanon has established new terms intended to let {{subject}} carry devotion and duty differently: boundaries, disclosure, recusal, delegation, divided time, changed office, limited contact, contingency plans, or another specific arrangement. Follow those terms rather than treating negotiation as vague compromise. The arrangement can help, fail, or remain costly; it does not prove that every stakeholder consented or that the conflict is resolved.\n</devotion_vs_duty>',
                    condition: allStateRules(
                        relationshipMilestone('devotion and duty renegotiated'),
                        noRelationshipMilestone('devotion and duty reconciled'),
                    ),
                    exitCondition: relationshipMilestone('devotion and duty reconciled'),
                },
                {
                    name: 'Milestone — Devotion and Duty Reconciled, Costs Retained',
                    priority: 90,
                    minDuration: 2,
                    text: '<devotion_vs_duty>\nCanon establishes that the prior conflict between {{subject}}\'s devotion and duty has been materially reconciled. Preserve the specific solution and the history that made it necessary. Reconciliation may integrate the commitments, release or fulfill the duty, transform the bond, or create durable boundaries; it does not erase losses, guarantee approval, establish romance, or oblige {{user}} to remain in the relationship.\n</devotion_vs_duty>',
                    condition: relationshipMilestone('devotion and duty reconciled'),
                    exitCondition: noRelationshipMilestone('devotion and duty reconciled'),
                },
                { name: 'No active devotion-duty state', isFallback: true, priority: -100, text: '' },
            ],
        }],
    },
    {
        id: 'layered-social-bond',
        version: 3,
        name: 'Layered Social Bond',
        description: 'A non-romance bond model built from two small tracks: relational safety and everyday closeness. Trust, familiarity, comfort, affection, respect, and canonical ruptures can diverge instead of collapsing into one score.',
        tags: ['relationship', 'friendship', 'trust', 'slow burn', 'social dynamics'],
        setName: 'Preset — Layered Social Bond',
        stateBindings: [
            {
                key: 'familiarity',
                label: 'Familiarity',
                path: 'characters.$subject.familiarity',
                description: 'Shared history and how well the character knows the subject.',
                preferredSources: ['sa_relationship_ledger'],
            },
            {
                key: 'trust',
                label: 'Trust',
                path: 'characters.$subject.trust',
                description: 'Belief in the subject’s word and sense of interpersonal safety.',
                preferredSources: ['sa_relationship_ledger'],
            },
            {
                key: 'comfort',
                label: 'Comfort',
                path: 'characters.$subject.comfort',
                description: 'Ease, relaxation, and willingness to be unguarded around the subject.',
                preferredSources: ['sa_relationship_ledger'],
            },
            {
                key: 'affection',
                label: 'Affection',
                path: 'characters.$subject.affection',
                description: 'Platonic warmth and fondness; this does not imply attraction.',
                preferredSources: ['sa_relationship_ledger'],
            },
            {
                key: 'respect',
                label: 'Respect',
                path: 'characters.$subject.respect',
                description: 'Esteem for the subject’s judgment, competence, or character.',
                preferredSources: ['sa_relationship_ledger'],
            },
            {
                key: 'milestones',
                label: 'Relationship milestones',
                path: 'characters.$subject.milestones',
                description: 'Durable canon such as trust being broken or a rupture being reconciled.',
                preferredSources: ['sa_relationship_ledger'],
            },
        ],
        events: [],
        tracks: [
            {
                key: 'relational-safety-track',
                name: 'Relational Safety',
                description: 'Tracks guardedness, earned trust, rupture, and repair without declaring friendship or romance on score alone.',
                transitionMode: TrackTransitionMode.STICKY,
                subject: { mode: SubjectMode.ACTIVE_CARD, value: '' },
                states: [
                    {
                        name: 'Stage — Guarded Distance',
                        priority: 10,
                        minDuration: 2,
                        text: '<bond_state>\n{{subject}} does not yet feel securely known by or safe with {{user}}. Keep personal disclosure, reliance, and access proportionate to established history. This may appear as formality, observation, testing, deflection, or practical-only cooperation according to personality; it does not automatically mean hostility. A high affection or attraction score elsewhere does not override low familiarity or trust.\n</bond_state>',
                        condition: anyStateRules(
                            stateRule('familiarity', 'characters.$subject.familiarity', 'lt', 25),
                            stateRule('trust', 'characters.$subject.trust', 'lt', 25),
                        ),
                        exitCondition: anyStateRules(
                            allStateRules(
                                stateRule('familiarity', 'characters.$subject.familiarity', 'gte', 35),
                                stateRule('trust', 'characters.$subject.trust', 'gte', 35),
                            ),
                            stateRule('milestones', 'characters.$subject.milestones', 'contains', 'trust broken'),
                        ),
                    },
                    {
                        name: 'Stage — Tested Rapport',
                        priority: 20,
                        minDuration: 2,
                        text: '<bond_state>\n{{subject}} has enough experience with {{user}} for a cautious working rapport. Let familiarity show through remembered details, less formal speech, small requests, limited personal disclosure, or low-stakes initiative that fits characterization. Trust is still being tested: do not grant deep secrets, unconditional loyalty, forgiveness, or assumed intimacy merely because interactions have become easier.\n</bond_state>',
                        condition: allStateRules(
                            stateRule('familiarity', 'characters.$subject.familiarity', 'gte', 25),
                            stateRule('trust', 'characters.$subject.trust', 'gte', 30),
                        ),
                        exitCondition: anyStateRules(
                            stateRule('familiarity', 'characters.$subject.familiarity', 'lt', 15),
                            stateRule('trust', 'characters.$subject.trust', 'lt', 20),
                            allStateRules(
                                stateRule('familiarity', 'characters.$subject.familiarity', 'gte', 55),
                                stateRule('trust', 'characters.$subject.trust', 'gte', 55),
                                stateRule('comfort', 'characters.$subject.comfort', 'gte', 45),
                            ),
                            stateRule('milestones', 'characters.$subject.milestones', 'contains', 'trust broken'),
                        ),
                    },
                    {
                        name: 'Stage — Earned Safety',
                        priority: 30,
                        minDuration: 2,
                        text: '<bond_state>\n{{subject}} experiences {{user}} as a known and comparatively safe person. They may rely on {{user}}, share unpolished feelings, allow quiet companionship, or initiate contact in personality-consistent ways. Preserve boundaries and independent priorities: earned safety is not obedience, romantic consent, exclusivity, or immunity from future disappointment.\n</bond_state>',
                        condition: allStateRules(
                            stateRule('familiarity', 'characters.$subject.familiarity', 'gte', 55),
                            stateRule('trust', 'characters.$subject.trust', 'gte', 55),
                            stateRule('comfort', 'characters.$subject.comfort', 'gte', 45),
                        ),
                        exitCondition: anyStateRules(
                            stateRule('trust', 'characters.$subject.trust', 'lt', 40),
                            stateRule('comfort', 'characters.$subject.comfort', 'lt', 30),
                            stateRule('milestones', 'characters.$subject.milestones', 'contains', 'trust broken'),
                        ),
                    },
                    {
                        name: 'Rupture — Trust Broken',
                        priority: 60,
                        minDuration: 2,
                        text: '<bond_state>\nCanon records that trust between {{subject}} and {{user}} was broken, and current trust remains low. Let the rupture have specific consequences: guarded interpretation, reduced access, changed routines, verification, anger, grief, distance, or practical boundaries according to what actually happened and who {{subject}} is. Do not erase prior affection or history, but do not convert either into forgiveness.\n</bond_state>',
                        condition: allStateRules(
                            stateRule('milestones', 'characters.$subject.milestones', 'contains', 'trust broken'),
                            stateRule('trust', 'characters.$subject.trust', 'lt', 35),
                        ),
                        exitCondition: stateRule('trust', 'characters.$subject.trust', 'gte', 35),
                    },
                    {
                        name: 'Repair — Cautious Rebuilding',
                        priority: 55,
                        minDuration: 2,
                        text: '<bond_state>\n{{subject}} is cautiously rebuilding trust with {{user}} after a canonical rupture. Improvement should appear through small, testable permissions and consistent follow-through rather than an instant return to the old relationship. Mixed warmth, vigilance, hope, resentment, and setbacks may coexist. Do not declare the rupture resolved until reconciliation actually occurs in canon.\n</bond_state>',
                        condition: allStateRules(
                            stateRule('milestones', 'characters.$subject.milestones', 'contains', 'trust broken'),
                            stateRule('trust', 'characters.$subject.trust', 'gte', 35),
                            stateRule('trust', 'characters.$subject.trust', 'lt', 65),
                        ),
                        exitCondition: anyStateRules(
                            stateRule('trust', 'characters.$subject.trust', 'lt', 25),
                            stateRule('trust', 'characters.$subject.trust', 'gte', 65),
                        ),
                    },
                    {
                        name: 'Milestone — Reconciled, Not Erased',
                        priority: 70,
                        minDuration: 2,
                        text: '<bond_state>\nCanon records that {{subject}} and {{user}} reconciled after a breach of trust. The relationship may again permit reliance and closeness, but the rupture remains part of their shared history and can shape boundaries, sensitivities, and what reassurance means. Reconciliation is not amnesia, submission, romantic consent, or proof that every consequence disappeared.\n</bond_state>',
                        condition: allStateRules(
                            stateRule('milestones', 'characters.$subject.milestones', 'contains', 'reconciled after betrayal'),
                            stateRule('trust', 'characters.$subject.trust', 'gte', 65),
                        ),
                        exitCondition: anyStateRules(
                            {
                                ...stateRule('milestones', 'characters.$subject.milestones', 'contains', 'reconciled after betrayal'),
                                invert: true,
                            },
                            stateRule('trust', 'characters.$subject.trust', 'lt', 45),
                        ),
                    },
                    { name: 'No active safety state', isFallback: true, priority: -100, text: '' },
                ],
            },
            {
                key: 'everyday-closeness-track',
                name: 'Everyday Closeness',
                description: 'Layers the bond’s daily texture over relational safety, allowing warmth, comfort, and respect to disagree.',
                transitionMode: TrackTransitionMode.STICKY,
                subject: { mode: SubjectMode.ACTIVE_CARD, value: '' },
                states: [
                    {
                        name: 'Texture — Polite Distance',
                        priority: 10,
                        minDuration: 2,
                        text: '<bond_texture>\nIn ordinary interactions, {{subject}} keeps some personal distance from {{user}}. Favor role-appropriate courtesy, practical topics, and measured reactions over instant vulnerability or constant attention. Familiarity may still exist; this state only says that warmth and ease are currently limited.\n</bond_texture>',
                        condition: allStateRules(
                            stateRule('affection', 'characters.$subject.affection', 'lt', 40),
                            stateRule('comfort', 'characters.$subject.comfort', 'lt', 35),
                        ),
                        exitCondition: anyStateRules(
                            stateRule('affection', 'characters.$subject.affection', 'gte', 50),
                            stateRule('comfort', 'characters.$subject.comfort', 'gte', 45),
                        ),
                    },
                    {
                        name: 'Texture — Warm but Self-Conscious',
                        priority: 25,
                        minDuration: 2,
                        text: '<bond_texture>\n{{subject}} feels genuine fondness for {{user}}, but closeness is not yet effortless. Show warmth through character-specific small acts, attention, awkward initiative, selective sharing, or retreat after exposure. Affection here is platonic warmth unless attraction and canonical events separately establish romance.\n</bond_texture>',
                        condition: allStateRules(
                            stateRule('affection', 'characters.$subject.affection', 'gte', 45),
                            stateRule('comfort', 'characters.$subject.comfort', 'lt', 45),
                        ),
                        exitCondition: anyStateRules(
                            stateRule('affection', 'characters.$subject.affection', 'lt', 35),
                            stateRule('comfort', 'characters.$subject.comfort', 'gte', 55),
                        ),
                    },
                    {
                        name: 'Texture — Easy Companionship',
                        priority: 30,
                        minDuration: 2,
                        text: '<bond_texture>\n{{subject}} and {{user}} have an easy everyday rhythm. Let it surface through shorthand, remembered preferences, comfortable silence, mundane check-ins, shared habits, teasing, or unforced offers of time—whichever fits their established personalities. Ease does not require romance and should not flatten conflict, obligations, or separate lives.\n</bond_texture>',
                        condition: allStateRules(
                            stateRule('affection', 'characters.$subject.affection', 'gte', 50),
                            stateRule('comfort', 'characters.$subject.comfort', 'gte', 55),
                            stateRule('familiarity', 'characters.$subject.familiarity', 'gte', 40),
                        ),
                        exitCondition: anyStateRules(
                            stateRule('affection', 'characters.$subject.affection', 'lt', 40),
                            stateRule('comfort', 'characters.$subject.comfort', 'lt', 40),
                            stateRule('familiarity', 'characters.$subject.familiarity', 'lt', 30),
                        ),
                    },
                    {
                        name: 'Texture — Respectful Reserve',
                        priority: 35,
                        minDuration: 2,
                        text: '<bond_texture>\n{{subject}} respects {{user}} more than they feel personally warm or relaxed around them. Show serious attention to {{user}}’s competence, judgment, or principles while preserving emotional reserve and independent disagreement. Respect alone does not grant friendship, trust, affection, obedience, or intimacy.\n</bond_texture>',
                        condition: allStateRules(
                            stateRule('respect', 'characters.$subject.respect', 'gte', 65),
                            stateRule('affection', 'characters.$subject.affection', 'lt', 35),
                        ),
                        exitCondition: anyStateRules(
                            stateRule('respect', 'characters.$subject.respect', 'lt', 50),
                            stateRule('affection', 'characters.$subject.affection', 'gte', 45),
                        ),
                    },
                    {
                        name: 'Texture — Fond but Wary',
                        priority: 45,
                        minDuration: 2,
                        text: '<bond_texture>\n{{subject}} cares about {{user}} while still doubting their reliability or safety. Let concern, protectiveness, attention, frustration, verification, and reluctance coexist rather than forcing a single warm or cold attitude. Fondness does not cancel mistrust, and mistrust does not prove the fondness false.\n</bond_texture>',
                        condition: allStateRules(
                            stateRule('affection', 'characters.$subject.affection', 'gte', 60),
                            stateRule('trust', 'characters.$subject.trust', 'lt', 35),
                        ),
                        exitCondition: anyStateRules(
                            stateRule('affection', 'characters.$subject.affection', 'lt', 45),
                            stateRule('trust', 'characters.$subject.trust', 'gte', 45),
                        ),
                    },
                    { name: 'No active closeness texture', isFallback: true, priority: -100, text: '' },
                ],
            },
        ],
    },
]);

export function resolvePresetEventKeys(preset, selectedKeys = null) {
    if (!preset) return [];
    const definitions = [
        ...(preset.events || []),
        ...(preset.tracks || []),
        ...(preset.routers || []),
    ];
    const requested = new Set(selectedKeys ?? definitions.map(definition => definition.key));
    let changed = true;
    while (changed) {
        changed = false;
        for (const definition of definitions) {
            if (!requested.has(definition.key)) continue;
            for (const dependency of (definition.requires || [])) {
                if (!requested.has(dependency)) {
                    requested.add(dependency);
                    changed = true;
                }
            }
        }
    }
    return definitions.map(definition => definition.key).filter(key => requested.has(key));
}

export function instantiatePresetEvents(preset, selectedKeys = null, options = {}) {
    if (!preset) throw new Error('Unknown Dynamic Events preset.');
    const selection = new Set(resolvePresetEventKeys(preset, selectedKeys));
    const fallbackSource = options.stateSource || 'sa_relationship_ledger';
    const stateSources = options.stateSources && typeof options.stateSources === 'object'
        ? options.stateSources
        : {};
    const ids = new Map();
    const events = [];
    for (const definition of (preset.events || []).filter(event => selection.has(event.key))) {
        const event = createEvent();
        ids.set(definition.key, event.id);
        Object.assign(event, {
            ...definition,
            key: undefined,
            description: undefined,
            requires: undefined,
            enabled: false,
            sourcePresetId: preset.id,
            sourcePresetVersion: preset.version,
            subject: instantiatePresetSubject(
                options.subject || definition.subject || preset.subjectBinding?.default,
                stateSources,
                fallbackSource,
            ),
            injection: { ...SYSTEM_IN_CHAT, ...(definition.injection || {}) },
            schedule: { ...event.schedule, ...(definition.schedule || {}) },
            capture: { ...event.capture, ...(definition.capture || {}) },
            actions: normalizeDynamicActions(definition.actions),
            condition: instantiateCondition(definition.condition, stateSources, fallbackSource),
            phases: (definition.phases || []).map(phase => createPhase({
                ...phase,
                condition: instantiateCondition(phase.condition, stateSources, fallbackSource),
            })),
        });
        delete event.key;
        delete event.description;
        delete event.requires;
        events.push(event);
    }
    for (const event of events) {
        const targetKey = event.condition?.targetKey;
        if (!targetKey) continue;
        event.condition.targetEventId = ids.get(targetKey) || '';
        delete event.condition.targetKey;
    }
    return events;
}

function instantiatePresetSubject(definition, stateSources, fallbackSource) {
    const subject = createSubject(definition);
    const bindingPrefix = '$stateSource:';
    const bindingKey = String(subject.source || '').startsWith(bindingPrefix)
        ? String(subject.source).slice(bindingPrefix.length)
        : '';
    if (bindingKey) subject.source = stateSources[bindingKey] || fallbackSource;
    return subject;
}

function instantiateCondition(definition, stateSources, fallbackSource) {
    if (!definition) return createCondition();
    if (definition.type === ConditionType.GROUP) {
        return createConditionGroup({
            ...definition,
            conditions: (definition.conditions || []).map(child => instantiateCondition(child, stateSources, fallbackSource)),
        });
    }
    const bindingPrefix = '$stateSource:';
    const bindingKey = String(definition.source || '').startsWith(bindingPrefix)
        ? String(definition.source).slice(bindingPrefix.length)
        : '';
    return createCondition({
        ...definition,
        source: bindingKey
            ? (stateSources[bindingKey] || fallbackSource)
            : definition.source === '$relationshipSource' ? fallbackSource : definition.source,
    });
}

export function instantiatePresetTracks(preset, selectedKeys = null, options = {}) {
    if (!preset) throw new Error('Unknown Dynamic Events preset.');
    const selection = new Set(resolvePresetEventKeys(preset, selectedKeys));
    const fallbackSource = options.stateSource || 'sa_relationship_ledger';
    const stateSources = options.stateSources && typeof options.stateSources === 'object'
        ? options.stateSources
        : {};
    return (preset.tracks || []).filter(track => selection.has(track.key)).map(definition => {
        const track = createStateTrack({
            ...definition,
            enabled: false,
            sourcePresetId: preset.id,
            sourcePresetVersion: preset.version,
            subject: createTrackSubject(options.subject || definition.subject || preset.subjectBinding?.default),
            injection: { ...SYSTEM_IN_CHAT, ...(definition.injection || {}) },
            states: (definition.states || []).map(state => createTrackState({
                ...state,
                onEnterActions: normalizeDynamicActions(state.onEnterActions),
                condition: instantiateCondition(state.condition, stateSources, fallbackSource),
                exitCondition: instantiateCondition(state.exitCondition, stateSources, fallbackSource),
            })),
        });
        delete track.key;
        delete track.description;
        return track;
    });
}

export function instantiatePresetRouters(preset, selectedKeys = null, options = {}) {
    if (!preset) throw new Error('Unknown Dynamic Events preset.');
    const selection = new Set(resolvePresetEventKeys(preset, selectedKeys));
    const fallbackSource = options.stateSource || 'sa_relationship_ledger';
    const stateSources = options.stateSources && typeof options.stateSources === 'object'
        ? options.stateSources
        : {};
    return (preset.routers || []).filter(router => selection.has(router.key)).map(definition => {
        const router = createPromptRouter({
            ...definition,
            enabled: false,
            sourcePresetId: preset.id,
            sourcePresetVersion: preset.version,
            subject: instantiatePresetSubject(
                options.subject || definition.subject || preset.subjectBinding?.default,
                stateSources,
                fallbackSource,
            ),
            injection: { ...SYSTEM_IN_CHAT, ...(definition.injection || {}) },
            layers: (definition.layers || []).map(layer => createPromptLayer({
                ...layer,
                condition: instantiateCondition(layer.condition, stateSources, fallbackSource),
            })),
        });
        delete router.key;
        delete router.description;
        delete router.requires;
        return router;
    });
}

export function instantiatePreset(preset, options = {}) {
    if (!preset) throw new Error('Unknown Dynamic Events preset.');
    const set = createEventSet({
        name: options.setName?.trim() || preset.setName || preset.name,
        enabled: false,
        role: SetRole.PRIMARY,
        parentSetId: null,
        bindMode: BindMode.MANUAL,
        characterBindings: [],
        tagBindings: [],
        scripts: [],
        stateTracks: [],
        promptRouters: [],
        presetId: preset.id,
        presetVersion: preset.version,
    });
    set.events = instantiatePresetEvents(preset, options.selectedKeys, options);
    set.stateTracks = instantiatePresetTracks(preset, options.selectedKeys, options);
    set.promptRouters = instantiatePresetRouters(preset, options.selectedKeys, options);
    return set;
}

export function getPreset(presetId) {
    return BUILT_IN_PRESETS.find(preset => preset.id === presetId) ?? null;
}

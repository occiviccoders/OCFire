// Readiness checklists, condensed from CAL FIRE "Ready, Set, Go!", OC Fire Authority and the
// Board of Forestry defensible-space guidance. Item ids are stored, so keep them stable.
export const CHECKLISTS = [
    {
        id: 'space',
        tab: 'Defensible space',
        intro: 'Most homes lost in wildfires are ignited by embers, not the flame front. Clearing the ground around the house is the single biggest thing you control. 100 ft is the legal minimum in High and Very High zones.',
        sections: [
            {
                title: 'Zone 0 · 0–5 ft from the house (ember-resistant)',
                items: [
                    ['z0-mulch', 'Replace bark mulch and plants against the house with gravel, pavers or bare soil'],
                    ['z0-gutters', 'Clear leaves and needles from the roof, gutters and under decks'],
                    ['z0-wood', 'Move firewood, lumber and propane tanks at least 30 ft away'],
                    ['z0-furniture', 'Keep cushions, doormats and trash bins away from walls (bring them in on Red Flag days)'],
                    ['z0-fence', 'Use a metal gate or masonry where a wood fence meets the house'],
                ],
            },
            {
                title: 'Zone 1 · 5–30 ft (lean, clean and green)',
                items: [
                    ['z1-dead', 'Remove dead plants, grass, weeds and fallen leaves'],
                    ['z1-trees', 'Trim branches 10 ft back from the roof and chimney'],
                    ['z1-spacing', 'Space trees and shrubs so their canopies don’t touch'],
                    ['z1-irrigate', 'Keep plants watered; prefer low, fire-resistant species'],
                ],
            },
            {
                title: 'Zone 2 · 30–100 ft (reduce fuel)',
                items: [
                    ['z2-grass', 'Mow grass to 4 inches or less (before 10 am — blades spark on rocks)'],
                    ['z2-ladder', 'Prune tree limbs up 6 ft from the ground so fire can’t climb'],
                    ['z2-gaps', 'Leave horizontal gaps between shrub islands and trees'],
                ],
            },
        ],
    },
    {
        id: 'home',
        tab: 'Harden home',
        intro: 'Embers can blow a mile ahead of a fire and get in through vents, gutters and gaps. These upgrades keep them out.',
        sections: [
            {
                title: 'Roof and openings',
                items: [
                    ['h-roof', 'Class A fire-rated roof (tile, metal, composition); plug gaps at the ridge and edges'],
                    ['h-vents', 'Cover attic, eave and foundation vents with 1/8-inch metal mesh or ember-resistant vents'],
                    ['h-gutter', 'Metal gutter guards; noncombustible gutters'],
                    ['h-chimney', 'Spark arrestor on the chimney'],
                ],
            },
            {
                title: 'Walls, windows and decks',
                items: [
                    ['h-windows', 'Dual-pane windows with at least one tempered pane'],
                    ['h-base', '6 inches of noncombustible material at the base of exterior walls'],
                    ['h-eaves', 'Enclosed (boxed) eaves'],
                    ['h-deck', 'Noncombustible deck surface near the house; nothing stored underneath'],
                    ['h-garage', 'Weather-stripping on garage doors; no gaps for embers'],
                ],
            },
            {
                title: 'Water and access',
                items: [
                    ['h-hose', 'Hoses long enough to reach every side of the house'],
                    ['h-address', 'Address numbers visible from the street for fire crews'],
                    ['h-ladder', 'A ladder that reaches the roof'],
                ],
            },
        ],
    },
    {
        id: 'bag',
        tab: 'Go bag',
        intro: 'Pack it now and keep it by the door or in the car. When there’s an evacuation warning you may have minutes.',
        sections: [
            {
                title: 'The six P’s',
                items: [
                    ['b-people', 'People and pets — carriers, leashes, pet food and records'],
                    ['b-papers', 'Papers — IDs, insurance, deeds, passports (or photos of them in the cloud)'],
                    ['b-rx', 'Prescriptions — a week of medications, glasses, hearing aids'],
                    ['b-pictures', 'Pictures and irreplaceable keepsakes'],
                    ['b-pc', 'Phone, laptop, chargers and a charged power bank'],
                    ['b-plastic', 'Plastic — credit cards and some cash'],
                ],
            },
            {
                title: 'Also pack',
                items: [
                    ['b-n95', 'N95 masks for everyone (cloth and surgical masks don’t filter smoke)'],
                    ['b-water', 'Water and snacks for 3 days'],
                    ['b-light', 'Flashlight, battery or crank radio, spare batteries'],
                    ['b-clothes', 'Long sleeves, sturdy shoes, a change of clothes'],
                    ['b-map', 'A paper map with two ways out marked'],
                ],
            },
        ],
    },
    {
        id: 'leave',
        tab: 'Leaving',
        intro: 'Know before the warning comes. Leaving early — at the evacuation warning, not the order — is the safest choice, especially with kids, pets or limited mobility.',
        sections: [
            {
                title: 'Set up now',
                items: [
                    ['l-alertoc', 'Sign up for AlertOC (or your county’s alert system)', 'https://www.alertoc.com'],
                    ['l-zone', 'Look up your evacuation zone on Genasys Protect', 'https://protect.genasys.com'],
                    ['l-routes', 'Plan two ways out of your neighborhood (try the route planner)'],
                    ['l-meet', 'Agree on a meeting place and an out-of-area contact'],
                    ['l-power', 'If someone relies on powered medical equipment, enroll in your utility’s Medical Baseline program and have backup power'],
                ],
            },
            {
                title: 'When an evacuation warning comes',
                items: [
                    ['l-car', 'Back the car into the driveway, loaded, windows closed; keep the tank half full'],
                    ['l-close', 'Close all windows, doors and vents — leave them unlocked'],
                    ['l-gas', 'Shut off gas at the meter and turn off pilot lights'],
                    ['l-lights', 'Leave lights on so crews can see the house through smoke'],
                    ['l-move', 'Move furniture to the center of rooms, away from windows'],
                    ['l-hoses', 'Connect hoses, but don’t leave sprinklers running — it drops water pressure for crews'],
                ],
            },
        ],
    },
    {
        id: 'redflag',
        tab: 'Red Flag days',
        intro: 'Nearly all California wildfires are human-caused. On hot, dry, windy days the smallest spark can become a major fire.',
        sections: [
            {
                title: 'Don’t start one',
                items: [
                    ['r-mow', 'No mowing, weed-whacking or grinding near dry grass'],
                    ['r-chains', 'Secure trailer safety chains — dragging chains throw sparks along the freeway'],
                    ['r-park', 'Don’t park or idle on dry grass; hot exhaust can ignite it'],
                    ['r-tires', 'Check tire pressure and brakes; driving on a rim sparks'],
                    ['r-burn', 'No outdoor burning, fireworks, campfires or charcoal grills'],
                    ['r-smoke', 'Put cigarettes out completely, never out a car window'],
                ],
            },
            {
                title: 'Be ready',
                items: [
                    ['r-report', 'If you see smoke or flames, call 911 right away — don’t assume someone else has'],
                    ['r-psps', 'Expect a possible power shutoff: charge phones, have flashlights and a cooler ready'],
                    ['r-bag', 'Put the go bag in the car and keep the tank half full'],
                    ['r-cushions', 'Bring patio cushions, doormats and brooms inside'],
                ],
            },
        ],
    },
];

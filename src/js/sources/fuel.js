// LANDFIRE 2025 Scott & Burgan 40 fire-behavior fuel models (FBFM40), 30 m.
// The number is the raster pixel value. Group is how we color it.
// Non-burnable pixels stay off the map (group "none") but still explain a click.

export const FUEL_MIN_ZOOM = 6;

export const FUEL_GROUPS = {
    dense: {
        label: 'Dense brush',
        color: '#d7301f',
        note: 'Heavy chaparral and tall shrub. This is the brush that burns hot and can throw embers ahead of the flames.',
    },
    brush: {
        label: 'Brush',
        color: '#ff9f1c',
        note: 'Shrub, or grass mixed with shrub. It carries fire, especially in wind, with less fuel built up than the densest chaparral.',
    },
    grass: {
        label: 'Grass',
        color: '#e6d35a',
        note: 'Grass, or grass with a little shrub. Dry grass spreads a fire fast in wind. There is not much woody fuel here.',
    },
    timber: {
        label: 'Trees and dead fuel',
        color: '#a67c52',
        note: 'Forest with litter, brush underneath, or slash. The fuel is on the ground and in the trees, not open chaparral.',
    },
    none: {
        label: 'No wildland fuel',
        color: null,
        note: 'Not wildland. A fire here would be a building, a field, or bare ground — not a brush fire.',
    },
};

// [code, group, short name]
const MODELS = {
    101: ['GR1', 'grass', 'Sparse dry grass'],
    102: ['GR2', 'grass', 'Low dry grass'],
    103: ['GR3', 'grass', 'Coarse grass'],
    104: ['GR4', 'grass', 'Moderate dry grass'],
    105: ['GR5', 'grass', 'Low humid grass'],
    106: ['GR6', 'grass', 'Moderate humid grass'],
    107: ['GR7', 'grass', 'Heavy dry grass'],
    108: ['GR8', 'grass', 'Heavy coarse grass'],
    109: ['GR9', 'grass', 'Very heavy grass'],
    121: ['GS1', 'grass', 'Grass with a little shrub'],
    122: ['GS2', 'brush', 'Grass and shrub'],
    123: ['GS3', 'brush', 'Grass and shrub'],
    124: ['GS4', 'brush', 'Heavy grass and shrub'],
    141: ['SH1', 'brush', 'Light dry shrub'],
    142: ['SH2', 'brush', 'Moderate dry shrub'],
    143: ['SH3', 'brush', 'Moderate shrub'],
    144: ['SH4', 'brush', 'Light shrub under trees'],
    145: ['SH5', 'dense', 'Dense dry brush'],
    146: ['SH6', 'brush', 'Light shrub'],
    147: ['SH7', 'dense', 'Very dense dry brush'],
    148: ['SH8', 'dense', 'Dense shrub'],
    149: ['SH9', 'dense', 'Very dense shrub'],
    161: ['TU1', 'timber', 'Trees with grass and shrub'],
    162: ['TU2', 'timber', 'Trees with shrub underneath'],
    163: ['TU3', 'timber', 'Trees with grass and shrub'],
    164: ['TU4', 'timber', 'Dwarf conifer'],
    165: ['TU5', 'timber', 'Trees with heavy shrub'],
    181: ['TL1', 'timber', 'Light conifer litter'],
    182: ['TL2', 'timber', 'Light leaf litter'],
    183: ['TL3', 'timber', 'Moderate conifer litter'],
    184: ['TL4', 'timber', 'Small downed logs'],
    185: ['TL5', 'timber', 'Heavy conifer litter'],
    186: ['TL6', 'timber', 'Moderate leaf litter'],
    187: ['TL7', 'timber', 'Large downed logs'],
    188: ['TL8', 'timber', 'Long-needle litter'],
    189: ['TL9', 'timber', 'Heavy leaf litter'],
    201: ['SB1', 'timber', 'Light slash'],
    202: ['SB2', 'timber', 'Moderate slash'],
    203: ['SB3', 'timber', 'Heavy slash'],
    204: ['SB4', 'timber', 'Heavy blowdown'],
    91: ['NB1', 'none', 'Urban'],
    92: ['NB2', 'none', 'Snow or ice'],
    93: ['NB3', 'none', 'Farmland'],
    98: ['NB8', 'none', 'Water'],
    99: ['NB9', 'none', 'Bare ground'],
};

export function fuelInfo(value) {
    const row = MODELS[Number(value)];
    if (!row) return null;
    const [code, group, name] = row;
    const meta = FUEL_GROUPS[group];
    return { value: Number(value), code, group, name, label: meta.label, color: meta.color, note: meta.note };
}

// Esri Colormap: only listed pixel values are drawn. Everything else, including cities and water, stays transparent.
export function fuelRenderingRule() {
    const colormap = [];
    for (const [value, [, group]] of Object.entries(MODELS)) {
        const hex = FUEL_GROUPS[group].color;
        if (!hex) continue;
        colormap.push([Number(value), parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]);
    }
    return { rasterFunction: 'Colormap', rasterFunctionArguments: { Colormap: colormap } };
}

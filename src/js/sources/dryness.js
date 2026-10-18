// Words for a 100-hour dead fuel moisture percent. Lower is drier.

export function drynessReading(percent) {
    const n = Number(percent);
    if (!Number.isFinite(n)) return null;
    if (n < 8) return { label: 'Very dry', note: 'Dead grass and small branches this dry catch and carry fire easily.' };
    if (n < 12) return { label: 'Dry', note: 'Dead grass and small branches are dry enough to carry fire, especially in wind.' };
    if (n < 18) return { label: 'Not fully cured', note: 'There is still some moisture in the dead grass and small branches.' };
    return { label: 'Moist', note: 'The dead grass and small branches are not especially dry.' };
}

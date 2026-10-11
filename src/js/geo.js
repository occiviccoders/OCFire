function inRing([x, y], ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

function inPolygon(point, rings) {
    return inRing(point, rings[0]) && !rings.slice(1).some((hole) => inRing(point, hole));
}

export function pointInGeometry(point, geometry) {
    if (!geometry) return false;
    if (geometry.type === 'Polygon') return inPolygon(point, geometry.coordinates);
    if (geometry.type === 'MultiPolygon') return geometry.coordinates.some((rings) => inPolygon(point, rings));
    return false;
}

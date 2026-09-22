import topology from "../rail-lines.json";

const graph = new Map<string, Map<string, number>>();
for (const line of topology.lines) {
    for (let i = 1; i < line.stations.length; i++) {
        const [a, ad] = line.stations[i - 1], [b, bd] = line.stations[i];
        const from = `tra:${a}`, to = `tra:${b}`;
        const distance = Math.abs(Number(bd) - Number(ad));
        if (!Number.isFinite(distance) || distance <= 0) continue;
        for (const [x, y] of [[from, to], [to, from]]) {
            if (!graph.has(x)) graph.set(x, new Map());
            graph.get(x)!.set(y, Math.min(graph.get(x)!.get(y) ?? Infinity, distance));
        }
    }
}
const routes = new Map<string, Map<string, string>>();
const paths = new Map<string, string[]>();
/** Expand skipped stops using the official rail network, rather than straight-line geography. */
export function passedRailStations(from: string, to: string): string[] {
    if (!graph.has(from) || !graph.has(to)) return [to];
    const key = `${from}>${to}`;
    if (paths.has(key)) return paths.get(key)!;
    if (!routes.has(from)) {
        const previous = new Map<string, string>();
        const distances = new Map<string, number>([[from, 0]]);
        const remaining = new Set(graph.keys());
        while (remaining.size) {
            let next: string | undefined;
            let minimum = Infinity;
            for (const node of remaining) {
                const distance = distances.get(node) ?? Infinity;
                if (distance < minimum) { next = node; minimum = distance; }
            }
            if (!next) break;
            remaining.delete(next);
            for (const [neighbor, length] of graph.get(next)!) {
                if (!remaining.has(neighbor) || minimum + length >= (distances.get(neighbor) ?? Infinity)) continue;
                distances.set(neighbor, minimum + length);
                previous.set(neighbor, next);
            }
        }
        routes.set(from, previous);
    }
    const previous = routes.get(from)!;
    const path = [to];
    let cursor = to;
    while (cursor !== from) {
        const parent = previous.get(cursor);
        if (!parent) return [to];
        cursor = parent;
        if (cursor !== from) path.unshift(cursor);
    }
    paths.set(key, path);
    return path;
}

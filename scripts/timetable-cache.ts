import { addDays } from "../src/domain/query";
import type { DayData, RailOperator, Train } from "../src/domain/types";
import { validDay } from "../src/data-loader";

const operators = ["tra", "thsr"] as const;
export interface TimetableSlice {
    trains: Train[];
    updatedAt: string;
    stale?: boolean;
}
export type TimetableSlices = Map<string, TimetableSlice>;

// Each file contains its own date and adjacent dates. Retain the source fetch time,
// including the extra day that exists only as the last file's next-day context.
export function restoreSlices(days: DayData[]): TimetableSlices {
    const slices: TimetableSlices = new Map();
    const priorities = new Map<string, number>();
    for (const day of days) {
        if (!day || !validDay(day, day.date)) continue;
        for (const operator of operators) {
            for (const offset of [-1, 0, 1]) {
                const covered = day.contextCoverage?.[operator]?.[offset + 1] ?? day.coverage[operator];
                if (!covered) continue;
                const date = addDays(day.date, offset);
                const key = `${operator}:${date}`;
                const metadata = day.sliceMetadata?.[key];
                const updatedAt = metadata?.updatedAt ?? day.operatorUpdatedAt?.[operator] ?? day.generatedAt;
                if (!Number.isFinite(Date.parse(updatedAt))) continue;
                const trains = day.trains.filter(train => train.operator === operator && train.id.startsWith(`${key}:`));
                if (!trains.length) continue;
                const priority = offset === 0 ? 1 : 0;
                const previous = slices.get(key);
                if (previous && (Date.parse(previous.updatedAt) > Date.parse(updatedAt)
                    || (previous.updatedAt === updatedAt && (priorities.get(key) ?? 0) > priority))) continue;
                slices.set(key, { trains, updatedAt, stale: metadata ? metadata.stale : day.staleOperators?.includes(operator) });
                priorities.set(key, priority);
            }
        }
    }
    return slices;
}

export async function fillSlices(options: {
    cached: TimetableSlices;
    dates: string[];
    updatedAt: string;
    force: boolean;
    refreshOperators: RailOperator[];
    fetchDay: (operator: RailOperator, date: string) => Promise<Train[]>;
    onFailure: (operator: RailOperator, date: string, error: unknown) => void;
}): Promise<TimetableSlices> {
    const slices: TimetableSlices = new Map();
    const retainedDates = [addDays(options.dates[0], -1), ...options.dates];
    for (const date of retainedDates) {
        for (const operator of operators) {
            const key = `${operator}:${date}`;
            const cached = options.cached.get(key);
            if (cached) slices.set(key, cached);
        }
    }
    for (const date of options.dates) {
        for (const operator of operators) {
            const key = `${operator}:${date}`;
            const cached = slices.get(key);
            if (cached && !cached.stale && !options.force && !options.refreshOperators.includes(operator)) continue;
            try {
                const trains = await options.fetchDay(operator, date);
                if (!trains.length) throw new Error("尚無完整班表");
                slices.set(key, { trains, updatedAt: options.updatedAt });
            } catch (error) {
                if (cached) slices.set(key, { ...cached, stale: true });
                options.onFailure(operator, date, error);
            }
        }
    }
    return slices;
}

export function assembleDay(date: string, slices: TimetableSlices, generatedAt: string, sources: string[]): DayData {
    const keys = [-1, 0, 1].flatMap(offset => operators.map(op => `${op}:${addDays(date, offset)}`));
    return {
        schemaVersion: 1, date, generatedAt, sources,
        coverage: { tra: slices.has(`tra:${date}`), thsr: slices.has(`thsr:${date}`) },
        trains: keys.flatMap(key => slices.get(key)?.trains ?? []),
        contextCoverage: Object.fromEntries(operators.map(op => [op, [-1, 0, 1].map(offset => slices.has(`${op}:${addDays(date, offset)}`))])) as Record<RailOperator, boolean[]>,
        operatorUpdatedAt: Object.fromEntries(operators.flatMap(op => {
            const slice = slices.get(`${op}:${date}`);
            return slice ? [[op, slice.updatedAt]] : [];
        })),
        staleOperators: operators.filter(op => [-1, 0, 1].some(offset => slices.get(`${op}:${addDays(date, offset)}`)?.stale)),
        sliceMetadata: Object.fromEntries(keys.flatMap(key => {
            const slice = slices.get(key);
            return slice ? [[key, { updatedAt: slice.updatedAt, ...(slice.stale ? { stale: true } : {}) }]] : [];
        })),
    };
}

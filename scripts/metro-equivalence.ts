import type { MetroVersion } from "../src/domain/metro";

const serviceDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "NationalHolidays"];
type Row = MetroVersion["timetables"][number];
type Departure = Row["Timetables"][number];

function stops(version: MetroVersion, row: Row, departure: Departure): string[] {
    const order = (id: string) => Number(id.slice(1).replace("a", ".5"));
    const stations = version.patterns.find(pattern => pattern.StoppingPatternID === departure.StoppingPatternID)!
        .Stations.map(station => station.StationID).sort((a, b) => order(a) - order(b));
    if (row.Direction === 1) stations.reverse();
    return stations.slice(stations.indexOf(row.StationID), stations.indexOf(departure.DestinationStationID ?? row.DestinationStaionID) + 1);
}

function tripKey(version: MetroVersion, row: Row, departure: Departure, day: string): string {
    const time = departure.DepartureTime.length === 8 && departure.DepartureTime.endsWith(":00")
        ? departure.DepartureTime.slice(0, 5) : departure.DepartureTime;
    return JSON.stringify([row.StationID, row.Direction, day, time, departure.TrainType, stops(version, row, departure)]);
}

function duration(version: MetroVersion, row: Row, departure: Departure, to: string): number | undefined {
    return version.travelTimes.find(item => item.TrainType === departure.TrainType)?.TravelTimes
        .find(item => item.FromStationID === row.StationID && item.ToStationID === to)?.RunTime;
}

/** Only carry a previously verified per-trip supplement across an unambiguous, unchanged trip.
 * Base travel times must also match: new upstream evidence must never be hidden by an old override.
 * Call only with validated, projected versions inside the previous version's validity period.
 */
export function compareMetroService(previous: MetroVersion, incoming: MetroVersion) {
    const candidate = structuredClone(incoming);
    const prior = new Map<string, { row: Row; departure: Departure }[]>();
    for (const row of previous.timetables) {
        for (const departure of row.Timetables) {
            for (const day of serviceDays.filter(day => row.ServiceDay[day])) {
                const key = tripKey(previous, row, departure, day);
                prior.set(key, [...(prior.get(key) ?? []), { row, departure }]);
            }
        }
    }
    let supplements = 0;
    for (const row of candidate.timetables) {
        for (const departure of row.Timetables) {
            const days = serviceDays.filter(day => row.ServiceDay[day]);
            const matches = days.map(day => prior.get(tripKey(candidate, row, departure, day)) ?? []);
            if (!matches.length || matches.some(items => items.length !== 1)) continue;
            const records = matches.map(items => items[0]);
            const supplement = records[0].departure.RunTimeByDestination;
            if (!supplement || records.some(item => JSON.stringify(item.departure.RunTimeByDestination) !== JSON.stringify(supplement))) continue;
            const destinations = Object.keys(supplement);
            if (records.some(item => destinations.some(to => duration(previous, item.row, item.departure, to) !== duration(candidate, row, departure, to)))) continue;
            // Never overwrite conflicting or additional per-trip information from the source.
            if (departure.RunTimeByDestination && (Object.keys(departure.RunTimeByDestination).length !== destinations.length
                || destinations.some(to => departure.RunTimeByDestination![to] !== supplement[to]))) continue;
            departure.RunTimeByDestination = structuredClone(supplement);
            if (!departure.ServiceName && records.every(item => item.departure.ServiceName === records[0].departure.ServiceName)) {
                departure.ServiceName = records[0].departure.ServiceName;
            }
            supplements++;
        }
    }
    // Expand operating rules, preserving duplicate multiplicity. No date-window sampling or
    // metroLegs deduplication: changing even one rule or duplicate must remain visible.
    const services = (version: MetroVersion) => {
        const entries: string[] = [];
        for (const row of version.timetables) {
            for (const departure of row.Timetables) {
                const destinations = stops(version, row, departure).slice(1).filter(to => row.StationID === "A18" || to === "A18");
                // The published snapshot only retains A18 connections; unrelated services may
                // appear/disappear when a pattern is renamed. They were validated in the full feed.
                if (!destinations.length) continue;
                const times = destinations.map(to => [to, departure.RunTimeByDestination?.[to] ?? duration(version, row, departure, to),
                    duration(version, row, departure, to)]);
                for (const day of serviceDays.filter(day => row.ServiceDay[day])) {
                    entries.push(JSON.stringify([tripKey(version, row, departure, day), times]));
                }
            }
        }
        return entries.sort();
    };
    const before = services(previous), after = services(candidate);
    const subtract = (left: string[], right: string[]) => {
        const counts = new Map<string, number>();
        for (const entry of right) counts.set(entry, (counts.get(entry) ?? 0) + 1);
        return left.filter(entry => {
            const count = counts.get(entry) ?? 0;
            if (!count) return true;
            counts.set(entry, count - 1);
            return false;
        }).map(entry => {
            const [key, travelTimes] = JSON.parse(entry);
            const [station, direction, serviceDay, departure, trainType, stops] = JSON.parse(key);
            return { station, direction, serviceDay, departure, trainType, stops, travelTimes };
        });
    };
    const removed = subtract(before, after), added = subtract(after, before);
    return { equivalent: !removed.length && !added.length, candidate, supplements, removed, added };
}

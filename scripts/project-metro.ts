import type { MetroSnapshot } from "../src/domain/metro";

/** The UI connects every airport metro destination through A18; names come from the station list. */
export function projectMetro(snapshot: MetroSnapshot): MetroSnapshot {
    const patterns = snapshot.patterns.filter(pattern => pattern.Stations.some(station => station.StationID === "A18"))
        .map(({ StoppingPatternID, Stations }) => ({ StoppingPatternID, Stations: Stations.map(({ StationID, Sequence }) => ({ StationID, Sequence })) }));
    const usable = new Set(patterns.map(pattern => pattern.StoppingPatternID));
    return {
        generatedAt: snapshot.generatedAt,
        timetables: snapshot.timetables.map(({ StationID, Direction, DestinationStaionID, ServiceDay, Timetables }) => ({
            StationID, Direction, DestinationStaionID, ServiceDay,
            Timetables: Timetables.filter(time => usable.has(time.StoppingPatternID)).map(({ DepartureTime, TrainType, StoppingPatternID }) => ({ DepartureTime, TrainType, StoppingPatternID })),
        })).filter(row => row.Timetables.length),
        patterns,
        travelTimes: snapshot.travelTimes.map(({ TrainType, TravelTimes }) => ({ TrainType,
            TravelTimes: TravelTimes.filter(time => time.FromStationID === "A18" || time.ToStationID === "A18")
                .map(({ FromStationID, ToStationID, RunTime }) => ({ FromStationID, ToStationID, RunTime })),
        })),
    };
}

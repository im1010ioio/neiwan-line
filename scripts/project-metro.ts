import type { MetroSnapshot, MetroVersion } from "../src/domain/metro";

/** The UI connects every airport metro destination through A18; names come from the station list. */
export function projectMetro(snapshot: MetroSnapshot): MetroSnapshot {
    return { ...projectVersion(snapshot), ...(snapshot.future?.length ? { future: snapshot.future.map(projectVersion) } : {}) };
}

function projectVersion(snapshot: MetroVersion): MetroVersion {
    const patterns = snapshot.patterns.filter(pattern => pattern.Stations.some(station => station.StationID === "A18"))
        .map(({ StoppingPatternID, Stations }) => ({ StoppingPatternID, Stations: Stations.map(({ StationID, Sequence }) => ({ StationID, Sequence })) }));
    const usable = new Set(patterns.map(pattern => pattern.StoppingPatternID));
    return {
        generatedAt: snapshot.generatedAt,
        updateFailedAt: snapshot.updateFailedAt,
        validity: snapshot.validity,
        effectiveFrom: snapshot.effectiveFrom,
        staleAfter: snapshot.staleAfter,
        timetables: snapshot.timetables.map(({ StationID, Direction, DestinationStaionID, ServiceDay, Timetables }) => ({
            StationID, Direction, DestinationStaionID, ServiceDay,
            // Keep contradictory A18 rows for validation instead of silently losing trains.
            Timetables: Timetables.filter(time => usable.has(time.StoppingPatternID) || StationID === "A18")
                .map(({ DepartureTime, TrainType, StoppingPatternID, DestinationStationID, RunTimeByDestination, ServiceName }) => ({
                    DepartureTime, TrainType, StoppingPatternID, DestinationStationID, RunTimeByDestination, ServiceName,
                })),
        })),
        patterns,
        travelTimes: snapshot.travelTimes.map(({ TrainType, TravelTimes }) => ({ TrainType,
            TravelTimes: TravelTimes.filter(time => time.FromStationID === "A18" || time.ToStationID === "A18")
                .map(({ FromStationID, ToStationID, RunTime }) => ({ FromStationID, ToStationID, RunTime })),
        })),
    };
}

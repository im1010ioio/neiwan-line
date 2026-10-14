import type { MetroSnapshot } from "../../src/domain/metro";

export const metroFixtureStations = [...Array.from({ length: 22 }, (_, index) => `A${index + 1}`).filter(station => station !== "A14"), "A14a"]
    .sort((a, b) => Number(a.slice(1).replace("a", ".5")) - Number(b.slice(1).replace("a", ".5")));
export const metroFixtureServices = { Monday: true, Tuesday: true, Wednesday: true, Thursday: true, Friday: true, Saturday: true, Sunday: true, NationalHolidays: true };

/** Explicit test-only local service, independent of the downloaded production timetable. */
export function createMetroFixture(): MetroSnapshot {
    return {
        generatedAt: "2026-10-14T00:00:00Z",
        validity: { from: "2026-10-13", through: "2026-11-11" },
        patterns: [{ StoppingPatternID: "local", Stations: metroFixtureStations.map((StationID, index) => ({ StationID, Sequence: index + 1 })) }],
        timetables: metroFixtureStations.flatMap(StationID => [0, 1].filter(Direction => !(StationID === "A1" && Direction === 1) && !(StationID === "A22" && Direction === 0))
            .map(Direction => ({ StationID, Direction, DestinationStaionID: Direction === 0 ? "A22" : "A1", ServiceDay: { ...metroFixtureServices },
                Timetables: ["06:00", "12:00", "22:00"].map(DepartureTime => ({ DepartureTime, TrainType: 1, StoppingPatternID: "local" })) }))),
        travelTimes: [{ TrainType: 1, TravelTimes: metroFixtureStations.filter(station => station !== "A18").flatMap(station => [
            { FromStationID: "A18", ToStationID: station, RunTime: 600 },
            { FromStationID: station, ToStationID: "A18", RunTime: 600 },
        ]) }],
    };
}

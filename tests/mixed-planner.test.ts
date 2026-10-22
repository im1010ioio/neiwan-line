import { expect, it } from "vitest";
import { planJourneys } from "../src/domain/planner";
import { mixedRouteAvailable } from "../src/domain/mixed-route";
import { loadFilters, saveFilters } from "../src/filters";
import type { Train } from "../src/domain/types";

const date = "2026-10-21";
const at = (time: string, day = date) => Date.parse(`${day}T${time}:00+08:00`);
const train = (id: string, operator: "tra" | "thsr", stops: [string, string][], reserved = false): Train => ({
    id, number: id, operator, reserved, service: operator,
    stops: stops.map(([station, time]) => ({ station, arrival: at(time), departure: at(time) })),
});
const outbound = [
    train("branch", "tra", [["tra:1208", "08:00"], ["tra:1193", "08:30"]]),
    train("liujia", "tra", [["tra:1193", "08:35"], ["tra:1194", "08:40"]]),
    train("hsr", "thsr", [["thsr:1030", "08:50"], ["thsr:1040", "09:20"]]),
    train("feeder", "tra", [["tra:3340", "09:30"], ["tra:3300", "09:45"]]),
];

it("混搭須主動開啟，預設對號篩選仍允許新烏日至台中的區間接駁", () => {
    expect(planJourneys(outbound, "tra:1208", "tra:3300", date)).toEqual([]);
    const journeys = planJourneys(outbound, "tra:1208", "tra:3300", date, { includeThsr: true, reservedOnly: true, directOnly: true });
    expect(journeys).toHaveLength(1);
    expect(journeys[0].legs.map(leg => leg.trip)).toEqual(["branch", "liujia", "hsr", "feeder"]);
    expect(journeys[0].arrival).toBe(at("09:45"));
});

it("回程由台中經新烏日、高鐵新竹與六家回內灣", () => {
    const trains = [
        train("feeder", "tra", [["tra:3300", "08:00"], ["tra:3340", "08:15"]]),
        train("hsr", "thsr", [["thsr:1040", "08:25"], ["thsr:1030", "08:55"]]),
        train("liujia", "tra", [["tra:1194", "09:05"], ["tra:1193", "09:10"]]),
        train("branch", "tra", [["tra:1193", "09:15"], ["tra:1208", "09:45"]]),
    ];
    expect(planJourneys(trains, "tra:3300", "tra:1208", date, { includeThsr: true, reservedOnly: true })[0].legs.map(leg => leg.trip))
        .toEqual(["feeder", "hsr", "liujia", "branch"]);
});

it("兩端高鐵轉乘各自遵守設定上下限，使用者可設定低於十分鐘", () => {
    const boundary = outbound.filter(item => item.id !== "liujia").map(item => item.id === "branch" ? train("branch", "tra", [["tra:1208", "08:00"], ["tra:1194", "08:40"]]) : item);
    for (const filters of [{ traMinMinutes: 11 }, { traMaxMinutes: 9 }]) {
        expect(planJourneys(boundary, "tra:1208", "tra:3300", date, { includeThsr: true, ...filters })).toEqual([]);
    }
    const tight = boundary.map(item => item.id !== "feeder" ? item : { ...item, stops: item.stops.map(stop => ({ ...stop, arrival: stop.arrival - 60000, departure: stop.departure - 60000 })) });
    expect(planJourneys(tight, "tra:1208", "tra:3300", date, { includeThsr: true, traMinMinutes: 1 })).toHaveLength(1);
    expect(planJourneys(boundary, "tra:1208", "tra:3300", date, { includeThsr: true, traMinMinutes: 10, traMaxMinutes: 10 })).toHaveLength(1);
    expect(planJourneys(tight, "tra:1208", "tra:3300", date, { includeThsr: true, traMinMinutes: 10 })).toEqual([]);
});

it("目的地就是轉乘台鐵站時仍計入末端步行", () => {
    const result = planJourneys(outbound, "tra:1208", "tra:3340", date, { includeThsr: true });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ arrival: at("09:25"), accessWalk: { origin: "thsr:1040", destination: "tra:3340", position: "end" } });
});

it("保留純台鐵選項，無高鐵班表時也可使用", () => {
    const pure = [train("direct", "tra", [["tra:1208", "08:00"], ["tra:1210", "09:00"]]), train("mainline", "tra", [["tra:1210", "09:10"], ["tra:3300", "11:00"]], true)];
    const result = planJourneys([...outbound, ...pure], "tra:1208", "tra:3300", date, { includeThsr: true });
    expect(result.some(journey => journey.legs.every(leg => leg.operator === "tra"))).toBe(true);
    expect(result.some(journey => journey.legs.some(leg => leg.operator === "thsr"))).toBe(true);
    expect(planJourneys(pure, "tra:1208", "tra:3300", date, { includeThsr: true })).toHaveLength(1);
});

it("只對台鐵與支線外的台鐵站開放混搭，偏好可保存", () => {
    expect(mixedRouteAvailable("tra:1208", "tra:3300")).toBe(true);
    for (const destination of ["tra:1210", "tra:1194", "thsr:1040", "tymc:A18"]) expect(mixedRouteAvailable("tra:1208", destination)).toBe(false);
    let saved = "";
    const storage = { removeItem: () => { saved = ""; }, getItem: () => saved, setItem: (_key: string, value: string) => { saved = value; } };
    expect(loadFilters(storage).includeThsr).toBe(false);
    saveFilters(storage, { ...loadFilters(), includeThsr: true });
    expect(loadFilters(storage).includeThsr).toBe(true);
});

it("跨午夜可接隔日台鐵，查詢日期仍以整組出發日判斷", () => {
    const next = "2026-10-22";
    const trains = [
        train("late-local", "tra", [["tra:1208", "22:00"], ["tra:1193", "22:30"]]),
        train("late-liujia", "tra", [["tra:1193", "22:35"], ["tra:1194", "22:40"]]),
        train("late-hsr", "thsr", [["thsr:1030", "22:50"], ["thsr:1040", "23:50"]]),
        { ...train("next-feeder", "tra", [["tra:3340", "00:00"], ["tra:3300", "00:15"]]), stops: [
            { station: "tra:3340", arrival: at("00:00", next), departure: at("00:00", next) },
            { station: "tra:3300", arrival: at("00:15", next), departure: at("00:15", next) },
        ] },
    ];
    expect(planJourneys(trains, "tra:1208", "tra:3300", date, { includeThsr: true })[0]).toMatchObject({ departure: at("22:00"), arrival: at("00:15", next) });
});

it("高鐵台南接沙崙、左營接新左營，區間接駁皆可查詢", () => {
    for (const [hsr, rail, destination] of [["thsr:1060", "tra:4272", "tra:4220"], ["thsr:1070", "tra:4340", "tra:4400"]]) {
        const trains = [
            ...outbound.slice(0, 2),
            train("hsr", "thsr", [["thsr:1030", "08:50"], [hsr, "10:00"]]),
            train("feeder", "tra", [[rail, "10:10"], [destination, "10:40"]]),
        ];
        expect(planJourneys(trains, "tra:1208", destination, date, { includeThsr: true, reservedOnly: true }).some(journey => journey.legs.some(leg => leg.origin === rail))).toBe(true);
    }
});

it("自行替換混搭車次可超出設定間隔，但仍須銜接前後列車", async () => {
    const { canConnectLeg } = await import("../src/domain/alternatives");
    const journey = planJourneys(outbound, "tra:1208", "tra:3300", date, { includeThsr: true })[0];
    expect(canConnectLeg(journey, 2, { ...journey.legs[2], arrival: at("09:21") })).toBe(true);
    expect(canConnectLeg(journey, 2, { ...journey.legs[2], departure: at("08:41") })).toBe(true);
    expect(canConnectLeg(journey, 2, { ...journey.legs[2], arrival: at("09:30") })).toBe(false);
    expect(canConnectLeg(journey, 2, { ...journey.legs[2], departure: at("08:39") })).toBe(false);
    expect(canConnectLeg(journey, 2, { ...journey.legs[2], arrival: at("09:20") })).toBe(true);
});

it("同一班東部台鐵在板橋、台北、南港的銜接僅保留轉乘餘裕最佳的一組", () => {
    const trains = [
        ...outbound.slice(0, 2),
        train("north-hsr", "thsr", [["thsr:1030", "08:50"], ["thsr:1010", "09:15"], ["thsr:1000", "09:25"], ["thsr:0990", "09:35"]]),
        train("east", "tra", [["tra:1020", "09:40"], ["tra:1000", "09:45"], ["tra:0980", "09:50"], ["tra:6000", "13:00"]], true),
    ];
    const journeys = planJourneys(trains, "tra:1208", "tra:6000", date, { includeThsr: true });
    const mixed = journeys.filter(journey => journey.legs.some(leg => leg.operator === "thsr"));
    expect(mixed).toHaveLength(1);
    // Banqiao gives 25 minutes, Taipei 20 and Nangang 15.
    expect(mixed[0].legs.find(leg => leg.operator === "thsr")!.destination).toBe("thsr:1010");
});

it("同班台鐵優選依序比較出發、換車、餘裕與高鐵區間，保留不同班台鐵", async () => {
    const { preferredMixedInterchanges } = await import("../src/domain/mixed-planner");
    const base = planJourneys(outbound, "tra:1208", "tra:3300", date, { includeThsr: true })[0];
    const later = { ...base, id: "later", departure: base.departure + 60000 };
    expect(preferredMixedInterchanges([base, later], 10).map(journey => journey.id)).toEqual(["later"]);
    const moreChanges = { ...base, id: "more", legs: [base.legs[0], ...base.legs] };
    expect(preferredMixedInterchanges([moreChanges, base], 10).map(journey => journey.id)).toEqual([base.id]);
    const roomier = { ...base, id: "roomier", legs: base.legs.map(leg => leg.operator === "thsr" ? { ...leg, departure: leg.departure + 300000, arrival: leg.arrival - 300000 } : leg) };
    expect(preferredMixedInterchanges([base, roomier], 10).map(journey => journey.id)).toEqual(["roomier"]);
    const otherTrain = { ...base, id: "different-train", legs: base.legs.map((leg, index) => index === base.legs.length - 1 ? { ...leg, trip: "different" } : leg) };
    expect(preferredMixedInterchanges([base, otherTrain], 10)).toHaveLength(2);
    const laterArrival = { ...base, id: "different-arrival", arrival: base.arrival + 60000 };
    expect(preferredMixedInterchanges([base, laterArrival], 10)).toHaveLength(2);
});

it.each([
    {
        name: "去程內灣端接駁：較快抵達卻超過高鐵等待上限",
        origin: "tra:1193", destination: "tra:3300", minimum: 5, maximum: 5,
        services: [
            train("valid", "tra", [["tra:1193", "08:00"], ["tra:1194", "08:40"]]),
            train("fast", "tra", [["tra:1193", "08:05"], ["tra:1194", "08:35"]]),
            train("hsr", "thsr", [["thsr:1030", "08:45"], ["thsr:1040", "09:20"]]),
            train("feeder", "tra", [["tra:3340", "09:25"], ["tra:3300", "09:45"]]),
        ],
    },
    {
        name: "去程遠端接駁：較晚發車超過高鐵等待上限",
        origin: "tra:1193", destination: "tra:3300", minimum: 10, maximum: 30,
        services: [
            train("local", "tra", [["tra:1193", "08:00"], ["tra:1194", "08:20"]]),
            train("hsr", "thsr", [["thsr:1030", "08:30"], ["thsr:1040", "09:00"]]),
            train("valid", "tra", [["tra:3340", "09:30"], ["tra:3300", "10:00"]]),
            train("fast", "tra", [["tra:3340", "09:40"], ["tra:3300", "09:50"]]),
        ],
    },
    {
        name: "回程遠端接駁：較快抵達卻超過高鐵等待上限",
        origin: "tra:1000", destination: "tra:1193", minimum: 5, maximum: 10,
        services: [
            train("valid", "tra", [["tra:1000", "08:00"], ["tra:1020", "08:25"]]),
            train("fast", "tra", [["tra:1000", "08:05"], ["tra:1020", "08:20"]]),
            train("hsr", "thsr", [["thsr:1010", "08:35"], ["thsr:1030", "09:00"]]),
            train("local", "tra", [["tra:1194", "09:10"], ["tra:1193", "09:15"]]),
        ],
    },
    {
        name: "回程內灣端接駁：較晚發車超過高鐵等待上限",
        origin: "tra:3300", destination: "tra:1193", minimum: 10, maximum: 10,
        services: [
            train("feeder", "tra", [["tra:3300", "08:00"], ["tra:3340", "08:20"]]),
            train("hsr", "thsr", [["thsr:1040", "08:30"], ["thsr:1030", "09:00"]]),
            train("valid", "tra", [["tra:1194", "09:10"], ["tra:1193", "09:40"]]),
            train("fast", "tra", [["tra:1194", "09:20"], ["tra:1193", "09:35"]]),
        ],
    },
])("保留完整銜接候選：$name", ({ origin, destination, minimum, maximum, services }) => {
    const filters = { includeThsr: true, traMinMinutes: minimum, traMaxMinutes: maximum };
    const withoutFast = planJourneys(services.filter(service => service.id !== "fast"), origin, destination, date, filters);
    const withFast = planJourneys(services, origin, destination, date, filters);
    expect(withoutFast).toHaveLength(1);
    expect(withFast.map(journey => journey.id)).toEqual(withoutFast.map(journey => journey.id));
    expect(withFast[0].legs.some(leg => leg.trip === "valid")).toBe(true);
    // Once the faster service fits the window, it must remain available as a complete journey.
    const relaxed = planJourneys(services, origin, destination, date, { ...filters, traMaxMinutes: maximum + 20 });
    expect(relaxed.some(journey => journey.legs.some(leg => leg.trip === "fast"))).toBe(true);
    for (let index = 1; index < withFast[0].legs.length; index++) {
        const before = withFast[0].legs[index - 1], after = withFast[0].legs[index];
        const wait = (after.departure - before.arrival) / 60000;
        expect(wait).toBeGreaterThanOrEqual(minimum);
        expect(wait).toBeLessThanOrEqual(maximum);
    }
});

it("分組優選與完整兩兩比較一致，保留等價與不同首班列車的組合", async () => {
    const { usefulMixedJourneys } = await import("../src/domain/mixed-planner");
    const base = planJourneys(outbound, "tra:1208", "tra:3300", date, { includeThsr: true })[0];
    let seed = 17;
    const next = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed; };
    const journeys = Array.from({ length: 500 }, (_, index) => {
        const departure = at("08:00") + next() % 10 * 60000;
        const arrival = at("10:00") + next() % 10 * 60000;
        const count = next() % 5 + 1;
        const first = { ...base.legs[0], trip: `first-${next() % 4}` };
        return { ...base, id: `candidate-${index}`, departure, arrival,
            legs: [first, ...Array.from({ length: count - 1 }, () => base.legs[1])] };
    });
    const equivalent = { ...journeys[0], id: "equivalent" };
    journeys.push(equivalent);
    const expected = journeys.filter(journey => !journeys.some(other => other !== journey
        && other.legs[0].trip === journey.legs[0].trip
        && other.departure >= journey.departure && other.arrival <= journey.arrival && other.legs.length <= journey.legs.length
        && (other.departure > journey.departure || other.arrival < journey.arrival || other.legs.length < journey.legs.length)));
    expect(usefulMixedJourneys(journeys)).toEqual(expected);
    expect(usefulMixedJourneys([base, { ...base, id: "tie" }])).toHaveLength(2);
});

it.each([false, true])("高鐵台北接基隆遵守幹線對號篩選，僅保留八堵端必要區間接駁（回程：%s）", reversed => {
    const outward = [
        ...outbound.slice(0, 2),
        train("hsr-north", "thsr", [["thsr:1030", "08:50"], ["thsr:1000", "09:20"]]),
        train("long-local", "tra", [["tra:1000", "09:30"], ["tra:0900", "10:15"]]),
        train("reserved", "tra", [["tra:1000", "09:35"], ["tra:0920", "10:00"]], true),
        train("last-local", "tra", [["tra:0920", "10:10"], ["tra:0900", "10:20"]]),
    ];
    const trains = reversed ? outward.map(service => ({ ...service, stops: [...service.stops].reverse().map(stop => ({
        ...stop, arrival: at("23:00") - (stop.departure - at("00:00")), departure: at("23:00") - (stop.arrival - at("00:00")),
    })) })) : outward;
    const origin = reversed ? "tra:0900" : "tra:1208", destination = reversed ? "tra:1208" : "tra:0900";
    const filtered = planJourneys(trains, origin, destination, date, { includeThsr: true, reservedOnly: true });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].legs.some(leg => leg.trip === "long-local")).toBe(false);
    expect(filtered[0].legs.some(leg => leg.trip === "reserved")).toBe(true);
    expect(filtered[0].legs.some(leg => leg.trip === "last-local")).toBe(true);
    const unrestricted = planJourneys(trains, origin, destination, date, { includeThsr: true, reservedOnly: false });
    expect(unrestricted.some(journey => journey.legs.some(leg => leg.trip === "long-local"))).toBe(true);
});

it.each([false, true])("保留新烏日至台中區間接駁並排除左營大幅折返（回程：%s）", reversed => {
    const services = [
        ...outbound.slice(0, 2),
        train("hsr", "thsr", [["thsr:1030", "08:50"], ["thsr:1040", "09:20"], ["thsr:1070", "10:20"]]),
        train("local-access", "tra", [["tra:3340", "09:30"], ["tra:3300", "09:45"]]),
        train("occasional-reserved", "tra", [["tra:3340", "07:00"], ["tra:3300", "07:15"]], true),
        train("long-return", "tra", [["tra:4340", "10:30"], ["tra:3300", "13:00"]], true),
    ];
    const trains = reversed ? services.map(service => ({ ...service, stops: [...service.stops].reverse().map(stop => ({
        ...stop, arrival: at("23:00") - (stop.departure - at("00:00")), departure: at("23:00") - (stop.arrival - at("00:00")),
    })) })) : services;
    const journeys = planJourneys(trains, reversed ? "tra:3300" : "tra:1208", reversed ? "tra:1208" : "tra:3300", date, { includeThsr: true, reservedOnly: true });
    expect(journeys).toHaveLength(1);
    expect(journeys[0].legs.some(leg => leg.trip === "local-access")).toBe(true);
    expect(journeys[0].legs.some(leg => leg.trip === "long-return")).toBe(false);
    const highSpeed = journeys[0].legs.find(leg => leg.operator === "thsr")!;
    expect(reversed ? highSpeed.origin : highSpeed.destination).toBe("thsr:1040");
});

it.each([false, true].flatMap(reversed => [false, true].map(reservedOnly => ({ reversed, reservedOnly }))))(
    "台南使用高鐵台南接沙崙，排除台中下車接長途台鐵（回程：$reversed，對號：$reservedOnly）",
    ({ reversed, reservedOnly }) => {
        const services = [
            ...outbound.slice(0, 2),
            train("hsr-south", "thsr", [["thsr:1030", "08:50"], ["thsr:1040", "09:20"], ["thsr:1060", "10:20"]]),
            train("early-local", "tra", [["tra:3340", "09:30"], ["tra:3360", "09:40"]]),
            train("long-mainline", "tra", [["tra:3360", "09:50"], ["tra:4220", "11:30"]], true),
            train("tainan-access", "tra", [["tra:4272", "10:30"], ["tra:4220", "10:55"]]),
            train("pure-mainline", "tra", [["tra:1193", "08:45"], ["tra:4220", "12:00"]], true),
        ];
        const trains = reversed ? services.map(service => ({ ...service, stops: [...service.stops].reverse().map(stop => ({
            ...stop, arrival: at("23:00") - (stop.departure - at("00:00")), departure: at("23:00") - (stop.arrival - at("00:00")),
        })) })) : services;
        const journeys = planJourneys(trains, reversed ? "tra:4220" : "tra:1208", reversed ? "tra:1208" : "tra:4220", date,
            { includeThsr: true, reservedOnly });
        const mixed = journeys.filter(journey => journey.legs.some(leg => leg.operator === "thsr"));
        expect(mixed).toHaveLength(1);
        expect(mixed[0].legs.map(leg => leg.trip)).toContain("tainan-access");
        expect(mixed[0].legs.map(leg => leg.trip)).not.toContain("long-mainline");
        const pure = planJourneys(trains, reversed ? "tra:4220" : "tra:1208", reversed ? "tra:1208" : "tra:4220", date,
            { includeThsr: false, reservedOnly });
        expect(pure.length).toBeGreaterThan(0);
        expect(journeys.filter(journey => journey.legs.every(leg => leg.operator === "tra"))).toEqual(pure);
    },
);

it.each([false, true])("往返中壢不經板橋高鐵折返，保留直接台鐵（回程：%s）", reversed => {
    const services = [
        ...outbound.slice(0, 2),
        train("hsr-banqiao", "thsr", [["thsr:1030", "08:50"], ["thsr:1010", "09:20"]]),
        train("backtrack", "tra", [["tra:1020", "09:35"], ["tra:1100", "10:00"]], true),
        train("shuttle", "tra", [["tra:1193", "08:35"], ["tra:1210", "08:50"]]),
        train("direct", "tra", [["tra:1210", "09:00"], ["tra:1100", "09:30"]], true),
    ];
    const trains = reversed ? services.map(service => ({ ...service, stops: [...service.stops].reverse().map(stop => ({
        ...stop, arrival: at("23:00") - (stop.departure - at("00:00")), departure: at("23:00") - (stop.arrival - at("00:00")),
    })) })) : services;
    const journeys = planJourneys(trains, reversed ? "tra:1100" : "tra:1208", reversed ? "tra:1208" : "tra:1100", date, { includeThsr: true, reservedOnly: true });
    expect(journeys.length).toBeGreaterThan(0);
    expect(journeys.every(journey => journey.legs.every(leg => leg.operator === "tra"))).toBe(true);
    expect(journeys.some(journey => journey.legs.some(leg => leg.trip === "direct"))).toBe(true);
});

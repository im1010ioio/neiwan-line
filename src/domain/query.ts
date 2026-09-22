export function dateInTaipei(now: Date = new Date()): string {
    return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei" }).format(now);
}

export function addDays(date: string, count: number): string {
    return dateInTaipei(new Date(Date.parse(`${date}T00:00:00+08:00`) + count * 86400000));
}

export function dateOptions(now: Date): [string, string][] {
    return Array.from({ length: 7 }, (_, i) => {
        const date = addDays(dateInTaipei(now), i);
        return [date, `${date.replaceAll("-", "/")} (${"日一二三四五六"[new Date(`${date}T12:00:00+08:00`).getUTCDay()]})`];
    });
}

export interface QueryTime {
    date: string;
    time: string;
    showPast: boolean;
}

export function filterJourneys<T extends { departure: number }>(journeys: T[], query: QueryTime, now: Date): T[] {
    const today = dateInTaipei(now);
    const time = query.time === "now" || query.time === "all" ? "00:00" : query.time;
    let lower = Date.parse(`${query.date}T${time}:00+08:00`);
    if (query.date === today && !query.showPast) lower = Math.max(lower, now.getTime());
    const upper = Date.parse(`${addDays(query.date, 1)}T00:00:00+08:00`);
    return journeys.filter(journey => journey.departure >= lower && journey.departure < upper);
}

export function journeyState(journey: { departure: number }, date: string, preparation: number, now: Date): "scheduled" | "past" | "warning" | "upcoming" {
    if (date > dateInTaipei(now)) return "scheduled";
    if (journey.departure < now.getTime()) return "past";
    return journey.departure - now.getTime() < preparation * 60000 ? "warning" : "upcoming";
}

export function displayTime(timestamp: number, date: string): string {
    const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit" }).format(timestamp);
    return `${dateInTaipei(new Date(timestamp)) > date ? "翌日 " : ""}${time}`;
}

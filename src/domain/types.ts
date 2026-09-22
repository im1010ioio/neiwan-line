export type Operator = "tra" | "thsr";
export interface Station {
    id: string;
    name: string;
    operator: Operator;
    county: string;
    neiwanOrder?: number;
}
export interface Stop {
    station: string;
    arrival: number;
    departure: number;
}
export interface Train {
    reserved?: boolean;
    id: string;
    number: string;
    operator: Operator;
    service: string;
    stops: Stop[];
}
export interface Leg {
    reserved?: boolean;
    trip: string;
    number: string;
    operator: Operator;
    service: string;
    origin: string;
    destination: string;
    departure: number;
    arrival: number;
}
export interface Journey {
    accessWalk?: { origin: string; destination: string; departure: number; arrival: number; position: "start" | "end" };
    id: string;
    departure: number;
    arrival: number;
    legs: Leg[];
}
export interface DayData {
    contextCoverage?: Record<Operator, boolean[]>;
    staleOperators?: Operator[];
    operatorUpdatedAt?: Partial<Record<Operator, string>>;
    schemaVersion: 1;
    date: string;
    generatedAt: string;
    coverage: Record<Operator, boolean>;
    sources: string[];
    trains: Train[];
}
export interface Manifest {
    generatedAt: string;
    days: { date: string; file: string; coverage: Record<Operator, boolean>; generatedAt: string }[];
}

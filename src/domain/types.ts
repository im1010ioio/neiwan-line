export type RailOperator = "tra" | "thsr";
export type Operator = RailOperator | "tymc";
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
    trainType?: string;
    trainTypeId?: string;
    reserved?: boolean;
    id: string;
    number: string;
    operator: Operator;
    service: string;
    stops: Stop[];
}
export interface Leg {
    trainType?: string;
    estimatedArrival?: boolean;
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
    sliceMetadata?: Record<string, { updatedAt: string; stale?: boolean }>;
    contextCoverage?: Record<RailOperator, boolean[]>;
    staleOperators?: RailOperator[];
    operatorUpdatedAt?: Partial<Record<RailOperator, string>>;
    schemaVersion: 1;
    date: string;
    generatedAt: string;
    coverage: Record<RailOperator, boolean>;
    sources: string[];
    trains: Train[];
}
export interface Manifest {
    generatedAt: string;
    days: { date: string; file: string; coverage: Record<RailOperator, boolean>; generatedAt: string }[];
}

// Injected effects (conventions): domain code never reads the time or makes ids by itself.
export type Clock = { now(): Date };
export type IdGen = { uuid(): string };

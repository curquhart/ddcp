export class UnresolvedDependencyError extends Error {
    constructor(public readonly value: unknown) {
        super(`Unresolved dependency in ${JSON.stringify(value)}`);
    }
}

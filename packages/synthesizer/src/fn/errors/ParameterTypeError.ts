export class ParameterTypeError extends Error {
    constructor(parameterIndex: number, private parameterHint: string) {
        super(`Malformed parameter #${parameterIndex}: ${parameterHint}`);
    }
}

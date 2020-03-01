export class ParameterCountError extends Error {
    constructor(private intrinsicName: string, private parameterCountHint: string) {
        super(`Incorrect number of parameters for ${intrinsicName}: Expected ${parameterCountHint} parameters.`);
    }
}

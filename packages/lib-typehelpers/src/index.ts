export const tOrDefault = <T>(input: T | undefined, defaultValue: T): T => {
    return input !== undefined ? input : defaultValue;
};

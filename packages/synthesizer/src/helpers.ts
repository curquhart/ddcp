// eslint-disable-next-line @typescript-eslint/no-empty-function
export const EMPTY_VOID_FN = (): void => {};

export const throwError = (err: Error): never => {
    throw err;
};

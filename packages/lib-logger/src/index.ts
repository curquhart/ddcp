import * as debug from 'debug';

debug.enable('*');

export const errorLogger = debug.debug('Error');
export const warnLogger = debug.debug('Warn');
export const infoLogger = debug.debug('Info');

// eslint-disable-next-line no-console
infoLogger.log = console.log.bind(console);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const error = (requestId: string, formatter: any, ...args: any[]): void => errorLogger.extend(requestId)(formatter, ...args);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const warn = (requestId: string, formatter: any, ...args: any[]): void => warnLogger.extend(requestId)(formatter, ...args);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const info = (requestId: string, formatter: any, ...args: any[]): void => infoLogger.extend(requestId)(formatter, ...args);

import {debug} from 'debug';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const error = (requestId: string, formatter: any, ...args: any[]): void => debug('Error').extend(requestId)(formatter, ...args);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const warn = (requestId: string, formatter: any, ...args: any[]): void => debug('Warn').extend(requestId)(formatter, ...args);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const info = (requestId: string, formatter: any, ...args: any[]): void => debug('Info').extend(requestId)(formatter, ...args);
// eslint-disable-next-line no-console
info.log = console.log.bind(console);


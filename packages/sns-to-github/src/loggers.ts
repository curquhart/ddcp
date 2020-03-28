import {debug} from 'debug';

export const info = (requestId: string): debug.Debugger => debug('Info').extend(requestId);
// eslint-disable-next-line no-console
info.log = console.log.bind(console);


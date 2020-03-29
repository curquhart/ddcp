import {Handler} from './Handler';

export const handler = (): Promise<void> => new Handler().handle();

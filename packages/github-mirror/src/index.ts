import {Mirror} from './Mirror';

export const handle = (event: unknown): Promise<void> => new Mirror().handle(event);

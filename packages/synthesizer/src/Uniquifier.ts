export class Uniquifier {
    private counters: Record<string, number> = {};

    next(logicalId: string): string {
        if (this.counters[logicalId] === undefined) {
            this.counters[logicalId] = 0;
            return `${logicalId}DD`;
        }

        return `${logicalId}DD${++this.counters[logicalId]}`;
    }
}
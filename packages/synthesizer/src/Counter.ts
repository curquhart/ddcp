export class Counter {
    private _counter = 0;

    get next(): number {
        return this._counter++;
    }
}
export interface LambdaInvokeCloudWatchEvent {
    sourceVersion: string;
    branchName: string;
    parameters: Record<string, unknown>;
}

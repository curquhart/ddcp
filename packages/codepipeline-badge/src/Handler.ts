import {CodePipelineEvent} from './CodePipelineEvent';
import {Context} from 'aws-lambda';
import {info} from '@ddcp/logger';
import {CodePipeline, S3} from 'aws-sdk';
import * as fs from 'fs';

enum StatusBadge {
    ApprovalPending = 'approval-pending',
    Failure = 'failure',
    InProgress = 'in-progress',
    Success = 'success',
    Synthesizing = 'synthesizing',
    Synthesized = 'synthesized',
    Deploying = 'deploying',
    Unknown = 'unknown',
}

const Assets: Record<StatusBadge, string> = {
    [StatusBadge.ApprovalPending]: fs.readFileSync(`${__dirname}/../assets/${StatusBadge.ApprovalPending}.svg`, {encoding: 'utf8'}),
    [StatusBadge.Failure]: fs.readFileSync(`${__dirname}/../assets/${StatusBadge.Failure}.svg`, {encoding: 'utf8'}),
    [StatusBadge.InProgress]: fs.readFileSync(`${__dirname}/../assets/${StatusBadge.InProgress}.svg`, {encoding: 'utf8'}),
    [StatusBadge.Success]: fs.readFileSync(`${__dirname}/../assets/${StatusBadge.Success}.svg`, {encoding: 'utf8'}),
    [StatusBadge.Synthesizing]: fs.readFileSync(`${__dirname}/../assets/${StatusBadge.Synthesizing}.svg`, {encoding: 'utf8'}),
    [StatusBadge.Synthesized]: fs.readFileSync(`${__dirname}/../assets/${StatusBadge.Synthesized}.svg`, {encoding: 'utf8'}),
    [StatusBadge.Unknown]: fs.readFileSync(`${__dirname}/../assets/${StatusBadge.Unknown}.svg`, {encoding: 'utf8'}),
    [StatusBadge.Deploying]: fs.readFileSync(`${__dirname}/../assets/${StatusBadge.Deploying}.svg`, {encoding: 'utf8'}),
};

export class Handler {
    async handle(event: CodePipelineEvent, context: Context): Promise<void> {
        const cpClient = new CodePipeline({
            region: event.region,
        });
        const s3Client = new S3({
            region: event.region,
        });

        const [pipelineState, synthPipelineState] = await Promise.all([
            cpClient.getPipelineState({
                name: event.pipelineName,
            }).promise().then((res) => this.getStatus(cpClient, event.pipelineName, res.stageStates)),
            cpClient.getPipelineState({
                name: event.synthesisPipelineName,
            }).promise().then((res) => this.getStatus(cpClient, event.synthesisPipelineName, res.stageStates)),
        ]);

        info(context.awsRequestId, `Synth pipeline state: ${synthPipelineState}`);
        info(context.awsRequestId, `Pipeline state: ${pipelineState}`);

        let aggregatePipelineState = pipelineState;
        if (synthPipelineState === StatusBadge.InProgress) {
            aggregatePipelineState = StatusBadge.Synthesizing;
        }
        else if (synthPipelineState !== StatusBadge.Success) {
            aggregatePipelineState = synthPipelineState;
        }
        else if (event.eventPipelineName === event.synthesisPipelineName) {
            aggregatePipelineState = StatusBadge.Synthesized;
        }

        const asset = Assets[aggregatePipelineState];

        await s3Client.putObject({
            Bucket: event.assetsBucket,
            Key: event.assetsKey,
            Body: asset,
            CacheControl: 'no-cache',
            ContentType: 'image/svg+xml',
            ACL: 'public-read',
        }).promise();
    }

    private async getStatus(cpClient: CodePipeline, pipelineName: string, stages: CodePipeline.StageStateList | undefined): Promise<StatusBadge> {
        let latestExecutionId = '';

        for (const stage of stages ?? []) {
            if (stage.latestExecution?.pipelineExecutionId !== undefined) {
                latestExecutionId = stage.latestExecution?.pipelineExecutionId;
            }
            if (stage.latestExecution?.status === 'InProgress') {
                const pipeline = await cpClient.getPipeline({
                    name: pipelineName,
                }).promise();

                const approvalActions = pipeline.pipeline?.stages?.find((stageDetails: CodePipeline.Types.StageDeclaration) => stageDetails.name === stage.stageName)
                    ?.actions.filter((actionDetails: CodePipeline.Types.ActionDeclaration) => actionDetails.actionTypeId.category === 'Approval')
                    .map((actionDetails: CodePipeline.Types.ActionDeclaration) => actionDetails.name) ?? [];
                const deployActions = pipeline.pipeline?.stages?.find((stageDetails: CodePipeline.Types.StageDeclaration) => stageDetails.name === stage.stageName)
                    ?.actions.filter((actionDetails: CodePipeline.Types.ActionDeclaration) => actionDetails.actionTypeId.category === 'Deploy')
                    .map((actionDetails: CodePipeline.Types.ActionDeclaration) => actionDetails.name) ?? [];

                for (const actionState of stage.actionStates ?? []) {
                    if (actionState.latestExecution?.status === 'InProgress' && actionState.actionName !== undefined) {
                        if (approvalActions.indexOf(actionState.actionName) !== -1) {
                            return StatusBadge.ApprovalPending;
                        }
                        else if (deployActions.indexOf(actionState.actionName) !== -1) {
                            return StatusBadge.Deploying;
                        }
                    }
                }

                return StatusBadge.InProgress;
            }
        }

        for (const stage of stages ?? []) {
            if (stage.latestExecution?.status !== undefined && ['Failed', 'Stopped', 'Stopping'].indexOf(stage.latestExecution?.status) !== -1) {
                return StatusBadge.Failure;
            }
        }

        if (latestExecutionId === '') {
            return StatusBadge.Unknown;
        }

        return StatusBadge.Success;
    }
}

import {
    BaseOrchestratorFactory,
    BranchOptions,
    CodeBuildActionProps, LambdaInvokeActionProps,
    Orchestrator,
    OrchestratorProps,
    Stage
} from './BaseOrchestratorFactory';
import {IPipeline} from '@aws-cdk/aws-codepipeline';
import {tOrDefault} from '@ddcp/typehelpers';
import {Uniquifier} from '../Uniquifier';
import {ManagerResources} from '@ddcp/models';
import {IRepository, Repository} from '@aws-cdk/aws-codecommit';
import * as targets from '@aws-cdk/aws-events-targets';
import {throwError} from '@ddcp/errorhandling';
import {EventField, RuleTargetInput} from '@aws-cdk/aws-events';
import {getFunction} from '../helpers';
import {LambdaModuleName} from '@ddcp/module-collection';
import {PolicyStatement} from '@aws-cdk/aws-iam';
import {CodeBuildCloudWatchEvent, LambdaInvokeCloudWatchEvent} from '@ddcp/models';

export const NAME = 'CloudWatch';

interface CloudWatchOrchestratorStageProps {
    readonly pipeline: CloudWatchOrchestrator;
    readonly repositories: Record<string, RepositoryProps>;
    readonly uniquifier: Uniquifier;
    readonly managerPipeline: IPipeline;
    readonly managerResources: ManagerResources;
    readonly stageName: string;
}

interface RepositoryProps {
    repository: IRepository;
    repositoryBranch: BranchOptions;
}

class CloudWatchOrchestratorStage implements Stage {
    constructor(private readonly props: CloudWatchOrchestratorStageProps) {
    }

    addCodeCommitSourceAction(actionName: string, repositoryName: string, repositoryBranch: BranchOptions): void {
        this.props.repositories[ actionName ] = {
            repository: Repository.fromRepositoryName(this.props.pipeline.props.scope, this.props.uniquifier.next('Repo'), repositoryName),
            repositoryBranch,
        };
    }

    addCodeBuildAction(props: CodeBuildActionProps): void {
        const sourceName = props.action.SourceName ?? throwError(new Error('SourceName is required.'));
        const sourceRepo = this.props.repositories[ sourceName ];

        if (sourceRepo === undefined) {
            throw new Error(`Lookup of repository for ${sourceName} failed.`);
        }

        const targetProps = {
            event: RuleTargetInput.fromObject({
                projectName: props.project.projectName,
                sourceVersion: EventField.fromPath('$.detail.commitId'),
                branchPattern: sourceRepo.repositoryBranch.BranchPattern,
                branchName: EventField.fromPath('$.detail.referenceName'),
                environmentVariablesOverride: [
                    {
                        // For whatever raisin, this does not seem to be available in codebuild events, so put
                        // it in an environment var to allow us to extract it.
                        name: 'SOURCE_VERSION',
                        value: EventField.fromPath('$.detail.commitId'),
                        type: 'PLAINTEXT',
                    },
                    {
                        name: 'SOURCE_BRANCH_NAME',
                        value: EventField.fromPath('$.detail.referenceName'),
                        type: 'PLAINTEXT',
                    },
                ],
            } as CodeBuildCloudWatchEvent)
        };
        const targetEventPattern = {
            detail: {
                referenceType: [ 'branch' ],
            }
        };

        if (sourceRepo.repositoryBranch.BranchPattern === undefined) {
            sourceRepo.repository.onCommit(this.props.uniquifier.next('OnCommit'), {
                target: new targets.CodeBuildProject(props.project, targetProps),
                eventPattern: targetEventPattern,
                branches: sourceRepo.repositoryBranch.BranchName !== undefined ? [sourceRepo.repositoryBranch.BranchName] : undefined
            });
        }
        else {
            const handler = getFunction({
                scope: this.props.pipeline.props.scope,
                functionCache: this.props.pipeline.props.functionCache,
                managerResources: this.props.pipeline.props.managerResources,
                moduleName: LambdaModuleName.BranchFilter,
            });
            handler.addToRolePolicy(new PolicyStatement({
                actions: [
                    'codebuild:StartBuild'
                ],
                resources: [
                    props.project.projectArn,
                ]
            }));
            sourceRepo.repository.onCommit(this.props.uniquifier.next('OnCommit'), {
                target: new targets.LambdaFunction(handler, targetProps),
                eventPattern: targetEventPattern,
            });
        }
    }

    addS3PublishAction(): void {
        throw new Error('S3 Publish is not supported on CloudWatch orchestrated pipelines.');
    }

    addCounterAction(): void {
        throw new Error('Counter is not supported on CloudWatch orchestrated pipelines.');
    }

    addLambdaInvokeAction(props: LambdaInvokeActionProps): void {
        const sourceName = props.action.SourceName ?? throwError(new Error('SourceName is required.'));
        const sourceRepo = this.props.repositories[ sourceName ];

        if (sourceRepo === undefined) {
            throw new Error(`Lookup of repository for ${sourceName} failed.`);
        }

        const targetProps = {
            event: RuleTargetInput.fromObject({
                sourceVersion: EventField.fromPath('$.detail.commitId'),
                branchName: EventField.fromPath('$.detail.referenceName'),
                parameters: props.action.Parameters,
            } as LambdaInvokeCloudWatchEvent)
        };
        const targetEventPattern = {
            detail: {
                referenceType: [ 'branch' ],
            }
        };

        if (sourceRepo.repositoryBranch.BranchPattern === undefined) {
            sourceRepo.repository.onCommit(this.props.uniquifier.next('OnCommit'), {
                target: new targets.LambdaFunction(props.lambda, targetProps),
                eventPattern: targetEventPattern,
                branches: sourceRepo.repositoryBranch.BranchName !== undefined ? [sourceRepo.repositoryBranch.BranchName] : undefined
            });
        }
        else {
            // may support this later but I don't have a use for it right now.
            throw new Error('BranchPattern is unsupported for LambdaInvoke actions on CloudWatch orchestrated pipelines.');
        }
    }
}

class CloudWatchOrchestrator implements Orchestrator {
    private readonly repositories: Record<string, RepositoryProps> = {};

    constructor(readonly props: OrchestratorProps) {
    }

    addSources(): void {
        const sourceStage = this.addStage('Source');
        for (const source of tOrDefault(this.props.pipeline.Sources, [])) {
            if (source.Name === undefined) {
                throw new Error('Name is required.');
            }
            if (source.RepositoryName === undefined) {
                throw new Error('RepositoryName is required.');
            }

            sourceStage.addCodeCommitSourceAction(source.Name, source.RepositoryName, {
                BranchName: source.BranchName,
                BranchPattern: source.BranchPattern
            });
        }
    }

    addStage(stageName: string): Stage {
        return new CloudWatchOrchestratorStage({
            pipeline: this,
            uniquifier: this.props.uniquifier,
            managerPipeline: this.props.managerPipeline,
            managerResources: this.props.managerResources,
            repositories: this.repositories,
            stageName,
        });
    }
}

export class CloudWatchOrchestratorFactory extends BaseOrchestratorFactory {
    constructor(orchestrators: Record<string, BaseOrchestratorFactory>) {
        super(orchestrators);
    }

    get name(): string {
        return NAME;
    }

    new(props: OrchestratorProps): Orchestrator {
        return new CloudWatchOrchestrator(props);
    }
}

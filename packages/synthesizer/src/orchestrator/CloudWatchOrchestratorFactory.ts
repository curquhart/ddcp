import {
    BaseOrchestratorFactory, BranchOptions,
    CodeBuildActionProps,
    Orchestrator,
    OrchestratorProps,
    Stage
} from './BaseOrchestratorFactory';
import { IPipeline} from '@aws-cdk/aws-codepipeline';
import {tOrDefault} from '@ddcp/typehelpers';
import {Uniquifier} from '../Uniquifier';
import {ManagerResources} from '../SynthesisHandler';
import {IRepository, Repository} from '@aws-cdk/aws-codecommit';
import * as targets from '@aws-cdk/aws-events-targets';
import {throwError} from '@ddcp/errorhandling';
import {EventField, RuleTargetInput} from '@aws-cdk/aws-events';

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
        sourceRepo.repository.onCommit(this.props.uniquifier.next('OnCommit'), {
            target: new targets.CodeBuildProject(props.project, {
                event: RuleTargetInput.fromObject({
                    sourceVersion: EventField.fromPath('$.detail.commitId'),
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
                })
            }),
            eventPattern: {
                detail: {
                    referenceType: [ 'branch' ],
                }
            },
            branches: sourceRepo.repositoryBranch.BranchName !== undefined ? [sourceRepo.repositoryBranch.BranchName] : undefined
        });
    }

    addS3PublishAction(): void {
        throw new Error('S3 Publish is not supported on CloudWatch orchestrated pipelines.');
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

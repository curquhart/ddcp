# Data Driven CodePipeline synthesizer

[![Build Status](https://ddcp-pipeline-badgeassetsdd232fa513-16aet7pptdyyx.s3-us-west-1.amazonaws.com/876f717f1bd19c4fd7d20b880a3c010fbe55ebc7)](https://us-west-1.console.aws.amazon.com/codesuite/codepipeline/pipelines/ddcp-build/view?region=us-west-1)
[![Coverage Status](https://coveralls.io/repos/github/curquhart/ddcp/badge.svg?branch=master)](https://coveralls.io/github/curquhart/ddcp?branch=master)

About
-----
DDCP (Data Driven CodePipeline synthesizer) is designed to make dynamic CodePipeline
configuration trivial. It is currently in a POC-like state and only supports CodeCommit and CodeBuild.

Please see [Enhancement Issues](https://github.com/curquhart/ddcp/labels/enhancement) for planned features and to
submit any feature requests.

### Deploy from SAR console
|        Region        |                    Click and Deploy                     |
| :----------------: | :----------------------------------------------------------: |
|  **ap-northeast-1**  |[![](https://img.shields.io/badge/SAR-Deploy%20Now-yellow.svg)](https://deploy.serverlessrepo.app/ap-northeast-1/?app=arn:aws:serverlessrepo:ap-northeast-1:901151029385:applications/ddcp)|
|  **ap-northeast-2**  |[![](https://img.shields.io/badge/SAR-Deploy%20Now-yellow.svg)](https://deploy.serverlessrepo.app/ap-northeast-2/?app=arn:aws:serverlessrepo:ap-northeast-2:901151029385:applications/ddcp)|
|  **ap-south-1**  |[![](https://img.shields.io/badge/SAR-Deploy%20Now-yellow.svg)](https://deploy.serverlessrepo.app/ap-south-1/?app=arn:aws:serverlessrepo:ap-south-1:901151029385:applications/ddcp)|
|  **ap-southeast-1**  |[![](https://img.shields.io/badge/SAR-Deploy%20Now-yellow.svg)](https://deploy.serverlessrepo.app/ap-southeast-1/?app=arn:aws:serverlessrepo:ap-southeast-1:901151029385:applications/ddcp)|
|  **ap-southeast-2**  |[![](https://img.shields.io/badge/SAR-Deploy%20Now-yellow.svg)](https://deploy.serverlessrepo.app/ap-southeast-2/?app=arn:aws:serverlessrepo:ap-southeast-2:901151029385:applications/ddcp)|
|  **ca-central-1**  |[![](https://img.shields.io/badge/SAR-Deploy%20Now-yellow.svg)](https://deploy.serverlessrepo.app/ca-central-1/?app=arn:aws:serverlessrepo:ca-central-1:901151029385:applications/ddcp)|
|  **eu-central-1**  |[![](https://img.shields.io/badge/SAR-Deploy%20Now-yellow.svg)](https://deploy.serverlessrepo.app/eu-central-1/?app=arn:aws:serverlessrepo:eu-central-1:901151029385:applications/ddcp)|
|  **eu-north-1**  |[![](https://img.shields.io/badge/SAR-Deploy%20Now-yellow.svg)](https://deploy.serverlessrepo.app/eu-north-1/?app=arn:aws:serverlessrepo:eu-north-1:901151029385:applications/ddcp)|
|  **eu-west-1**  |[![](https://img.shields.io/badge/SAR-Deploy%20Now-yellow.svg)](https://deploy.serverlessrepo.app/eu-west-1/?app=arn:aws:serverlessrepo:eu-west-1:901151029385:applications/ddcp)|
|  **eu-west-2**  |[![](https://img.shields.io/badge/SAR-Deploy%20Now-yellow.svg)](https://deploy.serverlessrepo.app/eu-west-2/?app=arn:aws:serverlessrepo:eu-west-2:901151029385:applications/ddcp)|
|  **eu-west-3**  |[![](https://img.shields.io/badge/SAR-Deploy%20Now-yellow.svg)](https://deploy.serverlessrepo.app/eu-west-3/?app=arn:aws:serverlessrepo:eu-west-3:901151029385:applications/ddcp)|
|  **sa-east-1**  |[![](https://img.shields.io/badge/SAR-Deploy%20Now-yellow.svg)](https://deploy.serverlessrepo.app/sa-east-1/?app=arn:aws:serverlessrepo:sa-east-1:901151029385:applications/ddcp)|
|  **us-east-1**  |[![](https://img.shields.io/badge/SAR-Deploy%20Now-yellow.svg)](https://deploy.serverlessrepo.app/us-east-1/?app=arn:aws:serverlessrepo:us-east-1:901151029385:applications/ddcp)|
|  **us-east-2**  |[![](https://img.shields.io/badge/SAR-Deploy%20Now-yellow.svg)](https://deploy.serverlessrepo.app/us-east-2/?app=arn:aws:serverlessrepo:us-east-2:901151029385:applications/ddcp)|
|  **us-west-1**  |[![](https://img.shields.io/badge/SAR-Deploy%20Now-yellow.svg)](https://deploy.serverlessrepo.app/us-west-1/?app=arn:aws:serverlessrepo:us-west-1:901151029385:applications/ddcp)|
|  **us-west-2**  |[![](https://img.shields.io/badge/SAR-Deploy%20Now-yellow.svg)](https://deploy.serverlessrepo.app/us-west-2/?app=arn:aws:serverlessrepo:us-west-2:901151029385:applications/ddcp)|

### Deploy from CLI

```
$ aws serverlessrepo create-cloud-formation-template --application-id arn:aws:serverlessrepo:us-west-1:901151029385:applications/ddcp
{
    "Status": "PREPARING",
    "TemplateId": "11111111-2222-3333-4444-555555555555",
    "CreationTime": "2020-04-11T01:02:03.456Z",
    "SemanticVersion": "1.0.0",
    "ExpirationTime": "2020-04-11T07:02:03.456Z",
    "ApplicationId": "arn:aws:serverlessrepo:us-west-1:901151029385:applications/ddcp",
    "TemplateUrl": ""
}
```

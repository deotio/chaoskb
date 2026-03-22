import { Duration } from 'aws-cdk-lib';
import { Architecture, FunctionUrl, FunctionUrlAuthType, Runtime, Tracing } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { TableV2 } from 'aws-cdk-lib/aws-dynamodb';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import * as path from 'path';

export interface ApiProps {
  readonly table: TableV2;
  readonly environment: string;
  readonly signupsEnabledParam: StringParameter;
  readonly reservedConcurrency?: number;
}

export class Api extends Construct {
  public readonly functionUrl: FunctionUrl;
  public readonly handler: NodejsFunction;

  constructor(scope: Construct, id: string, props: ApiProps) {
    super(scope, id);

    const deadLetterQueue = new Queue(this, 'DeadLetterQueue', {
      retentionPeriod: Duration.days(14),
    });

    this.handler = new NodejsFunction(this, 'Handler', {
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      entry: path.join(__dirname, '..', 'handler', 'index.ts'),
      handler: 'handler',
      memorySize: 256,
      timeout: Duration.seconds(30),
      environment: {
        TABLE_NAME: props.table.tableName,
        ENVIRONMENT: props.environment,
        SIGNUPS_ENABLED_PARAM: props.signupsEnabledParam.parameterName,
      },
      reservedConcurrentExecutions: props.reservedConcurrency ?? 10,
      deadLetterQueue,
      tracing: Tracing.ACTIVE,
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        format: undefined, // default cjs for Lambda
      },
    });

    this.functionUrl = this.handler.addFunctionUrl({
      authType: FunctionUrlAuthType.NONE,
    });

    props.table.grantReadWriteData(this.handler);
    props.signupsEnabledParam.grantRead(this.handler);
  }
}

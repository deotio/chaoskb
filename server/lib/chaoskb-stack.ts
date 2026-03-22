import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { BlobStore } from './constructs/blob-store.js';
import { Auth } from './constructs/auth.js';
import { Api } from './constructs/api.js';
import { AdminDashboard } from './constructs/admin-dashboard.js';
import { AdminApi } from './constructs/admin-api.js';

export interface ChaosKBStackProps extends StackProps {
  readonly environment: string;
  readonly signupsEnabled?: boolean;
  readonly reservedConcurrency?: number;
  readonly allowedOrigins?: string[];
}

export class ChaosKBStack extends Stack {
  public readonly blobStore: BlobStore;
  public readonly auth: Auth;
  public readonly api: Api;
  public readonly adminDashboard: AdminDashboard;
  public readonly adminApi: AdminApi;

  constructor(scope: Construct, id: string, props: ChaosKBStackProps) {
    super(scope, id, props);

    this.blobStore = new BlobStore(this, 'BlobStore', {
      environment: props.environment,
    });

    this.auth = new Auth(this, 'Auth', {
      environment: props.environment,
      signupsEnabled: props.signupsEnabled ?? true,
    });

    this.api = new Api(this, 'Api', {
      table: this.blobStore.table,
      environment: props.environment,
      signupsEnabledParam: this.auth.signupsEnabledParam,
      reservedConcurrency: props.reservedConcurrency,
    });

    this.adminDashboard = new AdminDashboard(this, 'AdminDashboard', {
      environment: props.environment,
      lambdaFunction: this.api.handler,
      table: this.blobStore.table,
    });

    this.adminApi = new AdminApi(this, 'AdminApi', {
      table: this.blobStore.table,
      environment: props.environment,
      allowedOrigins: props.allowedOrigins ?? [],
    });

    new CfnOutput(this, 'FunctionUrl', {
      value: this.api.functionUrl.url,
      description: 'ChaosKB API Function URL',
    });

    new CfnOutput(this, 'TableName', {
      value: this.blobStore.table.tableName,
      description: 'ChaosKB DynamoDB table name',
    });

    new CfnOutput(this, 'AlarmTopicArn', {
      value: this.adminDashboard.alarmTopic.topicArn,
      description: 'ChaosKB alarm SNS topic ARN',
    });

    new CfnOutput(this, 'AdminApiUrl', {
      value: this.adminApi.functionUrl.url,
      description: 'ChaosKB Admin API Function URL',
    });
  }
}

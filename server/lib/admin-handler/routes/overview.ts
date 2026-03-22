import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { CloudWatchClient, DescribeAlarmsCommand } from '@aws-sdk/client-cloudwatch';
import {
  CostExplorerClient,
  GetCostAndUsageCommand,
} from '@aws-sdk/client-cost-explorer';
import { logger } from '../../handler/logger.js';

interface RouteResult {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
}

export async function handleOverview(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  environment: string,
): Promise<RouteResult> {
  try {
    // Tenant count, blob count, and storage total from DynamoDB
    let totalTenants = 0;
    let totalBlobs = 0;
    let totalStorageBytes = 0;

    // Scan META records
    let exclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const result = await ddb.send(
        new ScanCommand({
          TableName: tableName,
          FilterExpression: 'SK = :sk',
          ExpressionAttributeValues: { ':sk': 'META' },
          ProjectionExpression: 'storageUsedBytes',
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );

      if (result.Items) {
        totalTenants += result.Items.length;
        for (const item of result.Items) {
          totalStorageBytes += (item['storageUsedBytes'] as number) ?? 0;
        }
      }
      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);

    // Scan BLOB records for count
    let blobStartKey: Record<string, unknown> | undefined;
    do {
      const result = await ddb.send(
        new ScanCommand({
          TableName: tableName,
          FilterExpression: 'begins_with(SK, :sk)',
          ExpressionAttributeValues: { ':sk': 'BLOB#' },
          Select: 'COUNT',
          ExclusiveStartKey: blobStartKey,
        }),
      );

      totalBlobs += result.Count ?? 0;
      blobStartKey = result.LastEvaluatedKey;
    } while (blobStartKey);

    // Health status from CloudWatch
    let healthStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    let alarmCount = 0;
    try {
      const cw = new CloudWatchClient({});
      const alarmsResult = await cw.send(
        new DescribeAlarmsCommand({
          AlarmNamePrefix: `chaoskb-${environment}-`,
          StateValue: 'ALARM',
        }),
      );
      alarmCount = alarmsResult.MetricAlarms?.length ?? 0;
      if (alarmCount > 0) healthStatus = 'unhealthy';
    } catch {
      healthStatus = 'degraded';
    }

    // Cost MTD from Cost Explorer
    let costMtd = 0;
    try {
      const ce = new CostExplorerClient({ region: 'us-east-1' });
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      const today = now.toISOString().split('T')[0];

      const costResult = await ce.send(
        new GetCostAndUsageCommand({
          TimePeriod: { Start: startOfMonth, End: today },
          Granularity: 'MONTHLY',
          Metrics: ['UnblendedCost'],
          Filter: {
            Tags: {
              Key: 'Project',
              Values: [`chaoskb-${environment}`],
            },
          },
        }),
      );

      for (const period of costResult.ResultsByTime ?? []) {
        costMtd += parseFloat(period.Total?.['UnblendedCost']?.Amount ?? '0');
      }
    } catch {
      // Cost data may be unavailable
      logger.warn('Cost data unavailable for overview');
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        environment,
        totalTenants,
        totalBlobs,
        totalStorageBytes,
        healthStatus,
        activeAlarms: alarmCount,
        costMtd: Math.round(costMtd * 100) / 100,
      }),
      headers: { 'Content-Type': 'application/json' },
    };
  } catch (err) {
    logger.error('Failed to get overview', { error: String(err) });
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'internal_error', message: 'Failed to get overview' }),
      headers: { 'Content-Type': 'application/json' },
    };
  }
}

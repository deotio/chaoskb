import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { CloudWatchClient, DescribeAlarmsCommand } from '@aws-sdk/client-cloudwatch';
import {
  CostExplorerClient,
  GetCostAndUsageCommand,
  GetCostForecastCommand,
} from '@aws-sdk/client-cost-explorer';
import { logger } from '../../handler/logger.js';

interface RouteResult {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
}

export async function handleUsageMetrics(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  environment: string,
): Promise<RouteResult> {
  try {
    // Total tenants: Scan count where SK='META'
    let totalTenants = 0;
    let totalBlobs = 0;
    let totalStorageBytes = 0;
    let active7d = 0;
    let active30d = 0;

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Scan META records for tenant stats
    let exclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const result = await ddb.send(
        new ScanCommand({
          TableName: tableName,
          FilterExpression: 'SK = :sk',
          ExpressionAttributeValues: { ':sk': 'META' },
          ProjectionExpression: 'storageUsedBytes, updatedAt',
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );

      if (result.Items) {
        totalTenants += result.Items.length;
        for (const item of result.Items) {
          totalStorageBytes += (item['storageUsedBytes'] as number) ?? 0;
          const updatedAt = item['updatedAt'] as string | undefined;
          if (updatedAt && updatedAt >= sevenDaysAgo) active7d++;
          if (updatedAt && updatedAt >= thirtyDaysAgo) active30d++;
        }
      }
      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);

    // Scan BLOB records for total blob count
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

    // Mock chart data (would come from CloudWatch in production)
    const chartData = {
      dailySyncRequests: Array.from({ length: 7 }, (_, i) => ({
        date: new Date(now.getTime() - (6 - i) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        count: Math.floor(Math.random() * 100) + 10,
      })),
      tenantGrowth: Array.from({ length: 30 }, (_, i) => ({
        date: new Date(now.getTime() - (29 - i) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        total: totalTenants - (29 - i),
      })),
    };

    return {
      statusCode: 200,
      body: JSON.stringify({
        environment,
        totalTenants,
        totalBlobs,
        totalStorageBytes,
        active7d,
        active30d,
        charts: chartData,
      }),
      headers: { 'Content-Type': 'application/json' },
    };
  } catch (err) {
    logger.error('Failed to get usage metrics', { error: String(err) });
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'internal_error', message: 'Failed to get usage metrics' }),
      headers: { 'Content-Type': 'application/json' },
    };
  }
}

export async function handleHealthMetrics(environment: string): Promise<RouteResult> {
  try {
    const cw = new CloudWatchClient({});
    const alarmsResult = await cw.send(
      new DescribeAlarmsCommand({
        AlarmNamePrefix: `chaoskb-${environment}-`,
      }),
    );

    const alarms = alarmsResult.MetricAlarms ?? [];
    const services = alarms.map((alarm) => ({
      name: alarm.AlarmName ?? 'unknown',
      status: alarm.StateValue === 'OK' ? 'healthy' : alarm.StateValue === 'ALARM' ? 'unhealthy' : 'unknown',
      message: alarm.StateReason ?? '',
    }));

    // If no alarms are configured, report the basic service as healthy
    if (services.length === 0) {
      services.push(
        { name: 'api', status: 'healthy', message: 'No alarms configured' },
        { name: 'database', status: 'healthy', message: 'No alarms configured' },
      );
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        environment,
        services,
        incidents: [],
      }),
      headers: { 'Content-Type': 'application/json' },
    };
  } catch (err) {
    logger.error('Failed to get health metrics', { error: String(err) });
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'internal_error', message: 'Failed to get health metrics' }),
      headers: { 'Content-Type': 'application/json' },
    };
  }
}

export async function handleCostMetrics(environment: string): Promise<RouteResult> {
  try {
    const ce = new CostExplorerClient({ region: 'us-east-1' });

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const today = now.toISOString().split('T')[0];
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

    // MTD spend by service
    const costResult = await ce.send(
      new GetCostAndUsageCommand({
        TimePeriod: { Start: startOfMonth, End: today },
        Granularity: 'DAILY',
        Metrics: ['UnblendedCost'],
        GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
        Filter: {
          Tags: {
            Key: 'Project',
            Values: [`chaoskb-${environment}`],
          },
        },
      }),
    );

    const monthlySpend = (costResult.ResultsByTime ?? []).map((period) => ({
      date: period.TimePeriod?.Start ?? '',
      total: (period.Groups ?? []).reduce((sum, g) => {
        return sum + parseFloat(g.Metrics?.['UnblendedCost']?.Amount ?? '0');
      }, 0),
    }));

    const spendByService: Record<string, number> = {};
    for (const period of costResult.ResultsByTime ?? []) {
      for (const group of period.Groups ?? []) {
        const service = group.Keys?.[0] ?? 'Unknown';
        const amount = parseFloat(group.Metrics?.['UnblendedCost']?.Amount ?? '0');
        spendByService[service] = (spendByService[service] ?? 0) + amount;
      }
    }

    // Forecast for rest of month
    let forecast: { forecastedTotal: string; currency: string } | null = null;
    try {
      const forecastResult = await ce.send(
        new GetCostForecastCommand({
          TimePeriod: { Start: today, End: endOfMonth },
          Metric: 'UNBLENDED_COST',
          Granularity: 'MONTHLY',
        }),
      );
      forecast = {
        forecastedTotal: forecastResult.Total?.Amount ?? '0',
        currency: forecastResult.Total?.Unit ?? 'USD',
      };
    } catch {
      // Forecast may fail if not enough historical data
      logger.warn('Cost forecast unavailable');
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        environment,
        monthlySpend,
        spendByService: Object.entries(spendByService).map(([service, amount]) => ({
          service,
          amount: Math.round(amount * 100) / 100,
        })),
        forecast,
      }),
      headers: { 'Content-Type': 'application/json' },
    };
  } catch (err) {
    logger.error('Failed to get cost metrics', { error: String(err) });
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'internal_error', message: 'Failed to get cost metrics' }),
      headers: { 'Content-Type': 'application/json' },
    };
  }
}

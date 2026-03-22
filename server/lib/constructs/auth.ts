import { Construct } from 'constructs';
import { aws_ssm as ssm } from 'aws-cdk-lib';

export interface AuthProps {
  readonly environment: string;
  readonly signupsEnabled?: boolean;
}

export class Auth extends Construct {
  public readonly signupsEnabledParam: ssm.StringParameter;

  constructor(scope: Construct, id: string, props: AuthProps) {
    super(scope, id);

    this.signupsEnabledParam = new ssm.StringParameter(this, 'SignupsEnabled', {
      parameterName: `/chaoskb/${props.environment}/signups-enabled`,
      stringValue: props.signupsEnabled === false ? 'false' : 'true',
      description: 'Whether new user signups are enabled',
    });
  }
}

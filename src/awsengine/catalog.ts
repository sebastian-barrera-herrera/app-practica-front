/** Datos de referencia de «AWS»: regiones, zonas, imágenes (AMI), tipos de instancia y políticas administradas. */
import type { PolicyDoc, PolicyStatement } from './types';
import { stableId } from './util';

// ───────────────────────── regiones ─────────────────────────

export interface RegionInfo {
  code: string;
  name: string;
  /** Letras de las zonas de disponibilidad. */
  azs: string[];
  optIn?: boolean;
}

export const REGIONS: RegionInfo[] = [
  { code: 'us-east-1', name: 'US East (N. Virginia)', azs: ['a', 'b', 'c', 'd', 'e', 'f'] },
  { code: 'us-east-2', name: 'US East (Ohio)', azs: ['a', 'b', 'c'] },
  { code: 'us-west-1', name: 'US West (N. California)', azs: ['a', 'b'] },
  { code: 'us-west-2', name: 'US West (Oregon)', azs: ['a', 'b', 'c', 'd'] },
  { code: 'ca-central-1', name: 'Canada (Central)', azs: ['a', 'b', 'd'] },
  { code: 'sa-east-1', name: 'South America (São Paulo)', azs: ['a', 'b', 'c'] },
  { code: 'eu-west-1', name: 'Europe (Ireland)', azs: ['a', 'b', 'c'] },
  { code: 'eu-west-2', name: 'Europe (London)', azs: ['a', 'b', 'c'] },
  { code: 'eu-west-3', name: 'Europe (Paris)', azs: ['a', 'b', 'c'] },
  { code: 'eu-central-1', name: 'Europe (Frankfurt)', azs: ['a', 'b', 'c'] },
  { code: 'eu-north-1', name: 'Europe (Stockholm)', azs: ['a', 'b', 'c'] },
  { code: 'eu-south-2', name: 'Europe (Spain)', azs: ['a', 'b', 'c'] },
  { code: 'ap-south-1', name: 'Asia Pacific (Mumbai)', azs: ['a', 'b', 'c'] },
  { code: 'ap-southeast-1', name: 'Asia Pacific (Singapore)', azs: ['a', 'b', 'c'] },
  { code: 'ap-southeast-2', name: 'Asia Pacific (Sydney)', azs: ['a', 'b', 'c'] },
  { code: 'ap-northeast-1', name: 'Asia Pacific (Tokyo)', azs: ['a', 'c', 'd'] },
  { code: 'ap-northeast-2', name: 'Asia Pacific (Seoul)', azs: ['a', 'b', 'c', 'd'] },
  { code: 'af-south-1', name: 'Africa (Cape Town)', azs: ['a', 'b', 'c'], optIn: true },
  { code: 'ap-east-1', name: 'Asia Pacific (Hong Kong)', azs: ['a', 'b', 'c'], optIn: true },
];

export const regionInfo = (code: string): RegionInfo | undefined => REGIONS.find((r) => r.code === code);
export const isRegion = (code: string): boolean => REGIONS.some((r) => r.code === code);

// ───────────────────────── imágenes ─────────────────────────

export interface ImageDef {
  key: string;
  name: string;
  description: string;
  owner: string;
  ownerAlias?: string;
  arch: 'x86_64' | 'arm64';
  platform?: 'windows';
  created: string;
  ssm?: string;
  rootDevice: string;
}

export const IMAGES: ImageDef[] = [
  { key: 'al2023-x86', name: 'al2023-ami-2023.6.20250609.0-kernel-6.1-x86_64', description: 'Amazon Linux 2023 AMI 2023.6.20250609.0 x86_64 HVM kernel-6.1', owner: '137112412989', ownerAlias: 'amazon', arch: 'x86_64', created: '2025-06-09T18:20:11+00:00', ssm: '/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64', rootDevice: '/dev/xvda' },
  { key: 'al2023-arm', name: 'al2023-ami-2023.6.20250609.0-kernel-6.1-arm64', description: 'Amazon Linux 2023 AMI 2023.6.20250609.0 arm64 HVM kernel-6.1', owner: '137112412989', ownerAlias: 'amazon', arch: 'arm64', created: '2025-06-09T18:20:30+00:00', ssm: '/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64', rootDevice: '/dev/xvda' },
  { key: 'al2-x86', name: 'amzn2-ami-kernel-5.10-hvm-2.0.20250610.0-x86_64-gp2', description: 'Amazon Linux 2 Kernel 5.10 AMI 2.0.20250610.0 x86_64 HVM gp2', owner: '137112412989', ownerAlias: 'amazon', arch: 'x86_64', created: '2025-06-10T17:02:44+00:00', ssm: '/aws/service/ami-amazon-linux-latest/amzn2-ami-kernel-5.10-hvm-x86_64-gp2', rootDevice: '/dev/xvda' },
  { key: 'ubuntu-2404', name: 'ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-20250610', description: 'Canonical, Ubuntu, 24.04, amd64 noble image', owner: '099720109477', arch: 'x86_64', created: '2025-06-10T09:41:02+00:00', ssm: '/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id', rootDevice: '/dev/sda1' },
  { key: 'ubuntu-2204', name: 'ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-20250601', description: 'Canonical, Ubuntu, 22.04 LTS, amd64 jammy image', owner: '099720109477', arch: 'x86_64', created: '2025-06-01T08:12:55+00:00', ssm: '/aws/service/canonical/ubuntu/server/22.04/stable/current/amd64/hvm/ebs-gp2/ami-id', rootDevice: '/dev/sda1' },
  { key: 'debian-12', name: 'debian-12-amd64-20250530-2101', description: 'Debian 12 (20250530-2101)', owner: '136693071363', arch: 'x86_64', created: '2025-05-30T21:01:44+00:00', rootDevice: '/dev/xvda' },
  { key: 'win-2022', name: 'Windows_Server-2022-English-Full-Base-2025.06.11', description: 'Microsoft Windows Server 2022 Full Locale English AMI provided by Amazon', owner: '801119661308', ownerAlias: 'amazon', arch: 'x86_64', platform: 'windows', created: '2025-06-11T10:15:00+00:00', ssm: '/aws/service/ami-windows-latest/Windows_Server-2022-English-Full-Base', rootDevice: '/dev/sda1' },
];

export const imageId = (region: string, key: string) => stableId(`ami:${region}:${key}`, 'ami-0', 16);
export const findImage = (region: string, id: string): ImageDef | undefined => IMAGES.find((i) => imageId(region, i.key) === id);

// ───────────────────────── tipos de instancia ─────────────────────────

export interface InstanceTypeInfo {
  type: string;
  vcpu: number;
  mem: number; // MiB
  arch: 'x86_64' | 'arm64';
  net: string;
  /** USD por hora (orientativo, us-east-1 bajo demanda Linux). */
  price: number;
  burst?: boolean;
  freeTier?: boolean;
  /** Almacenamiento local (instance store) en GB. */
  store?: number;
  gpu?: number;
}

const T = (type: string, vcpu: number, mem: number, price: number, o: Partial<InstanceTypeInfo> = {}): InstanceTypeInfo => ({ type, vcpu, mem, price, arch: 'x86_64', net: 'Up to 5 Gigabit', ...o });

export const INSTANCE_TYPES: InstanceTypeInfo[] = [
  T('t2.nano', 1, 512, 0.0058, { burst: true, net: 'Low' }),
  T('t2.micro', 1, 1024, 0.0116, { burst: true, freeTier: true, net: 'Low to Moderate' }),
  T('t2.small', 1, 2048, 0.023, { burst: true, net: 'Low to Moderate' }),
  T('t2.medium', 2, 4096, 0.0464, { burst: true, net: 'Low to Moderate' }),
  T('t3.nano', 2, 512, 0.0052, { burst: true }),
  T('t3.micro', 2, 1024, 0.0104, { burst: true, freeTier: true }),
  T('t3.small', 2, 2048, 0.0208, { burst: true }),
  T('t3.medium', 2, 4096, 0.0416, { burst: true }),
  T('t3.large', 2, 8192, 0.0832, { burst: true }),
  T('t3.xlarge', 4, 16384, 0.1664, { burst: true }),
  T('t3a.micro', 2, 1024, 0.0094, { burst: true }),
  T('t4g.nano', 2, 512, 0.0042, { burst: true, arch: 'arm64' }),
  T('t4g.micro', 2, 1024, 0.0084, { burst: true, arch: 'arm64', freeTier: true }),
  T('t4g.small', 2, 2048, 0.0168, { burst: true, arch: 'arm64' }),
  T('t4g.medium', 2, 4096, 0.0336, { burst: true, arch: 'arm64' }),
  T('m5.large', 2, 8192, 0.096, { net: 'Up to 10 Gigabit' }),
  T('m5.xlarge', 4, 16384, 0.192, { net: 'Up to 10 Gigabit' }),
  T('m6i.large', 2, 8192, 0.096, { net: 'Up to 12.5 Gigabit' }),
  T('m6g.large', 2, 8192, 0.077, { arch: 'arm64', net: 'Up to 10 Gigabit' }),
  T('m7g.large', 2, 8192, 0.0816, { arch: 'arm64', net: 'Up to 12.5 Gigabit' }),
  T('c5.large', 2, 4096, 0.085, { net: 'Up to 10 Gigabit' }),
  T('c5.xlarge', 4, 8192, 0.17, { net: 'Up to 10 Gigabit' }),
  T('c6i.large', 2, 4096, 0.085, { net: 'Up to 12.5 Gigabit' }),
  T('c7g.large', 2, 4096, 0.0725, { arch: 'arm64', net: 'Up to 12.5 Gigabit' }),
  T('r5.large', 2, 16384, 0.126, { net: 'Up to 10 Gigabit' }),
  T('r6i.large', 2, 16384, 0.126, { net: 'Up to 12.5 Gigabit' }),
  T('i3.large', 2, 15616, 0.156, { net: 'Up to 10 Gigabit', store: 475 }),
  T('g4dn.xlarge', 4, 16384, 0.526, { net: 'Up to 25 Gigabit', store: 125, gpu: 1 }),
  T('p3.2xlarge', 8, 62464, 3.06, { net: 'Up to 10 Gigabit', gpu: 1 }),
];

export const instanceType = (t: string): InstanceTypeInfo | undefined => INSTANCE_TYPES.find((x) => x.type === t);

// ───────────────────────── políticas administradas por AWS ─────────────────────────

const allow = (action: string | string[], resource: string | string[] = '*'): PolicyStatement => ({ Effect: 'Allow', Action: action, Resource: resource });
const doc = (...Statement: PolicyStatement[]): PolicyDoc => ({ Version: '2012-10-17', Statement });

export interface AwsPolicyDef {
  name: string;
  path: string;
  description: string;
  document: PolicyDoc;
}

export const AWS_POLICIES: AwsPolicyDef[] = [
  { name: 'AdministratorAccess', path: '/', description: 'Provides full access to AWS services and resources.', document: doc(allow('*')) },
  {
    name: 'PowerUserAccess',
    path: '/',
    description: 'Provides full access to AWS services and resources, but does not allow management of Users and groups.',
    document: doc(
      { Effect: 'Allow', NotAction: ['iam:*', 'organizations:*', 'account:*'], Resource: '*' },
      allow(['iam:CreateServiceLinkedRole', 'iam:DeleteServiceLinkedRole', 'iam:ListRoles', 'organizations:DescribeOrganization', 'account:ListRegions', 'account:GetAccountInformation']),
    ),
  },
  { name: 'ReadOnlyAccess', path: '/', description: 'Provides read-only access to AWS services and resources.', document: doc(allow(['*:Describe*', '*:Get*', '*:List*', '*:View*', 'cloudwatch:BatchGet*', 'logs:StartQuery', 'logs:StopQuery', 'logs:FilterLogEvents'])) },
  { name: 'ViewOnlyAccess', path: '/job-function/', description: 'This policy grants permissions to view resources and basic metadata across all AWS services.', document: doc(allow(['*:Describe*', '*:List*', 'ec2:Get*', 'iam:Get*Policy', 's3:GetBucket*'])) },
  { name: 'IAMFullAccess', path: '/', description: 'Provides full access to IAM via the AWS Management Console.', document: doc(allow(['iam:*', 'organizations:DescribeAccount', 'organizations:DescribeOrganization', 'organizations:ListRoots', 'organizations:ListAccounts'])) },
  { name: 'IAMReadOnlyAccess', path: '/', description: 'Provides read only access to IAM via the AWS Management Console.', document: doc(allow(['iam:GenerateCredentialReport', 'iam:GenerateServiceLastAccessedDetails', 'iam:Get*', 'iam:List*', 'iam:SimulateCustomPolicy', 'iam:SimulatePrincipalPolicy'])) },
  { name: 'IAMUserChangePassword', path: '/', description: 'Provides access to change own password.', document: doc(allow('iam:ChangePassword', '*'), allow('iam:GetAccountPasswordPolicy', '*')) },
  { name: 'AmazonS3FullAccess', path: '/', description: 'Provides full access to all buckets via the AWS Management Console.', document: doc(allow(['s3:*', 's3-object-lambda:*'])) },
  { name: 'AmazonS3ReadOnlyAccess', path: '/', description: 'Provides read only access to all buckets via the AWS Management Console.', document: doc(allow(['s3:Get*', 's3:List*', 's3:Describe*', 's3-object-lambda:Get*', 's3-object-lambda:List*'])) },
  { name: 'AmazonEC2FullAccess', path: '/', description: 'Provides full access to Amazon EC2 via the AWS Management Console.', document: doc(allow(['ec2:*', 'elasticloadbalancing:*', 'cloudwatch:*', 'autoscaling:*'])) },
  { name: 'AmazonEC2ReadOnlyAccess', path: '/', description: 'Provides read only access to Amazon EC2 via the AWS Management Console.', document: doc(allow(['ec2:Describe*', 'ec2:GetConsoleOutput', 'elasticloadbalancing:Describe*', 'cloudwatch:ListMetrics', 'cloudwatch:GetMetricStatistics', 'cloudwatch:Describe*', 'autoscaling:Describe*'])) },
  { name: 'AmazonSSMManagedInstanceCore', path: '/', description: 'The policy for Amazon EC2 Role to enable AWS Systems Manager service core functionality.', document: doc(allow(['ssm:DescribeAssociation', 'ssm:GetDeployablePatchSnapshotForInstance', 'ssm:GetDocument', 'ssm:ListAssociations', 'ssm:UpdateInstanceInformation', 'ssmmessages:*', 'ec2messages:*'])) },
  { name: 'AmazonSNSFullAccess', path: '/', description: 'Provides full access to Amazon SNS via the AWS Management Console.', document: doc(allow('sns:*')) },
  { name: 'CloudWatchFullAccess', path: '/', description: 'Provides full access to CloudWatch.', document: doc(allow(['autoscaling:Describe*', 'cloudwatch:*', 'logs:*', 'sns:CreateTopic', 'sns:Get*', 'sns:List*'])) },
  { name: 'CloudWatchReadOnlyAccess', path: '/', description: 'Provides read only access to CloudWatch.', document: doc(allow(['cloudwatch:Describe*', 'cloudwatch:Get*', 'cloudwatch:List*', 'logs:Get*', 'logs:List*', 'logs:Describe*'])) },
  { name: 'CloudWatchLogsFullAccess', path: '/', description: 'Provides full access to CloudWatch Logs.', document: doc(allow(['logs:*', 'cloudwatch:GenerateQuery'])) },
  { name: 'CloudWatchLogsReadOnlyAccess', path: '/', description: 'Provides read only access to CloudWatch Logs.', document: doc(allow(['logs:Describe*', 'logs:Get*', 'logs:List*', 'logs:StartQuery', 'logs:StopQuery', 'logs:TestMetricFilter', 'logs:FilterLogEvents'])) },
  { name: 'CloudWatchAgentServerPolicy', path: '/', description: 'Permissions required to use AmazonCloudWatchAgent on servers.', document: doc(allow(['cloudwatch:PutMetricData', 'ec2:DescribeVolumes', 'ec2:DescribeTags', 'logs:PutLogEvents', 'logs:DescribeLogStreams', 'logs:DescribeLogGroups', 'logs:CreateLogStream', 'logs:CreateLogGroup', 'ssm:GetParameter'])) },
  { name: 'AmazonVPCFullAccess', path: '/', description: 'Provides full access to Amazon VPC via the AWS Management Console.', document: doc(allow(['ec2:AcceptVpcPeeringConnection', 'ec2:*Vpc*', 'ec2:*Subnet*', 'ec2:*Gateway*', 'ec2:*Route*', 'ec2:*Address*', 'ec2:*NetworkAcl*', 'ec2:*DhcpOptions*', 'ec2:*SecurityGroup*', 'ec2:*NetworkInterface*', 'ec2:*FlowLogs*', 'ec2:*Tags', 'ec2:*TransitGateway*', 'ec2:*Vpn*', 'ec2:*CustomerGateway*', 'ec2:*PrefixList*', 'ec2:Describe*', 'ec2:*NetworkInsights*', 'logs:DescribeLogGroups', 'logs:DescribeLogStreams', 'logs:GetLogEvents'])) },
  { name: 'AWSLambdaBasicExecutionRole', path: '/service-role/', description: 'Provides write permissions to CloudWatch Logs.', document: doc(allow(['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'])) },
  { name: 'AWSLambdaSQSQueueExecutionRole', path: '/service-role/', description: 'Provides receive message, delete message, and read attribute access to SQS queues, and write permissions to CloudWatch logs.', document: doc(allow(['sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes', 'logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'])) },
  { name: 'AWSLambdaVPCAccessExecutionRole', path: '/service-role/', description: 'Provides minimum permissions for a Lambda function to execute while accessing a resource within a VPC.', document: doc(allow(['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents', 'ec2:CreateNetworkInterface', 'ec2:DescribeNetworkInterfaces', 'ec2:DeleteNetworkInterface', 'ec2:AssignPrivateIpAddresses', 'ec2:UnassignPrivateIpAddresses'])) },
  { name: 'AWSLambdaRole', path: '/service-role/', description: 'Default policy for AWS Lambda service role.', document: doc(allow('lambda:InvokeFunction')) },
  { name: 'AmazonSQSFullAccess', path: '/', description: 'Provides full access to Amazon SQS queues.', document: doc(allow('sqs:*')) },
  { name: 'AmazonSQSReadOnlyAccess', path: '/', description: 'Provides read only access to Amazon SQS queues.', document: doc(allow(['sqs:GetQueueAttributes', 'sqs:GetQueueUrl', 'sqs:ListQueues', 'sqs:ReceiveMessage', 'sqs:ListDeadLetterSourceQueues', 'sqs:ListQueueTags'])) },
  { name: 'AmazonEventBridgeFullAccess', path: '/', description: 'Provides full access to Amazon EventBridge.', document: doc(allow(['events:*', 'schemas:*', 'scheduler:*', 'pipes:*']), allow('iam:PassRole', '*')) },
  { name: 'AWSStepFunctionsFullAccess', path: '/', description: 'Provides full access to AWS Step Functions.', document: doc(allow(['states:*', 'iam:ListRoles', 'iam:PassRole', 'lambda:ListFunctions', 'cloudwatch:*', 'logs:*'])) },
  { name: 'AWSStepFunctionsReadOnlyAccess', path: '/', description: 'Provides read only access to AWS Step Functions.', document: doc(allow(['states:Describe*', 'states:Get*', 'states:List*'])) },
  { name: 'AmazonAPIGatewayAdministrator', path: '/', description: 'Provides full access to create/edit/delete APIs in Amazon API Gateway via the AWS Management Console.', document: doc(allow(['apigateway:*', 'execute-api:*'])) },
  { name: 'AmazonAPIGatewayInvokeFullAccess', path: '/', description: 'Provides full access to invoke APIs in Amazon API Gateway.', document: doc(allow('execute-api:Invoke')) },
  { name: 'AmazonCognitoPowerUser', path: '/', description: 'Can create and manage Amazon Cognito identity pools and user pools.', document: doc(allow(['cognito-identity:*', 'cognito-idp:*', 'cognito-sync:*'])) },
  { name: 'AmazonCognitoReadOnly', path: '/', description: 'Provides read only access to Amazon Cognito.', document: doc(allow(['cognito-identity:Describe*', 'cognito-identity:Get*', 'cognito-identity:List*', 'cognito-idp:Describe*', 'cognito-idp:AdminGet*', 'cognito-idp:AdminList*', 'cognito-idp:List*', 'cognito-idp:Get*'])) },
  { name: 'AWSXRayDaemonWriteAccess', path: '/', description: 'Allows the X-Ray daemon to upload telemetry.', document: doc(allow(['xray:PutTraceSegments', 'xray:PutTelemetryRecords', 'xray:GetSamplingRules', 'xray:GetSamplingTargets', 'xray:GetSamplingStatisticSummaries'])) },
  { name: 'AWSBudgetsReadOnlyAccess', path: '/', description: 'Provides read only access to AWS Budgets.', document: doc(allow(['budgets:Describe*', 'budgets:View*'])) },
  { name: 'Billing', path: '/job-function/', description: 'Grants permissions for billing and cost management.', document: doc(allow(['aws-portal:*Billing', 'aws-portal:*Usage', 'aws-portal:*PaymentMethods', 'budgets:ViewBudget', 'budgets:ModifyBudget', 'ce:*', 'cur:*'])) },
  { name: 'SecurityAudit', path: '/', description: 'The security audit template grants access to read security configuration metadata.', document: doc(allow(['iam:Get*', 'iam:List*', 'iam:GenerateCredentialReport', 's3:GetBucketPolicy', 's3:GetBucketAcl', 's3:GetBucketPublicAccessBlock', 's3:GetEncryptionConfiguration', 's3:ListAllMyBuckets', 'ec2:Describe*', 'cloudtrail:Describe*', 'cloudtrail:Get*', 'config:Describe*'])) },
  { name: 'AmazonDynamoDBFullAccess', path: '/', description: 'Provides full access to Amazon DynamoDB via the AWS Management Console.', document: doc(allow(['dynamodb:*', 'cloudwatch:*', 'application-autoscaling:*'])) },
  { name: 'AWSLambdaDynamoDBExecutionRole', path: '/service-role/', description: 'Provides list and read access to DynamoDB streams and write permissions to CloudWatch Logs.', document: doc(allow(['dynamodb:DescribeStream', 'dynamodb:GetRecords', 'dynamodb:GetShardIterator', 'dynamodb:ListStreams', 'logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'])) },
  { name: 'AmazonDynamoDBReadOnlyAccess', path: '/', description: 'Provides read only access to Amazon DynamoDB via the AWS Management Console.', document: doc(allow(['dynamodb:BatchGet*', 'dynamodb:DescribeStream', 'dynamodb:Describe*', 'dynamodb:Get*', 'dynamodb:List*', 'dynamodb:Query', 'dynamodb:Scan', 'cloudwatch:Get*', 'cloudwatch:List*', 'application-autoscaling:Describe*'])) },
  { name: 'AmazonElastiCacheFullAccess', path: '/', description: 'Provides full access to Amazon ElastiCache via the AWS Management Console.', document: doc(allow(['elasticache:*', 'ec2:Describe*', 'cloudwatch:*', 'logs:*'])) },
  { name: 'AmazonRDSFullAccess', path: '/', description: 'Provides full access to Amazon RDS via the AWS Management Console.', document: doc(allow(['rds:*', 'ec2:Describe*', 'cloudwatch:*', 'logs:*', 'pi:*', 'iam:PassRole'])) },
  { name: 'AmazonRDSReadOnlyAccess', path: '/', description: 'Provides read only access to Amazon RDS via the AWS Management Console.', document: doc(allow(['rds:Describe*', 'rds:ListTagsForResource', 'ec2:DescribeAccountAttributes', 'ec2:DescribeAvailabilityZones', 'ec2:DescribeInternetGateways', 'ec2:DescribeSecurityGroups', 'ec2:DescribeSubnets', 'ec2:DescribeVpcAttribute', 'ec2:DescribeVpcs', 'cloudwatch:GetMetricStatistics'])) },
  { name: 'AWSDataSyncFullAccess', path: '/', description: 'Provides full access to AWS DataSync and related services.', document: doc(allow(['datasync:*', 'ec2:CreateNetworkInterface', 'ec2:DescribeNetworkInterfaces', 'iam:PassRole', 'logs:*'])) },
  { name: 'AWSDMSFullAccess', path: '/', description: 'Provides full access to AWS Database Migration Service.', document: doc(allow(['dms:*', 'ec2:Describe*', 'iam:PassRole', 'logs:*', 'kms:ListAliases'])) },
  { name: 'AmazonDMSVPCManagementRole', path: '/service-role/', description: 'Provides access to manage VPC settings for AWS managed customer configurations.', document: doc(allow(['ec2:CreateNetworkInterface', 'ec2:DescribeAvailabilityZones', 'ec2:DescribeInternetGateways', 'ec2:DescribeSecurityGroups', 'ec2:DescribeSubnets', 'ec2:DescribeVpcs', 'ec2:DeleteNetworkInterface', 'ec2:ModifyNetworkInterfaceAttribute'])) },
  { name: 'SecretsManagerReadWrite', path: '/', description: 'Provides full access to AWS Secrets Manager.', document: doc(allow(['secretsmanager:*', 'cloudformation:CreateChangeSet', 'cloudformation:DescribeChangeSet', 'cloudformation:ExecuteChangeSet', 'cloudformation:DescribeStacks', 'cloudformation:ListStacks', 'cloudformation:GetTemplate', 'ec2:DescribeSecurityGroups', 'ec2:DescribeSubnets', 'ec2:DescribeVpcs', 'kms:DescribeKey', 'kms:ListAliases', 'kms:ListKeys', 'lambda:ListFunctions', 'rds:DescribeDBClusters', 'rds:DescribeDBInstances', 'tag:GetResources'])) },
  { name: 'AWSLambda_FullAccess', path: '/', description: 'Grants full access to AWS Lambda service, AWS Lambda console features, and other related AWS services.', document: doc(allow(['lambda:*', 'logs:*', 'iam:PassRole', 's3:*'])) },
];

export const awsPolicyArn = (p: { path: string; name: string }) => `arn:aws:iam::aws:policy${p.path}${p.name}`;

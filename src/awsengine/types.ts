/** Modelo de la cuenta de AWS simulada (todo es JSON plano: se puede clonar con structuredClone). */

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type Rec = Record<string, unknown>;

export interface Tag {
  Key: string;
  Value: string;
}

// ───────────── IAM ─────────────

export interface PolicyStatement {
  Sid?: string;
  Effect: 'Allow' | 'Deny';
  Action?: string | string[];
  NotAction?: string | string[];
  Resource?: string | string[];
  NotResource?: string | string[];
  Principal?: '*' | { AWS?: string | string[]; Service?: string | string[]; Federated?: string | string[] };
  Condition?: Record<string, Record<string, string | number | boolean | (string | number | boolean)[]>>;
}

export interface PolicyDoc {
  Version?: string;
  Id?: string;
  Statement: PolicyStatement | PolicyStatement[];
}

export interface AccessKey {
  AccessKeyId: string;
  Status: 'Active' | 'Inactive';
  CreateDate: string;
}

export interface IamUser {
  UserName: string;
  UserId: string;
  Arn: string;
  Path: string;
  CreateDate: string;
  groups: string[];
  attached: string[];
  inline: Record<string, PolicyDoc>;
  Tags: Tag[];
  accessKeys: AccessKey[];
  loginProfile: boolean;
  mfa: string[];
  boundary?: string;
}

export interface IamGroup {
  GroupName: string;
  GroupId: string;
  Arn: string;
  Path: string;
  CreateDate: string;
  attached: string[];
  inline: Record<string, PolicyDoc>;
}

export interface IamRole {
  RoleName: string;
  RoleId: string;
  Arn: string;
  Path: string;
  CreateDate: string;
  AssumeRolePolicyDocument: PolicyDoc;
  Description?: string;
  MaxSessionDuration: number;
  attached: string[];
  inline: Record<string, PolicyDoc>;
  Tags: Tag[];
  boundary?: string;
}

export interface ManagedPolicy {
  PolicyName: string;
  PolicyId: string;
  Arn: string;
  Path: string;
  /** Política de AWS (no se puede borrar ni editar). */
  aws: boolean;
  Description?: string;
  CreateDate: string;
  document: PolicyDoc;
  DefaultVersionId: string;
  /** Versiones adicionales (id → documento). */
  versions: Record<string, PolicyDoc>;
}

export interface MfaDevice {
  SerialNumber: string;
  User?: string;
  EnableDate?: string;
}

export interface PasswordPolicy {
  MinimumPasswordLength: number;
  RequireSymbols: boolean;
  RequireNumbers: boolean;
  RequireUppercaseCharacters: boolean;
  RequireLowercaseCharacters: boolean;
  AllowUsersToChangePassword: boolean;
  MaxPasswordAge?: number;
  PasswordReusePrevention?: number;
}

export interface InstanceProfile {
  InstanceProfileName: string;
  InstanceProfileId: string;
  Arn: string;
  Path: string;
  CreateDate: string;
  /** Nombres de los roles (AWS solo permite uno). */
  roles: string[];
}

export interface IamState {
  users: Record<string, IamUser>;
  groups: Record<string, IamGroup>;
  roles: Record<string, IamRole>;
  policies: Record<string, ManagedPolicy>;
  instanceProfiles: Record<string, InstanceProfile>;
  mfaDevices: Record<string, MfaDevice>;
  passwordPolicy?: PasswordPolicy;
  aliases: string[];
  rootMfa: boolean;
  /** Claves de acceso del usuario root (no deberían existir). */
  rootKeys: AccessKey[];
}

// ───────────── S3 ─────────────

export interface S3Version {
  versionId: string;
  deleteMarker: boolean;
  size: number;
  etag: string;
  lastModified: string;
  storageClass: string;
  body: string;
  sse?: string;
  contentType: string;
  tags: Tag[];
  metadata: Record<string, string>;
}

export interface PublicAccessBlock {
  BlockPublicAcls: boolean;
  IgnorePublicAcls: boolean;
  BlockPublicPolicy: boolean;
  RestrictPublicBuckets: boolean;
}

export interface LifecycleRule {
  ID?: string;
  Status: 'Enabled' | 'Disabled';
  Filter?: { Prefix?: string; Tag?: Tag; And?: Rec };
  Prefix?: string;
  Transitions?: { Days?: number; Date?: string; StorageClass: string }[];
  Expiration?: { Days?: number; Date?: string; ExpiredObjectDeleteMarker?: boolean };
  NoncurrentVersionTransitions?: { NoncurrentDays: number; StorageClass: string }[];
  NoncurrentVersionExpiration?: { NoncurrentDays: number };
  AbortIncompleteMultipartUpload?: { DaysAfterInitiation: number };
}

export interface S3Bucket {
  name: string;
  region: string;
  created: string;
  versioning: '' | 'Enabled' | 'Suspended';
  /** Clave → versiones (de la más antigua a la más reciente). */
  objects: Record<string, S3Version[]>;
  policy?: PolicyDoc;
  publicAccessBlock?: PublicAccessBlock;
  /** Cifrado por defecto (siempre hay uno: SSE-S3). */
  encryption: { SSEAlgorithm: string; KMSMasterKeyID?: string; BucketKeyEnabled?: boolean };
  lifecycle?: LifecycleRule[];
  website?: { IndexDocument: { Suffix: string }; ErrorDocument?: { Key: string } };
  tags: Tag[];
  cors?: unknown[];
  logging?: Rec;
  replication?: Rec;
}

export interface S3State {
  buckets: Record<string, S3Bucket>;
  /** Nombres ya usados por otras cuentas (los nombres de bucket son únicos en todo el mundo). */
  taken: string[];
}

// ───────────── EC2 (por región) ─────────────

export interface Ec2Instance {
  InstanceId: string;
  ImageId: string;
  InstanceType: string;
  KeyName?: string;
  LaunchTime: string;
  AvailabilityZone: string;
  SubnetId: string;
  VpcId: string;
  PrivateIpAddress: string;
  PublicIpAddress?: string;
  state: 'pending' | 'running' | 'stopping' | 'stopped' | 'shutting-down' | 'terminated';
  SecurityGroupIds: string[];
  Tags: Tag[];
  rootVolumeId: string;
  UserData?: string;
  Monitoring: 'disabled' | 'enabled';
  IamInstanceProfile?: string;
  Tenancy: 'default' | 'dedicated';
  market: 'on-demand' | 'spot';
  DisableApiTermination: boolean;
  EbsOptimized: boolean;
  /** Reloj virtual (ms) en que acabó el último cambio de estado. */
  stateAt: number;
  ReservationId: string;
}

export interface IpPermission {
  IpProtocol: string;
  FromPort?: number;
  ToPort?: number;
  IpRanges: { CidrIp: string; Description?: string }[];
  Ipv6Ranges: { CidrIpv6: string }[];
  UserIdGroupPairs: { GroupId: string }[];
}

export interface SecurityGroup {
  GroupId: string;
  GroupName: string;
  Description: string;
  VpcId: string;
  IpPermissions: IpPermission[];
  IpPermissionsEgress: IpPermission[];
  Tags: Tag[];
}

export interface Ec2Volume {
  VolumeId: string;
  Size: number;
  VolumeType: string;
  AvailabilityZone: string;
  CreateTime: string;
  state: 'creating' | 'available' | 'in-use' | 'deleting';
  Iops?: number;
  Encrypted: boolean;
  attachment?: { InstanceId: string; Device: string; AttachTime: string; DeleteOnTermination: boolean };
  SnapshotId?: string;
  Tags: Tag[];
}

export interface Ec2Snapshot {
  SnapshotId: string;
  VolumeId: string;
  VolumeSize: number;
  StartTime: string;
  Description: string;
  Encrypted: boolean;
  Tags: Tag[];
}

export interface Ec2Address {
  AllocationId: string;
  PublicIp: string;
  InstanceId?: string;
  AssociationId?: string;
  Tags: Tag[];
}

export interface KeyPair {
  KeyName: string;
  KeyPairId: string;
  KeyFingerprint: string;
  CreateTime: string;
  Tags: Tag[];
}

export interface Subnet {
  Ipv6CidrBlock?: string;
  SubnetId: string;
  VpcId: string;
  CidrBlock: string;
  AvailabilityZone: string;
  MapPublicIpOnLaunch: boolean;
  DefaultForAz: boolean;
  Tags: Tag[];
}

export interface Vpc {
  /** Bloque IPv6 asociado (si lo hay). */
  Ipv6CidrBlock?: string;
  /** CIDR adicionales (IPv4) asociados. */
  ExtraCidrBlocks?: string[];
  VpcId: string;
  CidrBlock: string;
  IsDefault: boolean;
  Tags: Tag[];
  EnableDnsSupport?: boolean;
  EnableDnsHostnames?: boolean;
}

export interface InternetGateway {
  InternetGatewayId: string;
  /** VPC a la que está conectada (una IGW solo puede estar en una). */
  VpcId?: string;
  Tags: Tag[];
}

/** Destino de una ruta: `local`, `igw-…`, `nat-…`, `pcx-…`, `vgw-…`, `tgw-…`… */
export interface Route {
  /** IPv4. Vacío en las rutas IPv6 y en las de listas de prefijos. */
  DestinationCidrBlock: string;
  DestinationIpv6CidrBlock?: string;
  DestinationPrefixListId?: string;
  target: string;
  Origin: 'CreateRouteTable' | 'CreateRoute' | 'EnableVgwRoutePropagation';
}

export interface RouteTable {
  RouteTableId: string;
  VpcId: string;
  routes: Route[];
  associations: { RouteTableAssociationId: string; SubnetId?: string; Main: boolean }[];
  Tags: Tag[];
}

export interface NatGateway {
  NatGatewayId: string;
  SubnetId: string;
  VpcId: string;
  ConnectivityType: 'public' | 'private';
  AllocationId?: string;
  PublicIp?: string;
  PrivateIp: string;
  state: 'pending' | 'available' | 'deleting' | 'deleted';
  CreateTime: string;
  /** Reloj virtual (ms) del último cambio de estado. */
  stateAt: number;
  Tags: Tag[];
}

export interface NaclEntry {
  RuleNumber: number;
  /** `-1` (todos), `6` (tcp), `17` (udp), `1` (icmp). */
  Protocol: string;
  RuleAction: 'allow' | 'deny';
  Egress: boolean;
  CidrBlock: string;
  PortRange?: { From: number; To: number };
}

export interface NetworkAcl {
  NetworkAclId: string;
  VpcId: string;
  IsDefault: boolean;
  Entries: NaclEntry[];
  /** Subredes asociadas. */
  subnets: string[];
  Tags: Tag[];
}

export interface Ec2Region {
  vpcs: Record<string, Vpc>;
  subnets: Record<string, Subnet>;
  instances: Record<string, Ec2Instance>;
  securityGroups: Record<string, SecurityGroup>;
  volumes: Record<string, Ec2Volume>;
  snapshots: Record<string, Ec2Snapshot>;
  addresses: Record<string, Ec2Address>;
  keyPairs: Record<string, KeyPair>;
  internetGateways: Record<string, InternetGateway>;
  routeTables: Record<string, RouteTable>;
  natGateways: Record<string, NatGateway>;
  networkAcls: Record<string, NetworkAcl>;
  peerings?: Record<string, PeeringConn>;
  endpoints?: Record<string, VpcEndpoint>;
  endpointServices?: Record<string, EndpointService>;
  eigws?: Record<string, { EgressOnlyInternetGatewayId: string; VpcId: string; Tags: Tag[] }>;
  cgws?: Record<string, CustomerGateway>;
  vgws?: Record<string, VpnGateway>;
  vpns?: Record<string, VpnConnection>;
  flowLogs?: Record<string, FlowLog>;
  insightsPaths?: Record<string, InsightsPath>;
  insightsAnalyses?: Record<string, InsightsAnalysis>;
}

// ───────────── otros servicios sencillos ─────────────

export interface PeeringConn {
  VpcPeeringConnectionId: string;
  RequesterVpcId: string;
  AccepterVpcId: string;
  Status: 'pending-acceptance' | 'active' | 'rejected' | 'deleted' | 'failed';
  createdAt: number;
  Tags: Tag[];
}

export interface VpcEndpoint {
  VpcEndpointId: string;
  VpcId: string;
  ServiceName: string;
  VpcEndpointType: 'Gateway' | 'Interface' | 'GatewayLoadBalancer';
  State: 'pending' | 'pendingAcceptance' | 'available' | 'deleted';
  RouteTableIds: string[];
  SubnetIds: string[];
  SecurityGroupIds: string[];
  PrivateDnsEnabled: boolean;
  PolicyDocument?: PolicyDoc;
  PrefixListId?: string;
  /** Una IP privada por subred (solo en los de tipo Interface). */
  ips: Record<string, string>;
  createdAt: number;
  Tags: Tag[];
}

export interface EndpointService {
  ServiceId: string;
  ServiceName: string;
  NetworkLoadBalancerArns: string[];
  AcceptanceRequired: boolean;
  AllowedPrincipals: string[];
  Tags: Tag[];
}

export interface CustomerGateway {
  CustomerGatewayId: string;
  BgpAsn: number;
  IpAddress: string;
  Type: string;
  Tags: Tag[];
}

export interface VpnGateway {
  VpnGatewayId: string;
  Type: string;
  AmazonSideAsn: number;
  VpcId?: string;
  /** Tablas de rutas con propagación activada. */
  propagating: string[];
  Tags: Tag[];
}

export interface VpnConnection {
  VpnConnectionId: string;
  CustomerGatewayId: string;
  VpnGatewayId?: string;
  TransitGatewayId?: string;
  Type: string;
  StaticRoutesOnly: boolean;
  routes: string[];
  createdAt: number;
  deleted?: boolean;
  Tags: Tag[];
}

export interface FlowLog {
  FlowLogId: string;
  ResourceId: string;
  TrafficType: 'ACCEPT' | 'REJECT' | 'ALL';
  LogDestinationType: 'cloud-watch-logs' | 's3';
  LogGroupName?: string;
  LogDestination?: string;
  DeliverLogsPermissionArn?: string;
  LogFormat: string;
  MaxAggregationInterval: number;
  CreationTime: string;
  Tags: Tag[];
}

export interface InsightsPath {
  NetworkInsightsPathId: string;
  Source: string;
  Destination?: string;
  DestinationIp?: string;
  Protocol: string;
  DestinationPort?: number;
  CreatedDate: string;
  Tags: Tag[];
}

export interface InsightsAnalysis {
  NetworkInsightsAnalysisId: string;
  NetworkInsightsPathId: string;
  StartDate: string;
  NetworkPathFound: boolean;
  forward: string[];
  explanations: { code: string; component?: string; detail: string }[];
}

export interface Budget {
  BudgetName: string;
  BudgetLimit: { Amount: string; Unit: string };
  TimeUnit: string;
  BudgetType: string;
  notifications: Rec[];
}

export interface Alarm {
  AlarmName: string;
  Namespace: string;
  MetricName: string;
  Statistic: string;
  Period: number;
  EvaluationPeriods: number;
  Threshold: number;
  ComparisonOperator: string;
  AlarmActions: string[];
  Dimensions: Rec[];
  AlarmDescription?: string;
  TreatMissingData?: string;
  StateValue: 'OK' | 'ALARM' | 'INSUFFICIENT_DATA';
}

export interface SnsTopic {
  TopicArn: string;
  subscriptions: { SubscriptionArn: string; Protocol: string; Endpoint: string; confirmed: boolean }[];
  messages: string[];
}

// ───────────── DynamoDB ─────────────

export interface DdbKey {
  AttributeName: string;
  KeyType: 'HASH' | 'RANGE';
}

export interface DdbIndex {
  IndexName: string;
  KeySchema: DdbKey[];
  Projection: { ProjectionType: 'ALL' | 'KEYS_ONLY' | 'INCLUDE'; NonKeyAttributes?: string[] };
  ProvisionedThroughput?: { ReadCapacityUnits: number; WriteCapacityUnits: number };
}

export interface DdbTable {
  TableName: string;
  KeySchema: DdbKey[];
  AttributeDefinitions: { AttributeName: string; AttributeType: 'S' | 'N' | 'B' }[];
  BillingMode: 'PAY_PER_REQUEST' | 'PROVISIONED';
  ProvisionedThroughput?: { ReadCapacityUnits: number; WriteCapacityUnits: number };
  GlobalSecondaryIndexes: DdbIndex[];
  LocalSecondaryIndexes: DdbIndex[];
  ttl?: { AttributeName: string; Enabled: boolean };
  stream?: { StreamEnabled: boolean; StreamViewType?: string };
  /** Clave canónica → elemento (tipado: `{"id": {"S": "1"}}`). */
  items: Record<string, Record<string, unknown>>;
  /** Reloj virtual (ms) de creación y de la orden de borrado. */
  created: number;
  deleting?: number;
  DeletionProtectionEnabled: boolean;
  Tags: Tag[];
}

// ───────────── RDS ─────────────

export interface DbInstance {
  DBInstanceIdentifier: string;
  DBInstanceClass: string;
  Engine: string;
  EngineVersion: string;
  AllocatedStorage: number;
  StorageType: string;
  MasterUsername: string;
  DBName?: string;
  MultiAZ: boolean;
  AvailabilityZone: string;
  SecondaryAvailabilityZone?: string;
  PubliclyAccessible: boolean;
  VpcSecurityGroupIds: string[];
  DBSubnetGroupName: string;
  BackupRetentionPeriod: number;
  StorageEncrypted: boolean;
  DeletionProtection: boolean;
  Port: number;
  InstanceCreateTime: string;
  /** `creating`, `available`, `modifying`, `rebooting`, `backing-up`, `stopping`, `stopped`, `starting`, `deleting`. */
  status: string;
  /** Reloj virtual (ms) del último cambio de estado. */
  stateAt: number;
  ReadReplicaSourceDBInstanceIdentifier?: string;
  DBClusterIdentifier?: string;
  /** Cambios pendientes de aplicar en la ventana de mantenimiento. */
  pending?: Record<string, unknown>;
  Tags: Tag[];
}

export interface DbSnapshot {
  DBSnapshotIdentifier: string;
  DBInstanceIdentifier: string;
  SnapshotCreateTime: string;
  Engine: string;
  EngineVersion: string;
  AllocatedStorage: number;
  MasterUsername: string;
  DBInstanceClass: string;
  StorageType: string;
  Encrypted: boolean;
  SnapshotType: 'manual' | 'automated';
  Port: number;
  status: string;
  stateAt: number;
  Tags: Tag[];
}

export interface DbSubnetGroup {
  DBSubnetGroupName: string;
  DBSubnetGroupDescription: string;
  VpcId: string;
  SubnetIds: string[];
}

export interface DbCluster {
  DBClusterIdentifier: string;
  Engine: string;
  EngineVersion: string;
  MasterUsername: string;
  DatabaseName?: string;
  Port: number;
  status: string;
  stateAt: number;
  members: { id: string; writer: boolean }[];
  DBSubnetGroup: string;
  VpcSecurityGroupIds: string[];
  StorageEncrypted: boolean;
  BackupRetentionPeriod: number;
  DeletionProtection: boolean;
  ClusterCreateTime: string;
  Tags: Tag[];
}

export interface RdsState {
  instances: Record<string, DbInstance>;
  snapshots: Record<string, DbSnapshot>;
  subnetGroups: Record<string, DbSubnetGroup>;
  clusters: Record<string, DbCluster>;
}

export interface RegionalState {
  ec2: Ec2Region;
  alarms: Record<string, Alarm>;
  sns: Record<string, SnsTopic>;
  ddb?: Record<string, DdbTable>;
  rds?: RdsState;
  elb?: ElbState;
  asg?: AsgState;
  tgw?: TgwState;
  logs?: LogsState;
  ssm?: SsmState;
  /** Plantillas de lanzamiento de EC2. */
  launchTemplates?: Record<string, LaunchTemplate>;
}

// ───────────── Elastic Load Balancing ─────────────

export interface LbAction {
  Type: 'forward' | 'redirect' | 'fixed-response';
  Order?: number;
  TargetGroupArn?: string;
  ForwardConfig?: { TargetGroups: { TargetGroupArn: string; Weight?: number }[]; TargetGroupStickinessConfig?: { Enabled?: boolean; DurationSeconds?: number } };
  RedirectConfig?: { Protocol?: string; Port?: string; Host?: string; Path?: string; Query?: string; StatusCode: string };
  FixedResponseConfig?: { StatusCode: string; ContentType?: string; MessageBody?: string };
}

export interface LbCondition {
  Field: string;
  Values?: string[];
  PathPatternConfig?: { Values: string[] };
  HostHeaderConfig?: { Values: string[] };
  HttpRequestMethodConfig?: { Values: string[] };
}

export interface LbRule {
  RuleArn: string;
  Priority: string;
  Conditions: LbCondition[];
  Actions: LbAction[];
  IsDefault: boolean;
}

export interface LbListener {
  ListenerArn: string;
  LoadBalancerArn: string;
  Port: number;
  Protocol: string;
  Certificates?: { CertificateArn: string }[];
  SslPolicy?: string;
  rules: LbRule[];
}

export interface LoadBalancer {
  LoadBalancerArn: string;
  DNSName: string;
  CanonicalHostedZoneId: string;
  LoadBalancerName: string;
  Scheme: 'internet-facing' | 'internal';
  Type: 'application' | 'network' | 'gateway';
  VpcId: string;
  subnetIds: string[];
  SecurityGroups: string[];
  IpAddressType: string;
  attributes: Record<string, string>;
  listeners: Record<string, LbListener>;
  /** Reloj virtual (ms) en que se creó. */
  createdAt: number;
  Tags: Tag[];
  /** Contador de peticiones atendidas (para el reparto por turnos). */
  served: number;
}

export interface TgTarget {
  Id: string;
  Port: number;
  registeredAt: number;
  /** Reloj virtual en que se pidió retirarlo (drenaje de conexiones). */
  deregisteredAt?: number;
  /** Memoria de las comprobaciones de salud: cuánto lleva dando el mismo resultado y qué estado se ha comunicado. */
  hs?: { ok: boolean; since: number; state: 'initial' | 'healthy' | 'unhealthy'; lastEval: number; reason?: string; description?: string };
}

export interface TargetGroup {
  TargetGroupArn: string;
  TargetGroupName: string;
  Protocol: string;
  Port: number;
  VpcId: string;
  TargetType: 'instance' | 'ip' | 'lambda';
  HealthCheckProtocol: string;
  HealthCheckPort: string;
  HealthCheckPath: string;
  HealthCheckIntervalSeconds: number;
  HealthCheckTimeoutSeconds: number;
  HealthyThresholdCount: number;
  UnhealthyThresholdCount: number;
  Matcher: { HttpCode: string };
  targets: TgTarget[];
  attributes: Record<string, string>;
  Tags: Tag[];
}

export interface ElbState {
  lbs: Record<string, LoadBalancer>;
  tgs: Record<string, TargetGroup>;
}

// ───────────── Transit Gateway ─────────────

export interface Tgw {
  TransitGatewayId: string;
  Description: string;
  AmazonSideAsn: number;
  DefaultRouteTableId: string;
  DefaultRouteTableAssociation: boolean;
  DefaultRouteTablePropagation: boolean;
  createdAt: number;
  deleted?: boolean;
  Tags: Tag[];
}

export interface TgwAttachment {
  TransitGatewayAttachmentId: string;
  TransitGatewayId: string;
  ResourceType: 'vpc' | 'vpn';
  ResourceId: string;
  SubnetIds: string[];
  createdAt: number;
  deleted?: boolean;
  Tags: Tag[];
}

export interface TgwRoute {
  DestinationCidrBlock: string;
  Type: 'static' | 'propagated';
  Blackhole: boolean;
  TransitGatewayAttachmentId?: string;
}

export interface TgwRouteTable {
  TransitGatewayRouteTableId: string;
  TransitGatewayId: string;
  Default: boolean;
  routes: TgwRoute[];
  /** Adjuntos asociados (los que consultan esta tabla) y adjuntos que propagan sus rutas a ella. */
  associations: string[];
  propagations: string[];
  Tags: Tag[];
}

export interface TgwState {
  gateways: Record<string, Tgw>;
  attachments: Record<string, TgwAttachment>;
  routeTables: Record<string, TgwRouteTable>;
}

// ───────────── CloudWatch Logs ─────────────

export interface LogEvent {
  timestamp: number;
  message: string;
  ingestionTime: number;
}

export interface LogStream {
  logStreamName: string;
  creationTime: number;
  events: LogEvent[];
}

export interface LogGroup {
  logGroupName: string;
  creationTime: number;
  retentionInDays?: number;
  streams: Record<string, LogStream>;
  tags: Record<string, string>;
}

export interface LogsState {
  groups: Record<string, LogGroup>;
}

// ───────────── Systems Manager ─────────────

export interface SsmCommand {
  CommandId: string;
  InstanceId: string;
  DocumentName: string;
  commands: string[];
  RequestedDateTime: number;
  Status: 'Success' | 'Failed' | 'Pending' | 'InProgress';
  StandardOutputContent: string;
  StandardErrorContent: string;
  ResponseCode: number;
}

export interface SsmSession {
  SessionId: string;
  Target: string;
  Owner: string;
  StartDate: number;
  Status: 'Connected' | 'Terminated';
}

export interface SsmState {
  commands: Record<string, SsmCommand>;
  sessions: Record<string, SsmSession>;
}

// ───────────── Auto Scaling ─────────────

export interface LaunchTemplate {
  LaunchTemplateId: string;
  LaunchTemplateName: string;
  CreateTime: string;
  DefaultVersionNumber: number;
  LatestVersionNumber: number;
  versions: { VersionNumber: number; VersionDescription?: string; LaunchTemplateData: Record<string, any>; CreateTime: string }[];
  Tags: Tag[];
}

export interface ScalingPolicy {
  PolicyName: string;
  PolicyARN: string;
  PolicyType: 'TargetTrackingScaling' | 'SimpleScaling' | 'StepScaling';
  AdjustmentType?: string;
  ScalingAdjustment?: number;
  Cooldown?: number;
  StepAdjustments?: { MetricIntervalLowerBound?: number; MetricIntervalUpperBound?: number; ScalingAdjustment: number }[];
  MetricAggregationType?: string;
  EstimatedInstanceWarmup?: number;
  TargetTrackingConfiguration?: { PredefinedMetricSpecification?: { PredefinedMetricType: string; ResourceLabel?: string }; TargetValue: number; DisableScaleIn?: boolean };
  Enabled: boolean;
}

export interface AsgInstance {
  InstanceId: string;
  AvailabilityZone: string;
  LifecycleState: 'Pending' | 'InService' | 'Terminating' | 'Standby';
  HealthStatus: 'Healthy' | 'Unhealthy';
  /** Reloj virtual en que entró en servicio (o se pidió). */
  since: number;
  ProtectedFromScaleIn: boolean;
}

export interface AsgActivity {
  ActivityId: string;
  Description: string;
  Cause: string;
  StartTime: string;
  EndTime?: string;
  StatusCode: 'Successful' | 'InProgress' | 'Failed';
  StatusMessage?: string;
  Progress: number;
}

export interface Asg {
  AutoScalingGroupName: string;
  AutoScalingGroupARN: string;
  LaunchTemplate: { LaunchTemplateId: string; LaunchTemplateName: string; Version: string };
  MinSize: number;
  MaxSize: number;
  DesiredCapacity: number;
  DefaultCooldown: number;
  AvailabilityZones: string[];
  subnetIds: string[];
  TargetGroupARNs: string[];
  HealthCheckType: 'EC2' | 'ELB';
  HealthCheckGracePeriod: number;
  DefaultInstanceWarmup: number;
  CreatedTime: string;
  Tags: Tag[];
  SuspendedProcesses: string[];
  policies: Record<string, ScalingPolicy>;
  instances: AsgInstance[];
  activities: AsgActivity[];
  /** Último instante (ms de reloj virtual) hasta el que se ha simulado. */
  lastEval: number;
  /** Cuándo se escaló por última vez (para el enfriamiento). */
  lastScale: number;
  /** Minutos seguidos con la métrica por debajo del objetivo (para reducir). */
  lowMinutes: number;
  /** Historial por minuto de lo que vio el grupo. */
  history: { t: number; cpu: number; n: number; rps: number }[];
  /** Acciones programadas (cambian min/max/deseado a una hora). */
  scheduled?: { ScheduledActionName: string; StartTime?: string; Recurrence?: string; MinSize?: number; MaxSize?: number; DesiredCapacity?: number; lastRun?: number }[];
}

export interface AsgState {
  groups: Record<string, Asg>;
}

/** Una prueba de carga (la lanza el comando `ab`): peticiones por segundo contra un balanceador. */
export interface LoadTest {
  lbArn: string;
  region: string;
  rps: number;
  from: number;
  until: number;
}

// ───────────── Route 53 ─────────────

export interface RecordSet {
  Name: string;
  Type: string;
  TTL?: number;
  ResourceRecords?: { Value: string }[];
  AliasTarget?: { HostedZoneId: string; DNSName: string; EvaluateTargetHealth: boolean };
  SetIdentifier?: string;
  Weight?: number;
  Region?: string;
  Failover?: 'PRIMARY' | 'SECONDARY';
  HealthCheckId?: string;
  GeoLocation?: { ContinentCode?: string; CountryCode?: string; SubdivisionCode?: string };
  MultiValueAnswer?: boolean;
}

export interface HostedZone {
  /** `Z0123456789ABC` (sin el prefijo `/hostedzone/`). */
  Id: string;
  /** Con el punto final: `example.com.` */
  Name: string;
  CallerReference: string;
  Comment?: string;
  Private: boolean;
  records: RecordSet[];
}

export interface HealthCheck {
  Id: string;
  CallerReference: string;
  HealthCheckConfig: {
    Type: string;
    IPAddress?: string;
    FullyQualifiedDomainName?: string;
    Port?: number;
    ResourcePath?: string;
    RequestInterval: number;
    FailureThreshold: number;
    Inverted?: boolean;
    Disabled?: boolean;
    ChildHealthChecks?: string[];
    HealthThreshold?: number;
    EnableSNI?: boolean;
    AlarmIdentifier?: { Region: string; Name: string };
  };
  HealthCheckVersion: number;
  Tags: Tag[];
  /** Lo que han visto los comprobadores y lo que Route 53 da por bueno (con retraso). */
  state?: { probe: boolean; reported: boolean; since: number; lastEval: number };
}

export interface Route53State {
  zones: Record<string, HostedZone>;
  healthChecks?: Record<string, HealthCheck>;
}

// ───────────── facturación, organizaciones y soporte ─────────────

export interface BillLine {
  /** Día (`2026-02-14`). */
  date: string;
  /** Nombre del servicio tal como lo muestra Cost Explorer. */
  service: string;
  usageType: string;
  region: string;
  usd: number;
  /** Etiquetas del recurso que generó el gasto. */
  tags: Record<string, string>;
  account: string;
}

export interface BillingState {
  lines: BillLine[];
  /** Claves de etiqueta activadas para la asignación de costes (si no, Cost Explorer no puede agrupar por ellas). */
  activeTags: string[];
}

export interface OrgAccount {
  Id: string;
  Name: string;
  Email: string;
  Status: 'ACTIVE' | 'SUSPENDED' | 'PENDING_CLOSURE';
  JoinedMethod: 'INVITED' | 'CREATED';
  JoinedTimestamp: string;
  ParentId: string;
}

export interface OrgUnit {
  Id: string;
  Name: string;
  ParentId: string;
}

export interface OrgPolicy {
  Id: string;
  Name: string;
  Description: string;
  Type: 'SERVICE_CONTROL_POLICY' | 'TAG_POLICY' | 'BACKUP_POLICY';
  Content: string;
  AwsManaged: boolean;
  targets: string[];
}

export interface Organization {
  Id: string;
  FeatureSet: 'ALL' | 'CONSOLIDATED_BILLING';
  rootId: string;
  units: Record<string, OrgUnit>;
  accounts: Record<string, OrgAccount>;
  policies: Record<string, OrgPolicy>;
  /** Tipos de política activados en la raíz. */
  policyTypes: string[];
}

// ───────────── cuenta ─────────────

/** Credenciales temporales de STS (assume-role, get-session-token). */
export interface AssumedSession {
  AccessKeyId: string;
  /** Rol asumido (ARN) o '' si es get-session-token. */
  roleArn: string;
  roleSessionName: string;
  /** Usuario que la pidió (get-session-token) o ARN de quien asumió el rol. */
  source: string;
  /** Reloj virtual (ms) en que caduca. */
  expires: number;
  /** El usuario usó MFA al pedirla. */
  mfa: boolean;
  /** Política de sesión (opcional) que recorta los permisos. */
  policy?: PolicyDoc;
  tags: Tag[];
}

export interface Account {
  id: string;
  /** Semilla para generar identificadores deterministas. */
  seed: number;
  /** Reloj virtual en ms. */
  clock: number;
  /** IP pública desde la que «llama» el alumno (la usan las condiciones `aws:SourceIp`). */
  sourceIp: string;
  counters: Record<string, number>;
  iam: IamState;
  s3: S3State;
  budgets: Record<string, Budget>;
  regions: Record<string, RegionalState>;
  /** Sesiones temporales vigentes (clave de acceso ASIA… → sesión). */
  sessions: Record<string, AssumedSession>;
  /** Zonas de Route 53 (servicio global). */
  route53?: Route53State;
  /** Historial de gasto (Cost Explorer). */
  billing?: BillingState;
  /** La organización de AWS Organizations (si existe). */
  org?: Organization;
  /** Plan de soporte (por defecto `basic`). */
  supportPlan?: 'basic' | 'developer' | 'business' | 'enterprise';
  /** Pruebas de carga activas o recientes (Auto Scaling y las métricas del balanceador las usan). */
  loads?: LoadTest[];
  /** CloudFront (servicio global). */
  cloudfront?: CloudFrontState;
  /** Global Accelerator (servicio global). */
  accelerators?: Record<string, Accelerator>;
  /** Direct Connect. */
  dx?: DxState;
}

export interface DxState {
  conns: Record<string, { connectionId: string; connectionName: string; location: string; bandwidth: string; createdAt: number }>;
  gws: Record<string, { directConnectGatewayId: string; directConnectGatewayName: string; amazonSideAsn: number }>;
}

// ───────────── CloudFront y Global Accelerator ─────────────

export interface CfOrigin {
  Id: string;
  DomainName: string;
  OriginPath?: string;
  OriginAccessControlId?: string;
  S3?: boolean;
  CustomOriginConfig?: { HTTPPort: number; HTTPSPort: number; OriginProtocolPolicy: string };
}

export interface CfDistribution {
  Id: string;
  ARN: string;
  DomainName: string;
  Status: 'InProgress' | 'Deployed';
  /** Reloj virtual (ms) en que terminó (o terminará) el despliegue. */
  deployedAt: number;
  LastModifiedTime: string;
  Enabled: boolean;
  Comment: string;
  DefaultRootObject: string;
  Origins: CfOrigin[];
  DefaultCacheBehavior: { TargetOriginId: string; ViewerProtocolPolicy: string; MinTTL: number; DefaultTTL: number; MaxTTL: number; Compress: boolean; AllowedMethods: string[] };
  PriceClass: string;
  Aliases: string[];
  ETag: string;
  Tags: Tag[];
  /** Caché de borde: ruta → copia guardada y el instante (ms) en que se guardó. */
  cache: Record<string, { at: number; status: number; type: string; body: string; headers: Record<string, string> }>;
  invalidations: { Id: string; Paths: string[]; CreateTime: string; Status: string }[];
}

export interface CfOac {
  Id: string;
  Name: string;
  OriginAccessControlOriginType: string;
  SigningBehavior: string;
  SigningProtocol: string;
}

export interface CloudFrontState {
  distributions: Record<string, CfDistribution>;
  oacs: Record<string, CfOac>;
}

export interface Accelerator {
  AcceleratorArn: string;
  Name: string;
  IpAddressType: string;
  Enabled: boolean;
  IpSets: { IpFamily: string; IpAddresses: string[] }[];
  DnsName: string;
  Status: 'IN_PROGRESS' | 'DEPLOYED';
  CreatedTime: string;
  listeners: { ListenerArn: string; Protocol: string; PortRanges: { FromPort: number; ToPort: number }[]; endpointGroups: { EndpointGroupArn: string; EndpointGroupRegion: string; EndpointConfigurations: { EndpointId: string; Weight: number }[]; TrafficDialPercentage: number }[] }[];
}

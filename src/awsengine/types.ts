import type { AcmState, KmsState, ShieldState, WafState } from './types-sec';
import type { AasState, ArState, DockerState, EcrState, EcsState, EksState } from './types-containers';
import type { ConfigState, CtState, CwState, LogQuery, MetricFilter, SsmAssociation, SsmAutomation, SsmBaseline, SsmDocument, SsmParam, SsmPatchState, SsmWindow, XrayState } from './types-ops';
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
  /** ARN de la clave de KMS con la que está cifrado (si `sse` es `aws:kms`). */
  ssekmsKeyId?: string;
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
  /** Notificaciones de eventos (hacia Lambda, SQS o SNS). */
  notifications?: S3Notifications;
}

export interface S3NotifyConfig {
  Id?: string;
  Events: string[];
  Filter?: { Key?: { FilterRules: { Name: string; Value: string }[] } };
  LambdaFunctionArn?: string;
  QueueArn?: string;
  TopicArn?: string;
}

export interface S3Notifications {
  LambdaFunctionConfigurations?: S3NotifyConfig[];
  QueueConfigurations?: S3NotifyConfig[];
  TopicConfigurations?: S3NotifyConfig[];
  EventBridgeConfiguration?: Record<string, never>;
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
  /** ARN de la clave de KMS que cifra el volumen. */
  KmsKeyId?: string;
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
  KmsKeyId?: string;
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
  /** Cifrado de EBS por defecto en la región (y la clave que se usa; sin ella, `aws/ebs`). */
  ebsDefault?: { enabled: boolean; keyId?: string };
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
  OKActions?: string[];
  InsufficientDataActions?: string[];
  ActionsEnabled?: boolean;
  DatapointsToAlarm?: number;
  Unit?: string;
  ExtendedStatistic?: string;
  /** Alarma de matemática de métricas: lista de consultas (`Id`, `Expression` o `MetricStat`, `ReturnData`). */
  Metrics?: { Id: string; Expression?: string; MetricStat?: { Metric: { Namespace: string; MetricName: string; Dimensions?: { Name: string; Value: string }[] }; Period: number; Stat: string; Unit?: string }; Label?: string; ReturnData?: boolean; Period?: number }[];
  StateReason?: string;
  StateReasonData?: string;
  StateUpdated?: number;
  ConfigUpdated?: number;
  /** Última vez que se evaluó con datos (para el historial de acciones). */
  tags?: Record<string, string>;
}

export interface SnsSub {
  SubscriptionArn: string;
  Protocol: string;
  Endpoint: string;
  confirmed: boolean;
  /** Atributos: `FilterPolicy`, `RawMessageDelivery`, `RedrivePolicy`… */
  attrs?: Record<string, string>;
}

export interface SnsTopic {
  TopicArn: string;
  subscriptions: SnsSub[];
  messages: string[];
  attrs?: Record<string, string>;
  tags?: Record<string, string>;
}

// ───────────── Amazon SQS ─────────────

export interface SqsMessage {
  MessageId: string;
  Body: string;
  attrs: Record<string, { DataType: string; StringValue?: string; BinaryValue?: string }>;
  /** Reloj virtual (ms). */
  sentAt: number;
  /** No se puede recibir antes de este instante (retraso de entrega). */
  availableAt: number;
  /** Oculto hasta este instante (tiempo de visibilidad). */
  visibleAt: number;
  receiveCount: number;
  receiptHandle?: string;
  firstReceivedAt?: number;
  groupId?: string;
  dedupId?: string;
  /** Si viene de otra cola por redrive: su nombre. */
  deadFrom?: string;
  seq: number;
}

export interface SqsQueue {
  name: string;
  attrs: Record<string, string>;
  messages: SqsMessage[];
  created: number;
  tags: Record<string, string>;
  seq: number;
}

// ───────────── AWS Lambda ─────────────

export interface LambdaVersion {
  Version: string;
  CodeSha256: string;
  CodeSize: number;
  files: Record<string, string>;
  Description: string;
  Runtime: string;
  Handler: string;
  MemorySize: number;
  Timeout: number;
  Environment: Record<string, string>;
  Role: string;
  LastModified: number;
  /** `Active`: la función envía trazas a X-Ray. */
  TracingMode?: 'Active' | 'PassThrough';
  /** Función conectada a una VPC: sus entornos usan interfaces de red en esas subredes. */
  VpcConfig?: { SubnetIds: string[]; SecurityGroupIds: string[]; VpcId: string };
}

export interface LambdaPolicyStatement {
  Sid: string;
  Effect: 'Allow';
  Principal: string | { Service?: string; AWS?: string };
  Action: string;
  Resource: string;
  Condition?: Record<string, Record<string, string>>;
}

export interface LambdaFn extends LambdaVersion {
  FunctionName: string;
  FunctionArn: string;
  /** Versiones publicadas. */
  versions: LambdaVersion[];
  aliases: Record<string, { Name: string; FunctionVersion: string; Description: string; RoutingConfig?: { AdditionalVersionWeights: Record<string, number> }; hits?: number }>;
  policy: LambdaPolicyStatement[];
  reserved?: number;
  /** Concurrencia aprovisionada por versión o alias. */
  provisioned: Record<string, number>;
  deadLetter?: string;
  eventInvoke?: { MaximumRetryAttempts?: number; OnFailure?: string; OnSuccess?: string };
  lastInvoked: number;
  /** Instante en que cambió el código o la configuración (los entornos calientes se descartan). */
  changedAt: number;
  tags: Record<string, string>;
  /** Variables de entorno cifradas con una clave de KMS (opcional, para la zona de seguridad). */
  kmsKeyArn?: string;
}

export interface LambdaEsm {
  UUID: string;
  FunctionArn: string;
  EventSourceArn: string;
  BatchSize: number;
  State: 'Enabled' | 'Disabled';
  FunctionResponseTypes: string[];
  MaximumBatchingWindowInSeconds: number;
  LastModified: number;
  MaximumConcurrency?: number;
  /** Orígenes ordenados (DynamoDB Streams): desde dónde leer, cuántos reintentos lleva el lote atascado y cómo tratarlo. */
  StartingPosition?: string;
  afterSeq?: number;
  failures?: number;
  MaximumRetryAttempts?: number;
  OnFailure?: string;
  BisectBatchOnFunctionError?: boolean;
}

export interface LambdaState {
  functions: Record<string, LambdaFn>;
  esms: Record<string, LambdaEsm>;
}

// ───────────── DynamoDB ─────────────

export interface DdbKey {
  AttributeName: string;
  KeyType: 'HASH' | 'RANGE';
}

export interface DdbBackup {
  BackupArn: string;
  BackupName: string;
  TableName: string;
  BackupCreationDateTime: number;
  /** Copia de la tabla (esquema y elementos) en el momento de la copia. */
  table: DdbTable;
}

export interface DdbIndex {
  IndexName: string;
  KeySchema: DdbKey[];
  Projection: { ProjectionType: 'ALL' | 'KEYS_ONLY' | 'INCLUDE'; NonKeyAttributes?: string[] };
  ProvisionedThroughput?: { ReadCapacityUnits: number; WriteCapacityUnits: number };
}

/** Un registro de DynamoDB Streams. */
export interface DdbStreamRecord {
  eventID: string;
  eventName: 'INSERT' | 'MODIFY' | 'REMOVE';
  eventVersion: string;
  eventSource: string;
  awsRegion: string;
  dynamodb: {
    ApproximateCreationDateTime: number;
    Keys: Record<string, unknown>;
    NewImage?: Record<string, unknown>;
    OldImage?: Record<string, unknown>;
    SequenceNumber: string;
    SizeBytes: number;
    StreamViewType: string;
  };
  userIdentity?: { type: string; principalId: string };
}

/** Un cambio guardado para la recuperación a un momento dado (PITR). */
export interface DdbChange {
  at: number;
  k: string;
  next?: Record<string, unknown>;
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
  stream?: { StreamEnabled: boolean; StreamViewType?: string; label?: string; seq?: number; records?: DdbStreamRecord[] };
  /** Regiones donde hay réplica de esta tabla (tablas globales). */
  replicas?: string[];
  /** Si esta tabla es una réplica: región de la tabla original. */
  globalOrigin?: string;
  /** Recuperación a un momento dado: estado base al activarla y cambios desde entonces. */
  pitr?: { since: number; base: Record<string, Record<string, unknown>>; log: DdbChange[] };
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
  /** Contraseña del usuario maestro (solo la usa el simulador para comprobar secretos y proxies). */
  pw?: string;
  /** Grupo de parámetros y valores que la instancia tiene ya aplicados (los estáticos necesitan reinicio). */
  paramGroup?: string;
  applied?: Record<string, string>;
  /** Tablas de ejemplo de la base de datos (las usa DMS al migrar). */
  tables?: { schema: string; name: string; rows: number }[];
  Tags: Tag[];
}

export interface DbParamGroup {
  name: string;
  family: string;
  description: string;
  params: Record<string, { value: string; apply: 'immediate' | 'pending-reboot' }>;
}

export interface DbProxy {
  name: string;
  arn: string;
  engineFamily: string;
  roleArn: string;
  secretArns: string[];
  subnetIds: string[];
  sgIds: string[];
  vpcId: string;
  requireTls: boolean;
  idleTimeout: number;
  status: 'creating' | 'available' | 'deleting';
  stateAt: number;
  created: number;
  targets: { type: 'RDS_INSTANCE' | 'TRACKED_CLUSTER'; id: string }[];
  pool: { MaxConnectionsPercent: number; MaxIdleConnectionsPercent: number; ConnectionBorrowTimeout: number };
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
  /** Aurora Serverless v2: capacidad mínima y máxima en ACU. */
  scaling?: { MinCapacity: number; MaxCapacity: number };
  pw?: string;
  Tags: Tag[];
}

export interface RdsState {
  instances: Record<string, DbInstance>;
  snapshots: Record<string, DbSnapshot>;
  subnetGroups: Record<string, DbSubnetGroup>;
  clusters: Record<string, DbCluster>;
  paramGroups?: Record<string, DbParamGroup>;
  proxies?: Record<string, DbProxy>;
}

// ───────────── Migración: DMS y DataSync ─────────────

export interface DmsInstance {
  id: string;
  arn: string;
  cls: string;
  storage: number;
  sgIds: string[];
  subnetGroup: string;
  multiAz: boolean;
  publiclyAccessible: boolean;
  vpcId: string;
  az: string;
  status: 'creating' | 'available' | 'deleting';
  stateAt: number;
  created: number;
}

export interface DmsEndpoint {
  id: string;
  arn: string;
  type: 'source' | 'target';
  engine: string;
  server?: string;
  port?: number;
  username?: string;
  password?: string;
  database?: string;
  s3?: { BucketName: string; ServiceAccessRoleArn: string; BucketFolder?: string };
  ddbRole?: string;
  created: number;
}

export interface DmsConnection {
  instArn: string;
  endpointArn: string;
  status: 'testing' | 'successful' | 'failed';
  failure?: string;
  at: number;
}

export interface DmsTask {
  id: string;
  arn: string;
  type: 'full-load' | 'cdc' | 'full-load-and-cdc';
  sourceArn: string;
  targetArn: string;
  instArn: string;
  mappings: string;
  status: 'ready' | 'starting' | 'running' | 'stopped' | 'failed' | 'deleting';
  stateAt: number;
  startedAt?: number;
  stopReason?: string;
  lastFailure?: string;
  tables: { schema: string; table: string; rows: number }[];
  loaded?: boolean;
  created: number;
}

export interface DmsState {
  subnetGroups: Record<string, { id: string; description: string; vpcId: string; subnetIds: string[] }>;
  instances: Record<string, DmsInstance>;
  endpoints: Record<string, DmsEndpoint>;
  connections: DmsConnection[];
  tasks: Record<string, DmsTask>;
}

export interface DsLocation {
  arn: string;
  kind: 's3' | 'nfs';
  /** `s3://bucket/prefix` o `nfs://servidor/ruta`. */
  uri: string;
  bucket?: string;
  prefix?: string;
  roleArn?: string;
  agentArns?: string[];
  server?: string;
  subdir?: string;
}

export interface DsTask {
  arn: string;
  name: string;
  src: string;
  dst: string;
  options: Record<string, string>;
  includes: string[];
  excludes: string[];
  schedule?: string;
}

export interface DsExecution {
  arn: string;
  taskArn: string;
  startedAt: number;
  status: 'LAUNCHING' | 'PREPARING' | 'TRANSFERRING' | 'VERIFYING' | 'SUCCESS' | 'ERROR';
  files: number;
  bytes: number;
  error?: string;
}

export interface DataSyncState {
  agents: Record<string, { arn: string; name: string; status: 'ONLINE' | 'OFFLINE' }>;
  locations: Record<string, DsLocation>;
  tasks: Record<string, DsTask>;
  executions: Record<string, DsExecution>;
}

// ───────────── ElastiCache ─────────────

export interface CacheNode {
  id: string;
  az: string;
  role: 'primary' | 'replica';
}

export interface CacheGroup {
  id: string;
  description: string;
  engine: 'redis' | 'valkey';
  engineVersion: string;
  nodeType: string;
  status: 'creating' | 'available' | 'modifying' | 'deleting';
  stateAt: number;
  /** Fragmentos (con el modo clúster desactivado hay uno solo). */
  shards: { id: string; nodes: CacheNode[] }[];
  clusterMode: boolean;
  automaticFailover: boolean;
  multiAz: boolean;
  subnetGroup: string;
  sgIds: string[];
  atRest: boolean;
  transit: boolean;
  authToken?: string;
  port: number;
  created: number;
  Tags: Tag[];
}

export interface CacheCluster {
  id: string;
  engine: 'memcached' | 'redis';
  nodeType: string;
  numNodes: number;
  status: 'creating' | 'available' | 'modifying' | 'deleting';
  stateAt: number;
  az: string;
  subnetGroup: string;
  sgIds: string[];
  port: number;
  created: number;
  Tags: Tag[];
}

export interface CacheSubnetGroup {
  name: string;
  description: string;
  vpcId: string;
  subnetIds: string[];
}

export interface CacheState {
  groups: Record<string, CacheGroup>;
  clusters: Record<string, CacheCluster>;
  subnetGroups: Record<string, CacheSubnetGroup>;
  /** Contenido de cada almacén (un grupo de replicación = un almacén): clave → valor con caducidad. */
  data: Record<string, Record<string, { t: 's' | 'h' | 'l' | 'set'; v: unknown; exp?: number }>>;
}

export interface Secret {
  Name: string;
  ARN: string;
  Description: string;
  created: number;
  /** Versiones: la más reciente es AWSCURRENT y la anterior AWSPREVIOUS. */
  versions: { id: string; value: string; binary?: boolean; created: number; stages: string[]; /** reservada para una rotación, aún sin valor */ empty?: boolean }[];
  deletedAt?: number;
  recoveryDays?: number;
  Tags: Tag[];
  /** Clave de KMS (ARN) que cifra el secreto; sin ella, la administrada `aws/secretsmanager`. */
  KmsKeyId?: string;
  /** Política de recurso (JSON). */
  policy?: string;
  rotation?: { lambda: string; days: number; enabled: boolean; last?: number; next?: number };
}

export interface RegionalState {
  ec2: Ec2Region;
  alarms: Record<string, Alarm>;
  sns: Record<string, SnsTopic>;
  ddb?: Record<string, DdbTable>;
  ddbBackups?: Record<string, DdbBackup>;
  secrets?: Record<string, Secret>;
  elasticache?: CacheState;
  dms?: DmsState;
  datasync?: DataSyncState;
  cfn?: CfnState;
  cicd?: CicdState;
  rds?: RdsState;
  elb?: ElbState;
  asg?: AsgState;
  tgw?: TgwState;
  logs?: LogsState;
  ssm?: SsmState;
  sqs?: Record<string, SqsQueue>;
  lambda?: LambdaState;
  events?: EventsState;
  sfn?: SfnState;
  apigw?: ApiGwState;
  cognito?: CognitoState;
  ecr?: EcrState;
  ecs?: EcsState;
  aas?: AasState;
  apprunner?: ArState;
  eks?: EksState;
  cw?: CwState;
  config?: ConfigState;
  xray?: XrayState;
  kms?: KmsState;
  acm?: AcmState;
  wafv2?: WafState;
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
  metricFilters?: Record<string, MetricFilter>;
  kmsKeyId?: string;
}

export interface LogsState {
  groups: Record<string, LogGroup>;
  queries?: Record<string, LogQuery>;
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
  params?: Record<string, SsmParam>;
  baselines?: Record<string, SsmBaseline>;
  /** Grupo de parches por defecto de la región (id de la línea base). */
  defaultBaseline?: Record<string, string>;
  patchStates?: Record<string, SsmPatchState>;
  documents?: Record<string, SsmDocument>;
  windows?: Record<string, SsmWindow>;
  assocs?: Record<string, SsmAssociation>;
  automations?: Record<string, SsmAutomation>;
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
  /** Recursos compartidos de la «oficina» (NFS): `servidor:/ruta` → archivos (ruta relativa → contenido). Los lee DataSync. */
  onpremShares?: Record<string, Record<string, string>>;
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
  /** AWS Shield (servicio global). */
  shield?: ShieldState;
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
  /** Docker del ordenador del alumno (imágenes locales y contenedores). */
  docker?: DockerState;
  /** CloudTrail: historial de eventos de la cuenta y trails. */
  ct?: CtState;
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
  /** ARN de la ACL web (ámbito CLOUDFRONT) que protege la distribución. */
  WebACLId?: string;
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

// ───────────── Amazon EventBridge ─────────────

export interface EventTarget {
  Id: string;
  Arn: string;
  Input?: string;
  InputPath?: string;
  InputTransformer?: { InputPathsMap?: Record<string, string>; InputTemplate: string };
  RoleArn?: string;
  RunCommandParameters?: { RunCommandTargets: { Key: string; Values: string[] }[] };
}

export interface EventRule {
  Name: string;
  EventBusName: string;
  Description?: string;
  EventPattern?: string;
  ScheduleExpression?: string;
  State: 'ENABLED' | 'DISABLED';
  targets: EventTarget[];
  /** Último instante (ms, reloj virtual) hasta el que se han procesado las programaciones. */
  checkedAt: number;
}

export interface EventsState {
  buses: Record<string, { name: string; rules: Record<string, EventRule> }>;
  /** Eventos recibidos (para depurar: `aws events`… no los lista; lo usan los tests). */
  log: { id: string; time: number; source: string; detailType: string; matched: string[] }[];
}

// ───────────── AWS Step Functions ─────────────

export interface SfnEvent {
  id: number;
  timestamp: number;
  type: string;
  previousEventId: number;
  details?: Record<string, unknown>;
}

export interface SfnExecution {
  name: string;
  stateMachineArn: string;
  input: string;
  startDate: number;
  stopDate: number;
  status: 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT' | 'ABORTED';
  output?: string;
  error?: string;
  cause?: string;
  events: SfnEvent[];
}

export interface SfnMachine {
  name: string;
  arn: string;
  definition: string;
  roleArn: string;
  type: 'STANDARD' | 'EXPRESS';
  creationDate: number;
  executions: Record<string, SfnExecution>;
}

export interface SfnState {
  machines: Record<string, SfnMachine>;
}

// ───────────── Amazon API Gateway (HTTP API) ─────────────

export interface ApiRoute {
  RouteId: string;
  RouteKey: string;
  Target?: string;
  AuthorizationType: 'NONE' | 'JWT' | 'AWS_IAM';
  AuthorizerId?: string;
}

export interface ApiIntegration {
  IntegrationId: string;
  IntegrationType: string;
  IntegrationUri: string;
  PayloadFormatVersion: string;
  IntegrationMethod?: string;
}

export interface ApiAuthorizer {
  AuthorizerId: string;
  Name: string;
  AuthorizerType: 'JWT';
  IdentitySource: string[];
  JwtConfiguration: { Audience: string[]; Issuer: string };
}

export interface ApiStage {
  StageName: string;
  AutoDeploy: boolean;
  /** Hay un despliegue activo (con `AutoDeploy` siempre; si no, tras `create-deployment`). */
  Deployed: boolean;
  ThrottlingBurstLimit?: number;
  ThrottlingRateLimit?: number;
}

export interface ApiGw {
  ApiId: string;
  Name: string;
  ProtocolType: 'HTTP';
  CreatedDate: number;
  routes: Record<string, ApiRoute>;
  integrations: Record<string, ApiIntegration>;
  authorizers: Record<string, ApiAuthorizer>;
  stages: Record<string, ApiStage>;
  cors?: Record<string, unknown>;
}

export interface ApiGwState {
  apis: Record<string, ApiGw>;
}

// ───────────── Amazon Cognito (grupos de usuarios) ─────────────

export interface CognitoUser {
  Username: string;
  sub: string;
  attrs: Record<string, string>;
  password: string;
  status: 'UNCONFIRMED' | 'CONFIRMED' | 'FORCE_CHANGE_PASSWORD';
  enabled: boolean;
  created: number;
  groups: string[];
}

export interface CognitoClient {
  ClientId: string;
  ClientName: string;
  ExplicitAuthFlows: string[];
  GenerateSecret: boolean;
}

export interface CognitoPool {
  Id: string;
  Name: string;
  created: number;
  usernameAttributes: string[];
  autoVerified: string[];
  passwordPolicy: { MinimumLength: number; RequireUppercase: boolean; RequireLowercase: boolean; RequireNumbers: boolean; RequireSymbols: boolean };
  users: Record<string, CognitoUser>;
  clients: Record<string, CognitoClient>;
  groups: Record<string, { GroupName: string; Description: string }>;
}

export interface CognitoState {
  pools: Record<string, CognitoPool>;
}

// ───────────────────────── CloudFormation (Z12) ─────────────────────────

export interface CfnResource {
  logicalId: string;
  type: string;
  physicalId: string;
  /** Propiedades ya resueltas (sin funciones intrínsecas) con las que se creó o actualizó. */
  props: Rec;
  attrs: Record<string, string>;
  deletionPolicy?: string;
  /** El nombre físico lo generó CloudFormation (si no, lo puso el usuario). */
  autoNamed: boolean;
  /** `DELETE_FAILED` u otro estado que no viene de los eventos. */
  stuck?: string;
}

export interface CfnEvent {
  id: string;
  at: number;
  logicalId: string;
  physicalId?: string;
  type: string;
  status: string;
  reason?: string;
}

export interface CfnOutput {
  Key: string;
  Value: string;
  Description?: string;
  ExportName?: string;
}

export interface CfnStack {
  id: string;
  name: string;
  /** Plantilla ya procesada (con las transformaciones aplicadas) y el texto original. */
  template: Rec;
  originalText: string;
  originalIsJson: boolean;
  params: Record<string, string>;
  caps: string[];
  tags: { Key: string; Value: string }[];
  resources: Record<string, CfnResource>;
  outputs: CfnOutput[];
  events: CfnEvent[];
  created: number;
  updated?: number;
  deleted?: number;
  termProtection: boolean;
  disableRollback: boolean;
  onFailure?: string;
  roleArn?: string;
  description?: string;
  /** Si es una instancia de un conjunto de pilas. */
  stackSet?: string;
  drift?: { status: string; at: number; detectionId: string; items: CfnDriftItem[] };
  /** Estado «bloqueado» (REVIEW_IN_PROGRESS de los conjuntos de cambios de tipo CREATE). */
  review?: boolean;
  changeSets: string[];
}

export interface CfnDriftItem {
  logicalId: string;
  physicalId: string;
  type: string;
  status: 'IN_SYNC' | 'MODIFIED' | 'DELETED';
  expected: Rec;
  actual: Rec;
  differences: { PropertyPath: string; ExpectedValue: string; ActualValue: string; DifferenceType: 'NOT_EQUAL' | 'ADD' | 'REMOVE' }[];
}

export interface CfnChange {
  Action: 'Add' | 'Modify' | 'Remove';
  LogicalResourceId: string;
  PhysicalResourceId?: string;
  ResourceType: string;
  Replacement?: 'True' | 'False' | 'Conditional';
  Scope: string[];
  Details: { Target: { Attribute: string; Name?: string; RequiresRecreation: string }; Evaluation: string; ChangeSource: string }[];
}

export interface CfnChangeSet {
  id: string;
  name: string;
  stackId: string;
  stackName: string;
  type: 'CREATE' | 'UPDATE';
  templateText: string;
  templateIsJson: boolean;
  params: Record<string, string>;
  caps: string[];
  changes: CfnChange[];
  created: number;
  status: 'CREATE_COMPLETE' | 'FAILED' | 'DELETE_COMPLETE';
  statusReason?: string;
  execution: 'AVAILABLE' | 'UNAVAILABLE' | 'EXECUTE_COMPLETE' | 'EXECUTE_FAILED' | 'OBSOLETE';
  description?: string;
}

export interface CfnStackSet {
  id: string;
  name: string;
  templateText: string;
  templateIsJson: boolean;
  params: Record<string, string>;
  caps: string[];
  adminRole?: string;
  execRole: string;
  status: 'ACTIVE' | 'DELETED';
  /** `region` → id de la pila creada. */
  instances: Record<string, { account: string; region: string; stackId: string }>;
  operations: { id: string; action: string; at: number; status: string }[];
  description?: string;
}

export interface CfnState {
  stacks: Record<string, CfnStack>;
  changeSets: Record<string, CfnChangeSet>;
  stackSets: Record<string, CfnStackSet>;
}

// ───────────────────────── CI/CD (Z12) ─────────────────────────

export interface CbProject {
  name: string;
  arn: string;
  serviceRole: string;
  source: { type: string; location?: string; buildspec?: string };
  environment: { image: string; computeType: string; type?: string; environmentVariables?: { name: string; value: string }[] };
  artifacts: { type: string; location?: string; packaging?: string; name?: string };
  created: number;
  timeoutInMinutes: number;
  description?: string;
  artifactPath?: string;
}

export interface CbBuild {
  id: string;
  arn: string;
  project: string;
  startedAt: number;
  endsAt: number;
  status: 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'STOPPED';
  phases: { phaseType: string; status: string; secs: number; start: number; end: number }[];
  logs: string[];
  sourceVersion?: string;
  artifacts: Record<string, string>;
  failedPhase?: string;
  reason?: string;
  initiator?: string;
}

export interface CpAction {
  name: string;
  category: 'Source' | 'Build' | 'Test' | 'Deploy' | 'Approval' | 'Invoke';
  provider: string;
  config: Record<string, string>;
  inputs: string[];
  outputs: string[];
  runOrder: number;
}

export interface CpStage {
  name: string;
  actions: CpAction[];
}

export interface CpExecution {
  id: string;
  pipeline: string;
  startedAt: number;
  status: 'InProgress' | 'Succeeded' | 'Failed' | 'Stopped';
  trigger: string;
  /** Resultado de cada acción, en el orden de ejecución. */
  actions: { stage: string; action: string; status: 'InProgress' | 'Succeeded' | 'Failed' | 'Abandoned'; startedAt: number; endsAt: number; summary?: string; token?: string; externalId?: string; code?: string; depId?: string }[];
  artifacts: Record<string, Record<string, string>>;
  sourceRevision?: string;
  /** Pausa en una aprobación manual: dónde continuar. */
  resume?: { stage: number; action: number };
  stopped?: boolean;
  /** Cuenta atrás del retraso de la última acción (para el estado). */
  lastEnd?: number;
}

export interface CpPipeline {
  name: string;
  arn: string;
  roleArn: string;
  artifactBucket: string;
  stages: CpStage[];
  version: number;
  created: number;
  updated: number;
  executions: CpExecution[];
  /** Pasos aprobados en las acciones manuales: token → resultado. */
  approvals: Record<string, { status: 'Approved' | 'Rejected'; summary: string }>;
  /** Última versión vista de cada origen de S3 (para disparar ejecuciones al cambiar). */
  lastSource: Record<string, string>;
}

export interface CdDeployment {
  id: string;
  application: string;
  group: string;
  startedAt: number;
  status: 'Created' | 'InProgress' | 'Succeeded' | 'Failed' | 'Stopped';
  config: string;
  /** Despliegue de Lambda: alias y versiones (o de EC2: instancias). */
  alias?: string;
  from?: string;
  to?: string;
  steps: { at: number; weight: number }[];
  hooks: { name: string; fn: string; ok?: boolean }[];
  error?: string;
  revision: string;
}

export interface CdState {
  apps: Record<string, { name: string; platform: string; groups: Record<string, { name: string; serviceRole: string; config: string; targetFn?: string; alias?: string; alarms?: string[]; autoRollback: boolean }> }>;
  deployments: Record<string, CdDeployment>;
}

export interface CicdState {
  projects: Record<string, CbProject>;
  builds: Record<string, CbBuild>;
  pipelines: Record<string, CpPipeline>;
  cd: CdState;
}

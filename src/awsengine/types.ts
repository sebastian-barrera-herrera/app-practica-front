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
  SubnetId: string;
  VpcId: string;
  CidrBlock: string;
  AvailabilityZone: string;
  MapPublicIpOnLaunch: boolean;
  DefaultForAz: boolean;
  Tags: Tag[];
}

export interface Vpc {
  VpcId: string;
  CidrBlock: string;
  IsDefault: boolean;
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
}

// ───────────── otros servicios sencillos ─────────────

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

export interface RegionalState {
  ec2: Ec2Region;
  alarms: Record<string, Alarm>;
  sns: Record<string, SnsTopic>;
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
}

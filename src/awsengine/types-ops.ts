/** Tipos de la zona «Observabilidad y operaciones» (Z14): CloudWatch, Logs Insights, CloudTrail, Config, Systems Manager y X-Ray. */

// ───────────────────────── CloudWatch ─────────────────────────

/** Una muestra de una métrica: un `put-metric-data` (o varias agrupadas). */
export interface CwSample {
  t: number;
  sum: number;
  n: number;
  min: number;
  max: number;
}

export interface CwMetric {
  ns: string;
  name: string;
  dims: Record<string, string>;
  unit?: string;
  samples: CwSample[];
}

export interface CwDashboard {
  name: string;
  body: string;
  modified: number;
}

export interface CwComposite {
  AlarmName: string;
  AlarmRule: string;
  AlarmDescription?: string;
  AlarmActions: string[];
  OKActions: string[];
  InsufficientDataActions: string[];
  ActionsEnabled: boolean;
  StateValue: 'OK' | 'ALARM' | 'INSUFFICIENT_DATA';
  StateReason: string;
  StateUpdated: number;
  created: number;
}

export interface CwHistory {
  alarm: string;
  type: 'MetricAlarm' | 'CompositeAlarm';
  t: number;
  item: 'ConfigurationUpdate' | 'StateUpdate' | 'Action';
  summary: string;
  data: string;
}

export interface CwState {
  metrics: Record<string, CwMetric>;
  dashboards: Record<string, CwDashboard>;
  composites: Record<string, CwComposite>;
  history: CwHistory[];
}

// ───────────────────────── Logs ─────────────────────────

export interface MetricTransformation {
  metricName: string;
  metricNamespace: string;
  metricValue: string;
  defaultValue?: number;
  unit?: string;
  dimensions?: Record<string, string>;
}

export interface MetricFilter {
  filterName: string;
  filterPattern: string;
  logGroupName: string;
  creationTime: number;
  metricTransformations: MetricTransformation[];
}

export interface LogQuery {
  queryId: string;
  logGroups: string[];
  queryString: string;
  start: number;
  end: number;
  limit: number;
  createdAt: number;
  completesAt: number;
  cancelled?: boolean;
  /** Resultado ya calculado (filas de pares campo/valor) y estadísticas. */
  results?: { field: string; value: string }[][];
  stats?: { recordsMatched: number; recordsScanned: number; bytesScanned: number };
  error?: string;
}

// ───────────────────────── CloudTrail ─────────────────────────

export interface CtEvent {
  id: string;
  t: number;
  region: string;
  source: string;
  name: string;
  readOnly: boolean;
  user: string;
  accessKeyId?: string;
  resources: { type: string; name: string }[];
  /** Registro completo (el contenido de `CloudTrailEvent`). */
  record: Record<string, unknown>;
  /** Evento de datos (objetos de S3, invocaciones de Lambda…) y no de gestión. */
  data?: boolean;
}

export interface CtSelector {
  ReadWriteType: 'All' | 'ReadOnly' | 'WriteOnly';
  IncludeManagementEvents: boolean;
  DataResources: { Type: string; Values: string[] }[];
}

export interface CtTrail {
  Name: string;
  TrailARN: string;
  S3BucketName: string;
  S3KeyPrefix?: string;
  IncludeGlobalServiceEvents: boolean;
  IsMultiRegionTrail: boolean;
  HomeRegion: string;
  LogFileValidationEnabled: boolean;
  KmsKeyId?: string;
  CloudWatchLogsLogGroupArn?: string;
  CloudWatchLogsRoleArn?: string;
  SnsTopicName?: string;
  logging: boolean;
  startLoggingTime?: number;
  stopLoggingTime?: number;
  latestDeliveryTime?: number;
  latestDeliveryError?: string;
  latestCloudWatchLogsDeliveryTime?: number;
  /** Eventos pendientes de entregar a S3 (se vuelcan cada 5 minutos). */
  pending: string[];
  selectors: CtSelector[];
  insightSelectors?: { InsightType: string }[];
  tags: Record<string, string>;
  created: number;
}

export interface CtState {
  events: CtEvent[];
  /** Trails por nombre (clave: región de origen + nombre). */
  trails: Record<string, CtTrail>;
  seq: number;
}

// ───────────────────────── AWS Config ─────────────────────────

export interface ConfigRecorder {
  name: string;
  roleARN: string;
  recordingGroup: { allSupported: boolean; includeGlobalResourceTypes: boolean; resourceTypes: string[] };
  recording: boolean;
  lastStartTime?: number;
  lastStopTime?: number;
  lastStatus: 'Pending' | 'Success' | 'Failure';
}

export interface ConfigDelivery {
  name: string;
  s3BucketName: string;
  s3KeyPrefix?: string;
  snsTopicARN?: string;
  frequency?: string;
}

export interface ConfigRule {
  ConfigRuleName: string;
  ConfigRuleArn: string;
  ConfigRuleId: string;
  Description?: string;
  Source: { Owner: 'AWS' | 'CUSTOM_LAMBDA'; SourceIdentifier: string; SourceDetails?: unknown[] };
  InputParameters: string;
  Scope?: { ComplianceResourceTypes?: string[]; TagKey?: string; TagValue?: string };
  MaximumExecutionFrequency?: string;
  ConfigRuleState: 'ACTIVE' | 'DELETING' | 'EVALUATING';
  created: number;
}

export interface ConfigEvaluation {
  rule: string;
  resourceType: string;
  resourceId: string;
  compliance: 'COMPLIANT' | 'NON_COMPLIANT' | 'NOT_APPLICABLE';
  annotation?: string;
  at: number;
}

export interface ConfigItem {
  resourceType: string;
  resourceId: string;
  resourceName?: string;
  arn: string;
  at: number;
  /** Instantánea de la configuración (JSON). */
  config: string;
  status: 'ResourceDiscovered' | 'OK' | 'ResourceDeleted';
  region: string;
}

export interface ConfigRemediation {
  ConfigRuleName: string;
  TargetType: 'SSM_DOCUMENT';
  TargetId: string;
  TargetVersion?: string;
  Parameters: Record<string, { ResourceValue?: { Value: string }; StaticValue?: { Values: string[] } }>;
  ResourceType?: string;
  Automatic: boolean;
  MaximumAutomaticAttempts: number;
  RetryAttemptSeconds: number;
  Arn: string;
}

export interface ConfigState {
  recorder?: ConfigRecorder;
  delivery?: ConfigDelivery;
  rules: Record<string, ConfigRule>;
  evals: ConfigEvaluation[];
  history: ConfigItem[];
  remediations: Record<string, ConfigRemediation>;
  /** Huella de la última instantánea (para detectar cambios). */
  last: Record<string, string>;
  checkedAt: number;
}

// ───────────────────────── Systems Manager ─────────────────────────

export interface SsmParam {
  Name: string;
  Type: 'String' | 'StringList' | 'SecureString';
  Value: string;
  Description?: string;
  KeyId?: string;
  Tier: 'Standard' | 'Advanced' | 'Intelligent-Tiering';
  DataType: string;
  AllowedPattern?: string;
  Version: number;
  modified: number;
  modifiedBy: string;
  history: { Version: number; Value: string; modified: number; modifiedBy: string; Labels: string[]; Description?: string; KeyId?: string; Tier: string; Type: string }[];
  tags: Record<string, string>;
}

export interface SsmBaseline {
  BaselineId: string;
  Name: string;
  OperatingSystem: string;
  Description?: string;
  ApprovalRules: { PatchRules: { PatchFilterGroup: { PatchFilters: { Key: string; Values: string[] }[] }; ComplianceLevel?: string; ApproveAfterDays?: number; EnableNonSecurity?: boolean }[] };
  ApprovedPatches: string[];
  RejectedPatches: string[];
  DefaultBaseline: boolean;
  created: number;
  groups: string[];
}

export interface SsmPatchState {
  InstanceId: string;
  PatchGroup: string;
  BaselineId: string;
  OperationType: 'Scan' | 'Install';
  OperationStartTime: number;
  OperationEndTime: number;
  InstalledCount: number;
  MissingCount: number;
  FailedCount: number;
  InstalledOtherCount: number;
  RebootOption: string;
  installed: string[];
}

export interface SsmDocument {
  Name: string;
  DocumentType: 'Command' | 'Automation' | 'Session' | 'Policy';
  Content: string;
  DocumentFormat: 'JSON' | 'YAML';
  DocumentVersion: number;
  Owner: string;
  created: number;
  Description?: string;
  tags: Record<string, string>;
}

export interface SsmWindow {
  WindowId: string;
  Name: string;
  Schedule: string;
  Duration: number;
  Cutoff: number;
  Enabled: boolean;
  AllowUnassociatedTargets: boolean;
  targets: { WindowTargetId: string; ResourceType: string; Targets: { Key: string; Values: string[] }[]; Name?: string }[];
  tasks: { WindowTaskId: string; TaskArn: string; TaskType: string; Targets: { Key: string; Values: string[] }[]; TaskParameters?: unknown; Priority: number; MaxConcurrency?: string; MaxErrors?: string; Name?: string; ServiceRoleArn?: string; TaskInvocationParameters?: unknown }[];
  executions: { WindowExecutionId: string; Status: 'SUCCESS' | 'FAILED' | 'IN_PROGRESS'; StartTime: number; EndTime: number; tasks: { TaskExecutionId: string; TaskArn: string; Status: string; commandId?: string }[] }[];
  checkedAt: number;
  created: number;
}

export interface SsmAssociation {
  AssociationId: string;
  Name: string;
  Targets: { Key: string; Values: string[] }[];
  ScheduleExpression?: string;
  Parameters: Record<string, string[]>;
  AssociationName?: string;
  created: number;
  lastExecution?: number;
  status: 'Pending' | 'Success' | 'Failed';
  checkedAt: number;
}

export interface SsmAutomationStep {
  StepName: string;
  Action: string;
  StepStatus: 'Pending' | 'InProgress' | 'Success' | 'Failed' | 'Cancelled';
  StartTime: number;
  EndTime: number;
  Outputs: Record<string, string[]>;
  FailureMessage?: string;
}

export interface SsmAutomation {
  AutomationExecutionId: string;
  DocumentName: string;
  DocumentVersion: string;
  Status: 'Pending' | 'InProgress' | 'Success' | 'Failed' | 'Cancelled';
  StartTime: number;
  EndTime: number;
  Parameters: Record<string, string[]>;
  Outputs: Record<string, string[]>;
  Steps: SsmAutomationStep[];
  ExecutedBy: string;
  FailureMessage?: string;
}

// ───────────────────────── X-Ray ─────────────────────────

export interface XraySegment {
  id: string;
  traceId: string;
  /** Documento tal y como lo envía el SDK (JSON). */
  doc: Record<string, unknown>;
  name: string;
  start: number;
  end: number;
  error: boolean;
  fault: boolean;
  throttle: boolean;
  origin?: string;
}

export interface XraySamplingRule {
  RuleName: string;
  RuleARN: string;
  ResourceARN: string;
  Priority: number;
  FixedRate: number;
  ReservoirSize: number;
  ServiceName: string;
  ServiceType: string;
  Host: string;
  HTTPMethod: string;
  URLPath: string;
  Version: number;
}

export interface XrayState {
  segments: XraySegment[];
  rules: Record<string, XraySamplingRule>;
  groups: Record<string, { GroupName: string; GroupARN: string; FilterExpression: string }>;
}

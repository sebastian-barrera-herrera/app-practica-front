/** Lógica pura (sin pantalla) de las ilustraciones de «Seguridad en profundidad»: así se puede probar. */

// ───────────────────────── cifrado de sobre ─────────────────────────

export const DIRECT_LIMIT = 4096;

/** `Encrypt` de KMS solo admite hasta 4 KB: con más datos hay que usar cifrado de sobre. */
export function directEncrypt(bytes: number): { ok: boolean; reason: string } {
  return bytes <= DIRECT_LIMIT ? { ok: true, reason: 'Cabe en una sola llamada a Encrypt (hasta 4 KB).' } : { ok: false, reason: `${bytes} bytes superan los 4096 que admite Encrypt: usa GenerateDataKey y cifra tú los datos (cifrado de sobre).` };
}

export type EnvMode = 'cifrar' | 'descifrar';

export interface EnvStep {
  title: string;
  text: string;
  /** Llamada a KMS en este paso (null si no hay). */
  kms: string | null;
  /** La aplicación tiene en memoria la clave de datos en claro. */
  plainKey: boolean;
  /** Existe la clave de datos cifrada. */
  cipherKey: boolean;
  /** Estado del fichero. */
  data: 'claro' | 'cifrado';
  /** Qué hay guardado en disco o en S3 al terminar el paso. */
  stored: string[];
}

export const ENVELOPE: Record<EnvMode, EnvStep[]> = {
  cifrar: [
    { title: '1 · Pedir una clave de datos', text: 'La aplicación llama a GenerateDataKey con tu clave de KMS. KMS devuelve la clave de datos dos veces: en claro y cifrada con tu clave.', kms: 'GenerateDataKey', plainKey: true, cipherKey: true, data: 'claro', stored: [] },
    { title: '2 · Cifrar los datos localmente', text: 'Con la clave en claro (AES-256) la aplicación cifra el fichero, sea del tamaño que sea. Los datos grandes nunca viajan a KMS.', kms: null, plainKey: true, cipherKey: true, data: 'cifrado', stored: [] },
    { title: '3 · Olvidar la clave en claro', text: 'La clave de datos en claro se borra de la memoria. Ya solo existe la versión cifrada por KMS.', kms: null, plainKey: false, cipherKey: true, data: 'cifrado', stored: [] },
    { title: '4 · Guardar el sobre', text: 'Se guardan juntos el fichero cifrado y la clave de datos cifrada: el «sobre». Quien lo robe no puede abrirlo sin permiso de KMS.', kms: null, plainKey: false, cipherKey: true, data: 'cifrado', stored: ['fichero.cifrado', 'clave-de-datos.cifrada'] },
  ],
  descifrar: [
    { title: '1 · Leer el sobre', text: 'La aplicación lee el fichero cifrado y la clave de datos cifrada. Todavía no puede abrir nada.', kms: null, plainKey: false, cipherKey: true, data: 'cifrado', stored: ['fichero.cifrado', 'clave-de-datos.cifrada'] },
    { title: '2 · Pedir a KMS que abra la clave', text: 'Manda la clave de datos cifrada a Decrypt. KMS comprueba la política de la clave y el contexto de cifrado; si todo encaja, devuelve la clave en claro.', kms: 'Decrypt', plainKey: true, cipherKey: true, data: 'cifrado', stored: ['fichero.cifrado', 'clave-de-datos.cifrada'] },
    { title: '3 · Descifrar localmente', text: 'Con la clave en claro la aplicación descifra el fichero en memoria. Los datos en claro nunca se guardan.', kms: null, plainKey: true, cipherKey: true, data: 'claro', stored: ['fichero.cifrado', 'clave-de-datos.cifrada'] },
    { title: '4 · Olvidar la clave', text: 'Se borra la clave en claro de la memoria. La próxima vez habrá que volver a pedírsela a KMS (y quedará registrado en CloudTrail).', kms: null, plainKey: false, cipherKey: true, data: 'cifrado', stored: ['fichero.cifrado', 'clave-de-datos.cifrada'] },
  ],
};

/** Estado de un paso; si se ha retirado `kms:Decrypt`, el descifrado se atasca en la llamada a KMS. */
export function envelopeAt(mode: EnvMode, step: number, revoked: boolean): EnvStep & { blocked: boolean } {
  const steps = ENVELOPE[mode];
  const s = steps[Math.max(0, Math.min(step, steps.length - 1))];
  const blocked = revoked && mode === 'descifrar' && step >= 1;
  if (!blocked) return { ...s, blocked: false };
  return { ...s, plainKey: false, data: 'cifrado', text: 'AccessDeniedException: KMS rechaza el Decrypt porque la política ya no permite a este rol usar la clave. El fichero cifrado sigue ahí, pero es ilegible: revocar el acceso a la clave basta para cortar el acceso a los datos.', blocked: true };
}

// ───────────────────────── quién puede usar la clave ─────────────────────────

export interface KmsAccessSetup {
  /** La política de la clave incluye la sentencia que delega en IAM (principal: la raíz de la cuenta). */
  delegates: boolean;
  /** La política de la clave nombra directamente al rol de la aplicación. */
  names: boolean;
  /** Una política de IAM del rol permite kms:Decrypt. */
  iam: boolean;
  /** Existe una concesión (grant) para el rol. */
  grant: boolean;
  /** Una sentencia Deny explícita alcanza al rol (en la clave o en IAM). */
  deny: boolean;
}

export interface KmsAccessResult {
  allowed: boolean;
  via: 'policy' | 'iam' | 'grant' | null;
  why: string;
}

export function kmsAccess(s: KmsAccessSetup): KmsAccessResult {
  if (s.deny) return { allowed: false, via: null, why: 'Un Deny explícito siempre gana: da igual lo que permitan las demás vías.' };
  if (s.names) return { allowed: true, via: 'policy', why: 'La política de la clave nombra al rol: basta por sí sola, sin permisos de IAM.' };
  if (s.grant) return { allowed: true, via: 'grant', why: 'Una concesión da el permiso a este principal (y se puede retirar con retire-grant).' };
  if (s.delegates && s.iam) return { allowed: true, via: 'iam', why: 'La política de la clave delega en IAM y el rol tiene kms:Decrypt: las dos llaves encajan.' };
  if (s.iam && !s.delegates) return { allowed: false, via: null, why: 'El rol tiene kms:Decrypt en IAM, pero la política de la clave no delega en IAM ni nombra al rol: IAM por sí solo no vale para KMS.' };
  if (s.delegates && !s.iam) return { allowed: false, via: null, why: 'La clave delega en IAM, pero el rol no tiene ningún permiso de IAM sobre ella.' };
  return { allowed: false, via: null, why: 'Ninguna vía da acceso a este rol: ni la política de la clave, ni IAM, ni una concesión.' };
}

// ───────────────────────── evaluación de WAF ─────────────────────────

export type WafAction = 'Allow' | 'Block' | 'Count';

export interface WafReq {
  id: string;
  label: string;
  path: string;
  ip: string;
  office: boolean;
  /** Ya ha hecho muchas peticiones en los últimos minutos. */
  flood: boolean;
  /** La consulta contiene una inyección SQL. */
  sqli: boolean;
}

export const WAF_REQS: WafReq[] = [
  { id: 'home', label: 'Un cliente abre la portada', path: '/', ip: '198.51.100.7', office: false, flood: false, sqli: false },
  { id: 'admin-office', label: 'Ana abre /admin desde la oficina', path: '/admin', ip: '203.0.113.25', office: true, flood: false, sqli: false },
  { id: 'admin-out', label: 'Alguien abre /admin desde fuera', path: '/admin', ip: '192.0.2.10', office: false, flood: false, sqli: false },
  { id: 'sqli', label: 'Búsqueda con ?q=1\' OR \'1\'=\'1', path: '/buscar', ip: '100.64.1.1', office: false, flood: false, sqli: true },
  { id: 'flood', label: '300 intentos de /login en un minuto', path: '/login', ip: '198.51.100.99', office: false, flood: true, sqli: false },
];

export interface WafRule {
  id: 'office' | 'admin' | 'sqli' | 'rate';
  name: string;
  priority: number;
  action: WafAction;
}

export const WAF_RULES: WafRule[] = [
  { id: 'office', name: 'Permitir oficina', priority: 0, action: 'Allow' },
  { id: 'admin', name: 'Bloquear /admin', priority: 1, action: 'Block' },
  { id: 'sqli', name: 'Grupo SQLi', priority: 2, action: 'Block' },
  { id: 'rate', name: 'Límite de /login', priority: 3, action: 'Block' },
];

function matches(rule: WafRule, r: WafReq): boolean {
  switch (rule.id) {
    case 'office':
      return r.office;
    case 'admin':
      return r.path.startsWith('/admin');
    case 'sqli':
      return r.sqli;
    default:
      return r.flood && r.path.startsWith('/login');
  }
}

export interface WafTrace {
  rule: WafRule;
  hit: boolean;
  /** La evaluación ya había terminado antes de llegar a esta regla. */
  skipped: boolean;
}

/** Evalúa por prioridad: Allow y Block terminan; Count solo anota; si nada termina, manda la acción por defecto. */
export function wafDecide(rules: WafRule[], r: WafReq, def: 'Allow' | 'Block'): { decision: 'Allow' | 'Block'; by: string; counted: string[]; trace: WafTrace[] } {
  const ordered = [...rules].sort((a, b) => a.priority - b.priority);
  const trace: WafTrace[] = [];
  const counted: string[] = [];
  let done: { decision: 'Allow' | 'Block'; by: string } | null = null;
  for (const rule of ordered) {
    if (done) {
      trace.push({ rule, hit: false, skipped: true });
      continue;
    }
    const hit = matches(rule, r);
    trace.push({ rule, hit, skipped: false });
    if (!hit) continue;
    if (rule.action === 'Count') counted.push(rule.name);
    else done = { decision: rule.action, by: rule.name };
  }
  return { decision: done?.decision ?? def, by: done?.by ?? 'acción por defecto', counted, trace };
}

// ───────────────────────── qué servicio responde a qué ─────────────────────────

export type SecService = 'GuardDuty' | 'Inspector' | 'Macie' | 'Access Analyzer' | 'Config' | 'CloudTrail' | 'WAF' | 'Security Hub' | 'SCP' | 'Shield';

export const SEC_SERVICES: SecService[] = ['GuardDuty', 'Inspector', 'Macie', 'Access Analyzer', 'Config', 'CloudTrail', 'WAF', 'Shield', 'Security Hub', 'SCP'];

export interface SecSituation {
  id: string;
  text: string;
  answer: SecService;
  why: string;
}

export const SEC_SITUATIONS: SecSituation[] = [
  { id: 's1', text: 'Una instancia empieza a hablar con un servidor de minería de criptomonedas.', answer: 'GuardDuty', why: 'GuardDuty analiza DNS, tráfico de red y CloudTrail y detecta comportamientos sospechosos como la minería (CryptoCurrency:EC2/BitcoinTool).' },
  { id: 's2', text: 'Quieres saber qué paquetes con CVE conocidos tienen tus servidores y qué parche los arregla.', answer: 'Inspector', why: 'Inspector compara los paquetes instalados (con el agente de SSM) con la base de vulnerabilidades y prioriza por gravedad.' },
  { id: 's3', text: 'Sospechas que hay números de tarjeta y DNI en un bucket de exportaciones.', answer: 'Macie', why: 'Macie lee los objetos de S3 con trabajos de clasificación y busca datos sensibles con identificadores gestionados y propios.' },
  { id: 's4', text: 'Un bucket se compartió con una cuenta desconocida y quieres encontrar todos los casos como ese.', answer: 'Access Analyzer', why: 'Access Analyzer revisa las políticas de recursos y avisa de cada entidad externa que puede acceder.' },
  { id: 's5', text: 'Necesitas saber cómo estaba un grupo de seguridad hace tres días y si cumple «SSH cerrado».', answer: 'Config', why: 'Config guarda el historial de configuración de cada recurso y evalúa reglas de cumplimiento.' },
  { id: 's6', text: 'Quieres saber quién borró una regla del grupo de seguridad y desde qué IP.', answer: 'CloudTrail', why: 'CloudTrail registra quién hizo cada llamada a la API, cuándo y desde dónde.' },
  { id: 's7', text: 'Llegan miles de peticiones con inyección SQL contra el formulario de búsqueda.', answer: 'WAF', why: 'WAF inspecciona las peticiones HTTP y las bloquea con reglas (grupo gestionado de SQLi).' },
  { id: 's8', text: 'Quieres impedir que ninguna cuenta de la organización pueda lanzar recursos fuera de Irlanda.', answer: 'SCP', why: 'Una SCP fija el techo de permisos de las cuentas: es un control preventivo para toda la organización.' },
  { id: 's9', text: 'Quieres una única lista priorizada con los hallazgos de todos los servicios y de las 12 cuentas.', answer: 'Security Hub', why: 'Security Hub agrega los hallazgos en formato común, los puntúa y evalúa estándares como CIS y FSBP.' },
  { id: 's10', text: 'Un ataque volumétrico inunda de tráfico tu balanceador y tu CloudFront.', answer: 'Shield', why: 'Shield (Standard gratis; Advanced de pago) absorbe los ataques DDoS de red y transporte.' },
];

export function answerSituation(id: string, service: SecService): { ok: boolean; why: string; right: SecService } {
  const s = SEC_SITUATIONS.find((x) => x.id === id);
  if (!s) return { ok: false, why: '', right: 'GuardDuty' };
  return { ok: s.answer === service, why: s.why, right: s.answer };
}

// ───────────────────────── cadena de SCP ─────────────────────────

export interface ScpLevel {
  name: string;
  /** FullAWSAccess aplicada en este nivel. */
  full: boolean;
  /** Una SCP de lista de permitidos (solo estos servicios) aplicada en este nivel. */
  allow?: string[];
  /** Una SCP que niega estas acciones. */
  deny?: string[];
  /** Una SCP que niega fuera de esta región. */
  region?: string;
}

export interface ScpAction {
  id: string;
  label: string;
  action: string;
  region: string;
  /** Servicio global (no depende de región). */
  global?: boolean;
}

export const SCP_ACTIONS: ScpAction[] = [
  { id: 'ec2-ie', label: 'ec2:RunInstances en Irlanda', action: 'ec2:RunInstances', region: 'eu-west-1' },
  { id: 'ec2-va', label: 'ec2:RunInstances en Virginia', action: 'ec2:RunInstances', region: 'us-east-1' },
  { id: 's3', label: 's3:GetObject', action: 's3:GetObject', region: 'eu-west-1' },
  { id: 'iam', label: 'iam:CreateUser (servicio global)', action: 'iam:CreateUser', region: 'us-east-1', global: true },
  { id: 'ct', label: 'cloudtrail:StopLogging', action: 'cloudtrail:StopLogging', region: 'eu-west-1' },
];

const svc = (action: string) => action.split(':')[0];

export interface ScpVerdict {
  allowed: boolean;
  /** Nivel que decide (el primero que niega o no permite). */
  level?: string;
  reason: 'allowed' | 'deny' | 'no-allow' | 'management';
}

/** Un nivel permite si hay alguna SCP con Allow que cubra la acción y ninguna Deny la alcanza. */
function levelCheck(l: ScpLevel, a: ScpAction): 'ok' | 'deny' | 'no-allow' {
  if (l.deny?.some((d) => d === a.action || d === `${svc(a.action)}:*`)) return 'deny';
  if (l.region && !a.global && a.region !== l.region) return 'deny';
  const hasAllow = l.full || !!l.allow?.length;
  if (!hasAllow) return 'no-allow';
  if (!l.full && l.allow && !l.allow.includes(svc(a.action)) && !l.allow.includes('*')) return 'no-allow';
  return 'ok';
}

export function scpDecide(levels: ScpLevel[], a: ScpAction, management: boolean): ScpVerdict {
  if (management) return { allowed: true, reason: 'management' };
  for (const l of levels) {
    const r = levelCheck(l, a);
    if (r === 'deny') return { allowed: false, level: l.name, reason: 'deny' };
    if (r === 'no-allow') return { allowed: false, level: l.name, reason: 'no-allow' };
  }
  return { allowed: true, reason: 'allowed' };
}

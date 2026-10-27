import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { T } from '@/ui/Text';
import { colors, fonts, radius } from '@/ui/theme';
import { select, tap } from '@/lib/haptics';
import { Frame } from './common';
import { Slider, Tabs } from './pyui';
import { Explain, Pill, Stepper, Toggle, awsHue } from './awsui';
import {
  answerSituation,
  directEncrypt,
  envelopeAt,
  kmsAccess,
  SCP_ACTIONS,
  SEC_SERVICES,
  SEC_SITUATIONS,
  scpDecide,
  WAF_REQS,
  WAF_RULES,
  wafDecide,
  type EnvMode,
  type ScpLevel,
  type SecService,
  type WafAction,
  type WafRule,
} from './awsSecLogic';

const Mono = ({ children, color, size = 11.5, lines }: { children: React.ReactNode; color?: string; size?: number; lines?: number }) => (
  <T numberOfLines={lines} style={{ fontFamily: fonts.mono, fontSize: size, lineHeight: size + 4 }} color={color ?? colors.text}>{children}</T>
);

const Box = ({ title, color, children }: { title: string; color?: string; children?: React.ReactNode }) => {
  const c = color ?? colors.line;
  return (
    <View style={{ borderWidth: 1.5, borderColor: c, backgroundColor: color ? c + '1A' : 'transparent', borderRadius: radius.sm, padding: 8, gap: 3 }}>
      <T style={{ fontFamily: fonts.monoBold, fontSize: 12.5, lineHeight: 17 }} color={colors.text}>{title}</T>
      {children}
    </View>
  );
};

// ───────────────────────── cifrado de sobre ─────────────────────────

export function EnvelopeFlow() {
  const [mode, setMode] = useState<EnvMode>('cifrar');
  const [step, setStep] = useState(0);
  const [revoked, setRevoked] = useState(false);
  const [kb, setKb] = useState(1);
  const { a } = awsHue();
  const s = envelopeAt(mode, step, revoked);
  const direct = directEncrypt(kb * 1024);
  const lock = s.blocked ? colors.rose : a;
  return (
    <Frame>
      <Tabs color={a} value={mode} onChange={(m) => { setMode(m); setStep(0); }} items={[{ id: 'cifrar', label: 'Cifrar un fichero' }, { id: 'descifrar', label: 'Descifrarlo' }]} />
      <Stepper label="Paso" value={step + 1} min={1} max={4} onChange={(v) => setStep(v - 1)} />
      <Box title="🔑 KMS (la clave nunca sale de KMS)" color={s.kms ? lock : undefined}>
        <Mono color={s.kms ? (s.blocked ? colors.rose : colors.green) : colors.dim}>{s.kms ? `→ ${s.kms}${s.blocked ? '  ✖ AccessDenied' : ''}` : '— sin llamada a KMS en este paso —'}</Mono>
      </Box>
      <Box title="🖥️ Aplicación (memoria)">
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Pill text={s.plainKey ? 'clave de datos EN CLARO' : 'sin clave en claro'} color={s.plainKey ? colors.amber : colors.faint} solid={s.plainKey} />
          <Pill text={s.cipherKey ? 'clave de datos cifrada' : 'sin clave cifrada'} color={s.cipherKey ? colors.green : colors.faint} />
          <Pill text={s.data === 'claro' ? 'datos EN CLARO' : 'datos cifrados'} color={s.data === 'claro' ? colors.rose : colors.green} solid={s.data === 'claro'} />
        </View>
      </Box>
      <Box title="💾 Guardado (disco o S3)">
        {s.stored.length ? s.stored.map((f) => <Mono key={f} size={11}>{`📄 ${f}`}</Mono>) : <Mono color={colors.dim}>(todavía nada)</Mono>}
      </Box>
      {mode === 'descifrar' ? <Toggle label="Retirar kms:Decrypt al rol de la aplicación" on={revoked} set={setRevoked} /> : null}
      <Explain k={`${mode}${step}${revoked}`} title={s.blocked ? '🔒 Sin permiso, sin datos' : s.title} color={lock}>
        {s.text}
      </Explain>
      <T v="label" color={colors.dim}>{`¿Y si lo cifro todo con Encrypt? Tamaño del dato: ${kb >= 1024 ? `${kb / 1024} MB` : `${kb} KB`}`}</T>
      <Slider min={1} max={2048} value={kb} onChange={(v) => setKb(Math.max(1, Math.round(v)))} color={a} label="Tamaño del dato" format={(v) => `${Math.round(v)} KB`} />
      <Pill text={direct.ok ? 'Encrypt directo: sí cabe' : 'Encrypt directo: no cabe'} color={direct.ok ? colors.green : colors.rose} solid />
      <Explain k={String(direct.ok)} title={direct.ok ? 'Cabe' : 'Hace falta un sobre'} color={direct.ok ? colors.green : colors.rose}>
        {direct.reason}
      </Explain>
    </Frame>
  );
}

// ───────────────────────── quién puede usar la clave ─────────────────────────

export function KmsAccess() {
  const [delegates, setDelegates] = useState(true);
  const [names, setNames] = useState(false);
  const [iam, setIam] = useState(false);
  const [grant, setGrant] = useState(false);
  const [deny, setDeny] = useState(false);
  const { a } = awsHue();
  const r = kmsAccess({ delegates, names, iam, grant, deny });
  const c = r.allowed ? colors.green : colors.rose;
  return (
    <Frame>
      <Box title="🗝️ Política de la clave">
        <Toggle label="Delega en IAM (principal: la raíz de la cuenta)" on={delegates} set={setDelegates} hint="es la sentencia «Enable IAM policies»" />
        <Toggle label="Nombra directamente al rol app-informes" on={names} set={setNames} />
      </Box>
      <Box title="👤 Del lado del rol">
        <Toggle label="Política de IAM con kms:Decrypt" on={iam} set={setIam} />
        <Toggle label="Concesión (grant) para el rol" on={grant} set={setGrant} />
      </Box>
      <Toggle label="Un Deny explícito alcanza al rol" on={deny} set={setDeny} good="off" />
      <Box title="📞 app-informes llama a kms:Decrypt" color={c}>
        <Mono color={c}>{r.allowed ? `✔ Permitido${r.via ? ` · vía ${r.via === 'policy' ? 'política de la clave' : r.via === 'iam' ? 'IAM + delegación' : 'concesión'}` : ''}` : '✖ AccessDeniedException'}</Mono>
      </Box>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Pill text={r.allowed ? 'permitido' : 'denegado'} color={c} solid />
        <Pill text={r.via ? `vía: ${r.via}` : 'sin vía'} color={a} />
      </View>
      <Explain k={`${delegates}${names}${iam}${grant}${deny}`} title={r.allowed ? '✓ Hay una llave que encaja' : '✖ Falta una llave'} color={c}>
        {r.why}
      </Explain>
    </Frame>
  );
}

// ───────────────────────── reglas de WAF ─────────────────────────

const ACTIONS: WafAction[] = ['Allow', 'Block', 'Count'];
const ACTION_COLOR: Record<string, string> = { Allow: colors.green, Block: colors.rose, Count: colors.amber };

export function WafRules() {
  const [rules, setRules] = useState<WafRule[]>(WAF_RULES);
  const [def, setDef] = useState<'Allow' | 'Block'>('Allow');
  const [reqId, setReqId] = useState('admin-office');
  const { a } = awsHue();
  const ordered = [...rules].sort((x, y) => x.priority - y.priority);
  const req = WAF_REQS.find((r) => r.id === reqId)!;
  const res = wafDecide(rules, req, def);
  const move = (id: string, d: -1 | 1) => {
    const i = ordered.findIndex((r) => r.id === id);
    const j = i + d;
    if (j < 0 || j >= ordered.length) return;
    select();
    const swap = ordered.map((r, k) => ({ ...r, priority: k === i ? j : k === j ? i : k }));
    setRules(swap);
  };
  const cycle = (id: string) => {
    tap();
    setRules((rs) => rs.map((r) => (r.id === id ? { ...r, action: ACTIONS[(ACTIONS.indexOf(r.action) + 1) % ACTIONS.length] } : r)));
  };
  const c = res.decision === 'Allow' ? colors.green : colors.rose;
  const btn = (txt: string, label: string, onPress: () => void, off: boolean) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={off} onPress={onPress} style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line, opacity: off ? 0.3 : 1 }}>
      <T style={{ fontSize: 16, lineHeight: 20 }} color={colors.text}>{txt}</T>
    </Pressable>
  );
  return (
    <Frame>
      <T v="label" color={colors.dim}>Petición</T>
      <Tabs color={a} value={reqId} onChange={setReqId} items={WAF_REQS.map((r) => ({ id: r.id, label: r.label.length > 24 ? r.label.slice(0, 22) + '…' : r.label }))} />
      <Box title={`🌐 ${req.label}`}>
        <Mono size={10.5} color={colors.dim}>{`${req.path} · ${req.ip}${req.office ? ' (oficina)' : ''}`}</Mono>
      </Box>
      <Box title="🛡️ Web ACL tienda-acl · reglas por prioridad">
        {ordered.map((r, i) => {
          const t = res.trace.find((x) => x.rule.id === r.id)!;
          return (
            <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, opacity: t.skipped ? 0.35 : 1 }}>
              <Mono size={11} color={colors.dim}>{`${i}`}</Mono>
              <View style={{ flex: 1 }}>
                <Mono size={11} lines={2} color={t.hit ? colors.text : colors.dim}>{r.name}</Mono>
                <Mono size={10} color={t.skipped ? colors.faint : t.hit ? colors.amber : colors.dim}>{t.skipped ? 'sin evaluar' : t.hit ? '● coincide' : '○ no coincide'}</Mono>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={`Acción de ${r.name}: ${r.action}. Toca para cambiarla`} onPress={() => cycle(r.id)}>
                <Pill text={r.action} color={ACTION_COLOR[r.action]} solid size={11} />
              </Pressable>
              {btn('↑', `Subir prioridad de ${r.name}`, () => move(r.id, -1), i === 0)}
              {btn('↓', `Bajar prioridad de ${r.name}`, () => move(r.id, 1), i === ordered.length - 1)}
            </View>
          );
        })}
        <Mono size={10.5} color={colors.dim}>Toca la acción para cambiarla · ↑ ↓ cambian la prioridad</Mono>
      </Box>
      <T v="label" color={colors.dim}>Acción por defecto (si ninguna regla decide)</T>
      <Tabs color={a} value={def} onChange={setDef} items={[{ id: 'Allow', label: 'Allow' }, { id: 'Block', label: 'Block' }]} />
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Pill text={res.decision === 'Allow' ? 'pasa (200)' : 'bloqueada (403)'} color={c} solid />
        <Pill text={`decide: ${res.by}`} color={a} />
        {res.counted.length ? <Pill text={`contada: ${res.counted.join(', ')}`} color={colors.amber} /> : null}
      </View>
      <Explain k={`${reqId}${def}${rules.map((r) => `${r.id}${r.priority}${r.action}`).join('')}`} title={res.decision === 'Allow' ? '✓ La petición llega a la aplicación' : '✖ WAF responde 403'} color={c}>
        {res.by === 'acción por defecto'
          ? `Ninguna regla terminó la evaluación, así que manda la acción por defecto (${def}). Una ACL con «Block» por defecto es una lista de permitidos; con «Allow», una lista de bloqueados.`
          : `La regla «${res.by}» fue la primera que coincidió con Allow o Block y terminó la evaluación: las siguientes ni se miran. Cambia el orden y verás cómo cambia el resultado.${res.counted.length ? ' Las reglas en Count solo anotan la petición en las métricas y la dejan seguir.' : ''}`}
      </Explain>
    </Frame>
  );
}

// ───────────────────────── qué servicio uso ─────────────────────────

export function SecMap() {
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, SecService>>({});
  const { a } = awsHue();
  const sit = SEC_SITUATIONS[idx];
  const picked = answers[sit.id];
  const res = picked ? answerSituation(sit.id, picked) : null;
  const score = SEC_SITUATIONS.filter((s) => answers[s.id] && answerSituation(s.id, answers[s.id]).ok).length;
  const answered = Object.keys(answers).length;
  const go = (d: number) => {
    select();
    setIdx((i) => (i + d + SEC_SITUATIONS.length) % SEC_SITUATIONS.length);
  };
  return (
    <Frame>
      <Stepper label={`Situación (${SEC_SITUATIONS.length})`} value={idx + 1} min={1} max={SEC_SITUATIONS.length} onChange={(v) => setIdx(v - 1)} />
      <Box title={`🚨 ${sit.text}`} color={res ? (res.ok ? colors.green : colors.rose) : a} />
      <T v="label" color={colors.dim}>¿Qué servicio te lo cuenta o lo resuelve?</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {SEC_SERVICES.map((sv) => {
          const on = picked === sv;
          const isRight = res && sv === res.right;
          const c = on ? (res?.ok ? colors.green : colors.rose) : isRight ? colors.green : a;
          return (
            <Pressable key={sv} accessibilityRole="button" accessibilityLabel={sv} accessibilityState={{ selected: on }} onPress={() => { select(); setAnswers((p) => ({ ...p, [sit.id]: sv })); }} style={{ minHeight: 40, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1.5, borderColor: c, backgroundColor: on || isRight ? c + '33' : 'transparent', justifyContent: 'center' }}>
              <T style={{ fontFamily: fonts.monoBold, fontSize: 12.5 }} color={colors.text}>{sv}</T>
            </Pressable>
          );
        })}
      </View>
      {res ? (
        <Explain k={`${sit.id}${picked}`} title={res.ok ? '✓ Correcto' : `✖ Era ${res.right}`} color={res.ok ? colors.green : colors.rose}>
          {res.why}
        </Explain>
      ) : (
        <Explain k={`q${sit.id}`} title="Elige un servicio" color={a}>
          Fíjate en la palabra clave: «detecta», «parches», «datos sensibles», «política externa», «historial», «quién hizo», «peticiones HTTP», «techo de permisos», «lista única» o «ataque de tráfico».
        </Explain>
      )}
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Pill text={`aciertos: ${score} de ${answered}`} color={score === answered && answered ? colors.green : a} solid />
        <Pressable accessibilityRole="button" accessibilityLabel="Siguiente situación" onPress={() => go(1)} style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1.5, borderColor: a, justifyContent: 'center' }}>
          <T style={{ fontFamily: fonts.monoBold, fontSize: 12.5 }} color={colors.text}>Siguiente →</T>
        </Pressable>
      </View>
    </Frame>
  );
}

// ───────────────────────── cadena de SCP ─────────────────────────

type Preset = 'full' | 'region' | 'lista' | 'noct' | 'none';

const PRESETS: { id: Preset; label: string; make: (name: string) => ScpLevel; note: string }[] = [
  { id: 'full', label: 'FullAWSAccess', make: (name) => ({ name, full: true }), note: 'permite todo' },
  { id: 'region', label: 'Solo Irlanda', make: (name) => ({ name, full: true, region: 'eu-west-1' }), note: 'niega fuera de eu-west-1' },
  { id: 'lista', label: 'Lista: ec2 y s3', make: (name) => ({ name, full: false, allow: ['ec2', 's3'] }), note: 'solo permite ec2 y s3' },
  { id: 'noct', label: 'Protege CloudTrail', make: (name) => ({ name, full: true, deny: ['cloudtrail:StopLogging'] }), note: 'niega parar CloudTrail' },
  { id: 'none', label: 'Sin SCP de Allow', make: (name) => ({ name, full: false }), note: 'quitó FullAWSAccess y no puso nada' },
];

const LEVELS = ['Raíz', 'Producción', 'web-prod'] as const;

export function ScpChain() {
  const [sel, setSel] = useState<Preset[]>(['full', 'region', 'full']);
  const [actionId, setActionId] = useState('ec2-va');
  const [mgmt, setMgmt] = useState(false);
  const { a } = awsHue();
  const levels = LEVELS.map((n, i) => PRESETS.find((p) => p.id === sel[i])!.make(n));
  const act = SCP_ACTIONS.find((x) => x.id === actionId)!;
  const v = scpDecide(levels, act, mgmt);
  const c = v.allowed ? colors.green : colors.rose;
  return (
    <Frame>
      <T v="label" color={colors.dim}>Acción que intenta la cuenta web-prod</T>
      <Tabs color={a} value={actionId} onChange={setActionId} items={SCP_ACTIONS.map((x) => ({ id: x.id, label: x.label.length > 26 ? x.label.slice(0, 24) + '…' : x.label }))} />
      <Toggle label="Es la cuenta de administración de la organización" on={mgmt} set={setMgmt} hint="las SCP no la afectan" />
      {LEVELS.map((n, i) => {
        const stopped = !mgmt && !v.allowed && v.level === n;
        return (
          <Box key={n} title={`${i === 0 ? '🌳' : i === 1 ? '📁' : '🏢'} ${n}${stopped ? '  ← aquí se corta' : ''}`} color={stopped ? colors.rose : undefined}>
            <Tabs color={stopped ? colors.rose : a} value={sel[i]} onChange={(p) => setSel((s) => s.map((x, k) => (k === i ? p : x)))} items={PRESETS.map((p) => ({ id: p.id, label: p.label }))} />
            <Mono size={10.5} color={colors.dim}>{PRESETS.find((p) => p.id === sel[i])!.note}</Mono>
          </Box>
        );
      })}
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Pill text={v.allowed ? 'las SCP lo permiten' : 'las SCP lo impiden'} color={c} solid />
        {v.level ? <Pill text={`nivel: ${v.level}`} color={colors.amber} /> : null}
      </View>
      <Explain k={`${sel.join('')}${actionId}${mgmt}`} title={v.reason === 'management' ? '👑 Exenta' : v.allowed ? '✓ Pasa todos los niveles' : v.reason === 'deny' ? '⛔ Un Deny gana' : '🚫 Falta un Allow'} color={c}>
        {v.reason === 'management'
          ? 'Las SCP nunca se aplican a la cuenta de administración: por eso no se debe usar para cargas de trabajo.'
          : v.reason === 'allowed'
            ? 'En cada nivel hay un Allow que cubre la acción y ningún Deny la alcanza. Ojo: que las SCP lo permitan no concede nada por sí solo; la cuenta aún necesita permisos de IAM.'
            : v.reason === 'deny'
              ? `La SCP de «${v.level}» niega la acción. Un Deny en cualquier nivel de la cadena gana, aunque FullAWSAccess siga puesta más arriba.`
              : `En «${v.level}» no hay ninguna SCP que permita la acción. Cada nivel necesita su propio Allow (por eso FullAWSAccess viene puesta por defecto): quitarla sin poner otra bloquea todo lo de abajo.`}
      </Explain>
    </Frame>
  );
}

import React, { useState } from 'react';
import { View } from 'react-native';
import { T } from '@/ui/Text';
import { colors, fonts, radius } from '@/ui/theme';
import { Frame } from './common';
import { Slider, StepBar, Tabs, useSteps } from './pyui';
import { Explain, Pill, Toggle, awsHue } from './awsui';

const Mono = ({ children, color, size = 11.5 }: { children: React.ReactNode; color?: string; size?: number }) => (
  <T style={{ fontFamily: fonts.mono, fontSize: size, lineHeight: size + 4 }} color={color ?? colors.text}>{children}</T>
);

const Box = ({ title, color, dim, children }: { title: string; color?: string; dim?: boolean; children?: React.ReactNode }) => {
  const c = color ?? colors.line;
  return (
    <View style={{ borderWidth: 1.5, borderColor: c, backgroundColor: color ? c + '1A' : 'transparent', borderRadius: radius.sm, padding: 8, gap: 3, opacity: dim ? 0.5 : 1 }}>
      <T style={{ fontFamily: fonts.monoBold, fontSize: 12.5, lineHeight: 17 }} color={colors.text}>{title}</T>
      {children}
    </View>
  );
};

// ───────────────────────── CloudFormation: de la plantilla a la pila ─────────────────────────

type RState = 'pending' | 'creating' | 'done' | 'skipped' | 'failed' | 'deleted';
const STATE_TXT: Record<RState, string> = { pending: 'pendiente', creating: 'CREATE_IN_PROGRESS', done: 'CREATE_COMPLETE', skipped: 'no se crea (Condition falsa)', failed: 'CREATE_FAILED', deleted: 'DELETE_COMPLETE (retroceso)' };
const STATE_COLOR: Record<RState, string> = { pending: colors.dim, creating: colors.amber, done: colors.green, skipped: colors.dim, failed: colors.rose, deleted: colors.dim };

export function CfnFlow() {
  const [env, setEnv] = useState('prod');
  const [fail, setFail] = useState(false);
  const { a } = awsHue();
  const { i, go, auto, toggle } = useSteps(5, 1800);
  const prod = env === 'prod';
  // paso 0: plan · 1: Cubo y Cola · 2: Función · 3: Alarma · 4: salidas y estado final
  const res: { id: string; type: string; needs: string; state: RState }[] = [
    { id: 'Cubo', type: 'AWS::S3::Bucket', needs: '—', state: i === 0 ? 'pending' : i === 1 ? 'creating' : 'done' },
    { id: 'Cola', type: 'AWS::SQS::Queue', needs: `VisibilityTimeout = FindInMap(${env}) = ${prod ? 120 : 30}`, state: i === 0 ? 'pending' : i === 1 ? 'creating' : 'done' },
    { id: 'Funcion', type: 'AWS::Lambda::Function', needs: '!Ref Cubo · !GetAtt Cola.Arn', state: i < 2 ? 'pending' : i === 2 ? (fail ? 'failed' : 'creating') : fail ? 'failed' : 'done' },
    { id: 'Alarma', type: 'AWS::CloudWatch::Alarm', needs: 'Condition: EsProd · !Ref Funcion', state: !prod ? 'skipped' : i < 3 || fail ? 'pending' : i === 3 ? 'creating' : 'done' },
  ];
  if (fail && i >= 3) {
    res[0].state = 'deleted';
    res[1].state = 'deleted';
  }
  const stack = i === 0 ? 'Leyendo la plantilla' : fail && i >= 2 ? (i >= 3 ? 'ROLLBACK_COMPLETE' : 'ROLLBACK_IN_PROGRESS') : i === 4 ? 'CREATE_COMPLETE' : 'CREATE_IN_PROGRESS';
  const sc = stack === 'CREATE_COMPLETE' ? colors.green : stack.startsWith('ROLLBACK') ? colors.rose : colors.amber;
  return (
    <Frame>
      <T v="label" color={colors.dim}>Parámetro Entorno</T>
      <Tabs color={a} value={env} onChange={(v) => { setEnv(v); go(0); }} items={[{ id: 'dev', label: 'dev' }, { id: 'prod', label: 'prod' }]} />
      <Toggle label="A la función le falta permiso de IAM para crearse" on={fail} set={(v) => { setFail(v); go(0); }} good="off" />
      <Box title="📄 Plantilla">
        <Mono>{'Parameters:  Entorno (dev | prod)'}</Mono>
        <Mono>{'Conditions:  EsProd = Entorno == prod'}</Mono>
        <Mono>{'Resources:   Cubo · Cola · Funcion · Alarma'}</Mono>
        <Mono>{'Outputs:     Arn = !GetAtt Funcion.Arn'}</Mono>
      </Box>
      <StepBar i={i} n={5} go={go} auto={auto} toggle={toggle} color={a} hint label={['1 · Plan', '2 · Sin dependencias', '3 · Función', '4 · Alarma', '5 · Fin'][i]} />
      {res.map((r) => (
        <Box key={r.id} title={`${r.id} · ${r.type}`} color={STATE_COLOR[r.state]} dim={r.state === 'skipped'}>
          <Mono color={colors.dim}>{r.needs}</Mono>
          <Mono color={STATE_COLOR[r.state]}>{STATE_TXT[r.state]}</Mono>
        </Box>
      ))}
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Pill text={`Pila: ${stack}`} color={sc} solid />
        <Pill text={i === 4 && !fail ? 'Outputs: Arn listo' : 'Outputs: esperando'} color={a} />
      </View>
      <Explain k={`${env}${fail}${i}`} title={i === 0 ? 'Plan' : stack === 'ROLLBACK_COMPLETE' ? 'Retroceso' : i === 4 ? '✓ Pila creada' : 'Orden por dependencias'} color={stack.startsWith('ROLLBACK') ? colors.rose : a}>
        {i === 0
          ? `CloudFormation resuelve parámetros y condiciones: con Entorno=${env} ${prod ? 'se crean los cuatro recursos' : 'la alarma NO se crea'}. Después calcula el orden por las referencias (!Ref, !GetAtt).`
          : i === 1
            ? 'Cubo y Cola no dependen de nadie: se crean a la vez.'
            : i === 2
              ? fail
                ? 'La función falla al crearse (CREATE_FAILED): el motivo está en los eventos de la pila. Como la creación es una sola unidad, CloudFormation empieza a deshacer.'
                : 'La función usa !Ref Cubo y !GetAtt Cola.Arn: espera a que existan los dos.'
              : i === 3
                ? fail
                  ? 'Retroceso: se borran los recursos que sí se habían creado. La pila queda en ROLLBACK_COMPLETE y solo se puede borrar y volver a crear.'
                  : prod
                    ? 'La alarma depende de la función y solo existe si EsProd es verdadera.'
                    : 'Con Entorno=dev la condición es falsa: la alarma se omite.'
                : fail
                  ? 'Estado final: ROLLBACK_COMPLETE. Lo primero siempre: aws cloudformation describe-stack-events.'
                  : 'Todo creado: la pila pasa a CREATE_COMPLETE y las salidas ya tienen valor.'}
      </Explain>
    </Frame>
  );
}

// ───────────────────────── CloudFormation: qué pasa al actualizar ─────────────────────────

const CHANGES = [
  { id: 'tiempo', label: 'Tiempo', what: 'Cola: VisibilityTimeout 30 → 60', action: 'Modify', repl: 'False', data: 'Los 3 mensajes se conservan', keep: true, why: 'Es una propiedad que se cambia en el sitio («Update requires: No interruption»).' },
  { id: 'nombre', label: 'Nombre', what: 'Cola: QueueName ventas → ventas-2026', action: 'Modify', repl: 'True', data: 'La cola nueva está vacía y la vieja (con sus 3 mensajes) se borra', keep: false, why: 'El nombre no se puede cambiar: CloudFormation crea una cola nueva y, al final, borra la vieja («Update requires: Replacement»).' },
  { id: 'tipo', label: 'Instancia', what: 'EC2: InstanceType t3.micro → t3.small', action: 'Modify', repl: 'False', data: 'La instancia se para y se arranca (interrupción breve); el disco EBS se conserva', keep: true, why: '«Some interruptions»: no se sustituye, pero se detiene unos minutos.' },
  { id: 'quitar', label: 'Quitar', what: 'Se quita el bucket «Archivos» de la plantilla', action: 'Remove', repl: '—', data: 'Con Delete se borra con su contenido; con Retain queda fuera de la pila', keep: false, why: 'Quitar un recurso de la plantilla equivale a borrarlo, y manda su DeletionPolicy.' },
];

export function CfnChange() {
  const [id, setId] = useState('nombre');
  const [retain, setRetain] = useState(false);
  const [exec, setExec] = useState(false);
  const { a } = awsHue();
  const c = CHANGES.find((x) => x.id === id)!;
  const risky = c.repl === 'True' || (c.id === 'quitar' && !retain);
  const kept = c.id === 'quitar' ? retain : c.keep;
  return (
    <Frame>
      <T v="label" color={colors.dim}>Cambio en la plantilla</T>
      <Tabs color={a} value={id} onChange={(v) => { setId(v); setExec(false); }} items={CHANGES.map((x) => ({ id: x.id, label: x.label }))} />
      <Mono>{c.what}</Mono>
      {c.id === 'quitar' || c.id === 'nombre' ? <Toggle label="El recurso tiene DeletionPolicy / UpdateReplacePolicy: Retain" on={retain} set={(v) => { setRetain(v); setExec(false); }} good="on" /> : null}
      <Box title="🔎 aws cloudformation describe-change-set" color={risky ? colors.amber : colors.green}>
        <Mono>{`Action: ${c.action}`}</Mono>
        <Mono color={c.repl === 'True' ? colors.rose : colors.text}>{`Replacement: ${c.repl}`}</Mono>
      </Box>
      <Box title={exec ? '⚙️ execute-change-set' : '⏸ Todavía no se ha tocado nada'} color={exec ? (kept || (c.id === 'nombre' && retain) ? colors.green : colors.rose) : undefined}>
        {exec ? <Mono>{c.id === 'nombre' && retain ? 'La cola vieja se conserva (Retain), pero sale de la pila: hay dos colas y la vieja ya no la gestiona CloudFormation.' : c.data + (c.id === 'quitar' ? (retain ? ' (Retain)' : ' (Delete)') : '')}</Mono> : <Mono color={colors.dim}>Un conjunto de cambios solo es una vista previa.</Mono>}
      </Box>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Pill text={exec ? 'ejecutado' : 'vista previa'} color={exec ? colors.amber : a} solid />
        <Pill text={risky ? 'revisa antes de ejecutar' : 'cambio seguro'} color={risky ? colors.rose : colors.green} />
      </View>
      <Toggle label="Ejecutar el conjunto de cambios (execute-change-set)" on={exec} set={setExec} />
      <Explain k={`${id}${retain}${exec}`} title={exec ? (kept ? '✓ Sin pérdida' : '⚠ Datos afectados') : 'Qué avisa la vista previa'} color={exec && !kept ? colors.rose : a}>
        {c.why} {risky ? 'Por eso se mira Replacement antes de ejecutar: es la única señal de que habrá un recurso nuevo.' : ''}
      </Explain>
    </Frame>
  );
}

// ───────────────────────── SAM, CDK y CloudFormation ─────────────────────────

const WAYS = [
  {
    id: 'cfn',
    label: 'CloudFormation',
    lines: 42,
    code: ['Resources:', '  Rol: {Type: AWS::IAM::Role, …}', '  Saludo: {Type: AWS::Lambda::Function, …}', '  Permiso: {Type: AWS::Lambda::Permission, …}', '  Api: {Type: AWS::ApiGatewayV2::Api, …}', '  Ruta, Integracion, Etapa…'],
    resources: ['IAM::Role', 'Lambda::Function', 'Lambda::Permission', 'ApiGatewayV2::Api', 'ApiGatewayV2::Integration', 'ApiGatewayV2::Route', 'ApiGatewayV2::Stage'],
    flow: ['aws cloudformation package', 'aws cloudformation deploy'],
  },
  {
    id: 'sam',
    label: 'SAM',
    lines: 14,
    code: ['Transform: AWS::Serverless-2016-10-31', 'Resources:', '  Saludo:', '    Type: AWS::Serverless::Function', '    Properties: {Handler: app.handler, CodeUri: src/,', '      Events: {Raiz: {Type: HttpApi, …}}}'],
    resources: ['IAM::Role', 'Lambda::Function', 'Lambda::Permission', 'ApiGatewayV2::Api', 'ApiGatewayV2::Integration', 'ApiGatewayV2::Route', 'ApiGatewayV2::Stage'],
    flow: ['aws cloudformation package', 'aws cloudformation deploy'],
  },
  {
    id: 'cdk',
    label: 'CDK',
    lines: 9,
    code: ['fn = _lambda.Function(self, "Saludo",', '    runtime=_lambda.Runtime.PYTHON_3_12,', '    handler="app.handler",', '    code=_lambda.Code.from_asset("src"))', 'api = apigw.HttpApi(self, "Api",', '    default_integration=Integ(fn))'],
    resources: ['IAM::Role', 'Lambda::Function', 'Lambda::Permission', 'ApiGatewayV2::Api', 'ApiGatewayV2::Integration', 'ApiGatewayV2::Route', 'ApiGatewayV2::Stage', 'CDK::Metadata'],
    flow: ['cdk synth', 'cdk diff', 'cdk deploy'],
  },
];

export function SamCdk() {
  const [id, setId] = useState('sam');
  const [boot, setBoot] = useState(true);
  const { a } = awsHue();
  const w = WAYS.find((x) => x.id === id)!;
  const failBoot = id === 'cdk' && !boot;
  return (
    <Frame>
      <T v="label" color={colors.dim}>Cómo escribes lo mismo: función + API HTTP</T>
      <Tabs color={a} value={id} onChange={setId} items={WAYS.map((x) => ({ id: x.id, label: x.label }))} />
      <Box title={`✍️ Lo que escribes · ~${w.lines} líneas`}>
        {w.code.map((l, k) => (
          <Mono key={k} size={11}>{l}</Mono>
        ))}
      </Box>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {w.flow.map((f, k) => (
          <Pill key={f} text={`${k + 1}. ${f}`} color={failBoot && k === w.flow.length - 1 ? colors.rose : a} />
        ))}
      </View>
      {id === 'cdk' ? <Toggle label="La cuenta está «bootstrapped» (cdk bootstrap)" on={boot} set={setBoot} good="on" hint="crea la pila CDKToolkit" /> : null}
      <Box title={failBoot ? '✖ cdk deploy falla' : `📦 Lo que despliega CloudFormation · ${w.resources.length} recursos`} color={failBoot ? colors.rose : colors.green}>
        {failBoot ? (
          <Mono color={colors.rose}>This stack uses assets, so the toolkit stack must be deployed to the environment (cdk bootstrap).</Mono>
        ) : (
          w.resources.map((r) => (
            <Mono key={r} size={11}>{`AWS::${r}`}</Mono>
          ))
        )}
      </Box>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Pill text={`${w.lines} líneas → ${w.resources.length} recursos`} color={a} solid />
        <Pill text="siempre acaba en una pila" color={colors.green} />
      </View>
      <Explain k={`${id}${boot}`} title={id === 'cfn' ? 'Todo explícito' : id === 'sam' ? 'La transformación expande' : 'El código genera la plantilla'} color={failBoot ? colors.rose : a}>
        {id === 'cfn'
          ? 'Tú escribes cada recurso: máximo control y máxima longitud. Lo que ves es lo que se despliega.'
          : id === 'sam'
            ? 'La línea «Transform» activa una macro: CloudFormation la expande a rol, función, permiso y API antes de crear nada. Por eso hace falta CAPABILITY_AUTO_EXPAND (y CAPABILITY_IAM por el rol).'
            : failBoot
              ? 'Sin bootstrap no hay bucket de activos ni roles de despliegue: es una vez por cuenta y región, y es lo primero que falla en una cuenta nueva.'
              : 'cdk synth ejecuta tu programa y escribe la plantilla en cdk.out/. cdk diff es un conjunto de cambios; cdk deploy lo ejecuta. Si algo falla, lee la plantilla generada.'}
      </Explain>
    </Frame>
  );
}

// ───────────────────────── CodePipeline: dónde se para y por qué ─────────────────────────

type SState = 'ok' | 'fail' | 'wait' | 'skip';

export function PipelineRun() {
  const [ver, setVer] = useState(true);
  const [tests, setTests] = useState(true);
  const [perm, setPerm] = useState(true);
  const [approval, setApproval] = useState(false);
  const [approved, setApproved] = useState(false);
  const [caps, setCaps] = useState(true);
  const { a } = awsHue();
  const n = approval ? 4 : 3;
  const { i: step, go, auto, toggle } = useSteps(n, 1700);
  const i = Math.min(step, n - 1);
  const stages: { name: string; msg: string; fix: string; state: SState }[] = [];
  let stop = false;
  const push = (name: string, ok: boolean, msg: string, fix: string, wait = false) => {
    stages.push({ name, msg, fix, state: stop ? 'skip' : wait ? 'wait' : ok ? 'ok' : 'fail' });
    if (!ok || wait) stop = true;
  };
  push('Origen (S3)', ver, 'The versioning of the bucket is not enabled: CodePipeline needs a versioned bucket.', 'aws s3api put-bucket-versioning --bucket codigo --versioning-configuration Status=Enabled');
  push('Compilar (CodeBuild)', perm && tests, perm ? 'Error in the PRE_BUILD phase of the build: Command did not exit successfully pytest (exit status 1).' : 'web-pipe-role is not authorized to perform: codebuild:StartBuild.', perm ? 'Lee el log (aws logs get-log-events --log-group-name /aws/codebuild/…), corrige el código y lanza otra ejecución.' : 'aws iam put-role-policy … con codebuild:StartBuild y codebuild:BatchGetBuilds');
  if (approval) push('Aprobar (manual)', true, 'La canalización espera a que alguien apruebe: es una pausa, no un fallo.', 'aws codepipeline put-approval-result … --token <token>', !approved);
  push('Desplegar (CloudFormation)', caps, 'InsufficientCapabilitiesException: requires CAPABILITY_AUTO_EXPAND.', 'Añade Capabilities: CAPABILITY_IAM,CAPABILITY_AUTO_EXPAND a la acción y haz update-pipeline.');
  const colorOf = (s: SState) => (s === 'ok' ? colors.green : s === 'fail' ? colors.rose : s === 'wait' ? colors.amber : colors.dim);
  const icon = (s: SState) => (s === 'ok' ? '✓' : s === 'fail' ? '✖' : s === 'wait' ? '⏸' : '·');
  const badIdx = stages.findIndex((s) => s.state === 'fail' || s.state === 'wait');
  const bad = badIdx >= 0 ? stages[badIdx] : undefined;
  const reachedBad = bad !== undefined && i >= badIdx;
  const done = i >= n - 1;
  const reset = () => go(0);
  return (
    <Frame>
      <Toggle label="El bucket de origen tiene versiones" on={ver} set={(v) => { setVer(v); reset(); }} good="on" />
      <Toggle label="El rol de la canalización puede lanzar CodeBuild" on={perm} set={(v) => { setPerm(v); reset(); }} good="on" />
      <Toggle label="Las pruebas del código pasan" on={tests} set={(v) => { setTests(v); reset(); }} good="on" />
      <Toggle label="Hay una etapa de aprobación manual" on={approval} set={(v) => { setApproval(v); reset(); }} />
      {approval ? <Toggle label="Alguien ha aprobado" on={approved} set={(v) => { setApproved(v); reset(); }} good="on" /> : null}
      <Toggle label="La acción de CloudFormation lleva Capabilities" on={caps} set={(v) => { setCaps(v); reset(); }} good="on" />
      <StepBar i={i} n={n} go={go} auto={auto} toggle={toggle} color={a} hint label={`Ejecución · etapa ${i + 1} de ${n}`} />
      {stages.map((s, k) => {
        const shown = k <= i;
        return (
          <Box key={s.name} title={`${shown ? icon(s.state) : '·'} ${s.name}`} color={shown ? colorOf(s.state) : undefined} dim={!shown}>
            {shown && s.state === 'skip' ? <Mono color={colors.dim}>no llega a ejecutarse</Mono> : null}
          </Box>
        );
      })}
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Pill text={reachedBad ? (bad?.state === 'wait' ? 'Ejecución: InProgress (esperando)' : 'Ejecución: Failed') : done && !bad ? 'Ejecución: Succeeded' : 'Ejecución: InProgress'} color={reachedBad ? (bad?.state === 'wait' ? colors.amber : colors.rose) : done && !bad ? colors.green : colors.amber} solid />
      </View>
      <Explain k={`${ver}${perm}${tests}${approval}${approved}${caps}${i}`} title={reachedBad ? (bad?.state === 'wait' ? 'Parada a propósito' : 'Dónde se corta') : done && !bad ? '✓ Publicado' : 'En marcha…'} color={reachedBad ? (bad?.state === 'wait' ? colors.amber : colors.rose) : done && !bad ? colors.green : a}>
        {reachedBad && bad
          ? `${bad.msg} → ${bad.fix}`
          : done && !bad
            ? 'Origen, compilación y despliegue en orden. Cada cambio nuevo en el origen vuelve a lanzar la canalización entera.'
            : 'Avanza paso a paso con ▶. Cambia los interruptores para ver cómo se rompe cada etapa y qué comando la arregla.'}
      </Explain>
    </Frame>
  );
}

// ───────────────────────── Estrategias de despliegue: reparto de tráfico ─────────────────────────

const STRATS = [
  { id: 'all', label: 'De golpe', share: (t: number) => (t >= 1 ? 100 : 0), note: 'Todo el tráfico pasa a la versión nueva en el primer minuto.' },
  { id: 'canary', label: 'Canario', share: (t: number) => (t >= 5 ? 100 : t >= 1 ? 10 : 0), note: 'Un 10 % durante 5 minutos; si todo va bien, el resto.' },
  { id: 'linear', label: 'Lineal', share: (t: number) => Math.min(100, Math.max(0, t) * 10), note: '+10 % cada minuto hasta llegar al 100 %.' },
  { id: 'bg', label: 'Azul/verde', share: (t: number) => (t >= 4 ? 100 : 0), note: 'El entorno verde se prepara y se prueba en paralelo; luego se cambia todo el tráfico de una vez.' },
];
const ERR = 0.5; // la versión nueva falla en la mitad de sus peticiones
const THRESHOLD = 2; // % de errores global que hace saltar la alarma

export function DeployShift() {
  const [sid, setSid] = useState('canary');
  const [broken, setBroken] = useState(true);
  const [alarm, setAlarm] = useState(true);
  const [t, setT] = useState(6);
  const { a } = awsHue();
  const s = STRATS.find((x) => x.id === sid)!;
  // el reparto sin vuelta atrás, minuto a minuto
  const raw = (m: number) => s.share(m);
  let rollbackAt = -1;
  if (broken && alarm) {
    for (let m = 0; m <= 10; m++) {
      if (raw(m) * ERR >= THRESHOLD) {
        rollbackAt = m + 1; // la alarma salta un minuto después de ver los errores
        break;
      }
    }
  }
  const share = (m: number) => (rollbackAt >= 0 && m >= rollbackAt ? 0 : raw(m));
  let failed = 0;
  for (let m = 0; m <= t; m++) failed += broken ? share(m) * ERR * 10 : 0; // por cada 1.000 peticiones por minuto
  const v2 = share(t);
  const rolled = rollbackAt >= 0 && t >= rollbackAt;
  const errNow = broken ? v2 * ERR : 0;
  return (
    <Frame>
      <T v="label" color={colors.dim}>Estrategia</T>
      <Tabs color={a} value={sid} onChange={setSid} items={STRATS.map((x) => ({ id: x.id, label: x.label }))} />
      <Toggle label="La versión nueva falla (la mitad de sus peticiones)" on={broken} set={setBroken} good="off" />
      <Toggle label="Alarma de errores conectada al despliegue (retroceso automático)" on={alarm} set={setAlarm} good="on" />
      <T v="label" color={colors.dim}>{`Minuto del despliegue: ${t} de 10`}</T>
      <Slider min={0} max={10} value={t} onChange={setT} color={a} label="Minuto del despliegue" />
      <Box title="🚦 Reparto del tráfico">
        <View style={{ gap: 3 }}>
          <Mono>{`v1 (estable) · ${100 - v2} %`}</Mono>
          <View style={{ height: 12, borderRadius: radius.pill, backgroundColor: colors.line, overflow: 'hidden', flexDirection: 'row' }}>
            <View style={{ width: `${100 - v2}%`, height: 12, backgroundColor: colors.green }} />
            <View style={{ width: `${v2}%`, height: 12, backgroundColor: broken ? colors.rose : a }} />
          </View>
          <Mono>{`v2 (nueva) · ${v2} %`}</Mono>
        </View>
      </Box>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Pill text={`errores ahora: ${errNow.toFixed(1)} %`} color={errNow >= THRESHOLD ? colors.rose : colors.green} />
        <Pill text={`fallidas: ${Math.round(failed)} de ${(t + 1) * 1000}`} color={failed > 100 ? colors.rose : failed > 0 ? colors.amber : colors.green} solid />
        {rolled ? <Pill text="↩ retroceso automático" color={colors.amber} solid /> : null}
      </View>
      <Explain k={`${sid}${broken}${alarm}${t}`} title={rolled ? '↩ La alarma devolvió el tráfico' : broken && !alarm && v2 > 0 ? '⚠ Nadie lo detiene' : '✓ Despliegue sano'} color={rolled ? colors.amber : broken && !alarm && v2 > 0 ? colors.rose : a}>
        {s.note}{' '}
        {rolled
          ? `Los errores llegaron al ${THRESHOLD} % del total y la alarma detuvo el despliegue: v1 recupera el 100 % del tráfico y solo fallaron ${Math.round(failed)} de ${(t + 1) * 1000} peticiones (con 1.000 por minuto).`
          : broken && !alarm && v2 > 0
            ? 'Sin alarma el fallo sigue creciendo con el reparto. Un despliegue gradual solo protege si algo mide el daño y reacciona.'
            : broken
              ? 'Aún no ha llegado tráfico a la versión nueva.'
              : 'Sin fallos, la estrategia solo cambia la velocidad con la que llega la versión nueva.'}
      </Explain>
    </Frame>
  );
}

# Curso de AWS — plan

> Estado: **propuesta** (aún sin implementar). Mismo formato que Linux, Python y SQL: zonas × 5 lecciones, misión final y examen por zona, laboratorio, biblioteca e ilustraciones animadas. Los códigos de examen, los precios y los límites de AWS cambian: cada lección llevará su fecha de revisión y se contrastará con la documentación oficial al escribirla.

## Objetivo

Enseñar AWS **desde cero hasta nivel experto**, practicando de verdad sin cuenta ni tarjeta: un **simulador de AWS escrito en TypeScript** (como el intérprete de Python y el motor de SQL) donde los retos se corrigen mirando **cómo queda la cuenta simulada**. Alineado con la ruta oficial de certificaciones:

| Nivel del curso | Zonas | Equivale a |
| --- | --- | --- |
| 🥉 Básico · «Fundamentos» | 1–7 | Cloud Practitioner |
| 🥈 Intermedio · «Arquitecto» | 8–15 | Solutions Architect Associate · Developer Associate · SysOps/CloudOps |
| 🥇 Avanzado · «Experto» | 16–20 | Solutions Architect Professional · DevOps Professional · Security / Advanced Networking / Data (especialidades) |

## Lo más importante (el 20 % que más rinde — se enseña primero y se vuelve a repasar)

1. **Responsabilidad compartida**: qué protege AWS y qué proteges tú.
2. **IAM**: root + MFA, mínimo privilegio, roles en vez de claves, leer una política JSON y saber si **permite o deniega**.
3. **VPC y seguridad de red**: subredes públicas/privadas, tablas de rutas, security groups frente a NACL, «¿llega el paquete?».
4. **S3 sin sustos**: Block Public Access, cifrado, versionado, ciclo de vida.
5. **Alta disponibilidad**: multi-AZ, balanceador, Auto Scaling, sin puntos únicos de fallo.
6. **Costes**: presupuestos y alarmas el día 1, modelos de compra, transferencia de datos, cómo apagar lo que no usas.
7. **Copias de seguridad y recuperación ante desastres**: RTO/RPO y las 4 estrategias.
8. **Observabilidad y auditoría**: CloudWatch, CloudTrail, Config.
9. **Serverless y desacoplar**: Lambda, SQS/SNS/EventBridge, DynamoDB.
10. **Well-Architected**: los 6 pilares como forma de razonar cualquier arquitectura.

## Zonas y lecciones

### 🥉 Básico — Fundamentos

**Z1 ☁️ Hola, nube** · 1 ¿Qué es la nube? (IaaS/PaaS/SaaS, CapEx→OpEx, elasticidad) · 2 La infraestructura global: Regiones, zonas de disponibilidad, edge locations · 3 Responsabilidad compartida · 4 Tu cuenta: consola, CLI, SDK, Free Tier y alarma de facturación · 5 Cómo elegir una región (latencia, cumplimiento, precio, servicios)

**Z2 🔐 Identidad y acceso (IAM)** · 1 El usuario root y los primeros pasos seguros (MFA) · 2 Usuarios, grupos y políticas · 3 Leer y escribir políticas JSON (Effect, Action, Resource, Condition) · 4 Roles y credenciales temporales (STS) · 5 Mínimo privilegio y buenas prácticas (Access Analyzer, Identity Center)

**Z3 🖥️ Cómputo: EC2** · 1 Tu primera instancia (AMI, tipo, par de claves) · 2 Familias de instancias y cómo elegir · 3 Discos: EBS frente a instance store · 4 Security groups, IP elástica y user data · 5 Modelos de compra (on-demand, reservadas, Savings Plans, Spot)

**Z4 🪣 Almacenamiento: S3 y compañía** · 1 Buckets y objetos · 2 Clases de almacenamiento y ciclo de vida (Glacier) · 3 Seguridad en S3 (políticas, ACL, Block Public Access, cifrado, URLs prefirmadas) · 4 Versionado, replicación y web estática · 5 EBS, EFS, FSx y Storage Gateway: cuál usar

**Z5 🌐 Redes: VPC básico** · 1 IP, CIDR y subredes (con calculadora) · 2 VPC, subredes públicas/privadas e Internet Gateway · 3 Tablas de rutas y NAT · 4 Security groups frente a NACL («¿llega el paquete?») · 5 DNS con Route 53 y CloudFront de un vistazo

**Z6 🗄️ Bases de datos** · 1 SQL frente a NoSQL y servicios gestionados · 2 RDS y Aurora (Multi-AZ, copias, réplicas) · 3 DynamoDB básico · 4 ElastiCache, Redshift, Neptune, DocumentDB: casos de uso · 5 Elegir la base de datos adecuada (escenarios)

**Z7 💰 Costes, facturación y soporte** · 1 Cómo se cobra (pay-as-you-go, transferencia de datos) · 2 Calculadora de precios, Cost Explorer y Budgets · 3 Etiquetas, Organizations y facturación consolidada · 4 Planes de soporte y Trusted Advisor · 5 **Simulacro Cloud Practitioner** (por dominios)

### 🥈 Intermedio — Arquitecto

**Z8 ⚖️ Alta disponibilidad y escalado** · 1 ELB: ALB, NLB, GWLB · 2 Auto Scaling (políticas, enfriamiento, health checks) · 3 Multi-AZ y diseño sin punto único de fallo · 4 Route 53 avanzado (latencia, failover, ponderado, geolocalización) · 5 CloudFront y Global Accelerator

**Z9 🕸️ VPC avanzada y conectividad** · 1 Peering y Transit Gateway · 2 Endpoints: gateway, interface y PrivateLink · 3 VPN y Direct Connect · 4 Flow Logs y Reachability Analyzer: diagnosticar «no conecta» · 5 Acceso seguro a instancias (Session Manager, bastión) e IPv6

**Z10 ⚡ Serverless** · 1 Lambda: eventos, memoria, timeouts, concurrencia · 2 API Gateway + Lambda + DynamoDB · 3 SQS y SNS: desacoplar · 4 EventBridge y Step Functions · 5 Cognito y seguridad en serverless

**Z11 📊 Datos a fondo** · 1 DynamoDB: claves, GSI/LSI, capacidad · 2 DynamoDB: streams, TTL, transacciones, DAX, tablas globales · 3 RDS/Aurora a fondo (réplicas de lectura, RDS Proxy, Aurora Serverless) · 4 Caché y patrones (cache-aside, write-through) · 5 Migración: DMS, Snow, DataSync

**Z12 🏗️ Infraestructura como código y CI/CD** · 1 CloudFormation (plantillas, parámetros, salidas) · 2 Stacks, change sets, deriva y StackSets · 3 CDK y SAM · 4 CodePipeline, CodeBuild, CodeDeploy · 5 Estrategias de despliegue (blue/green, canary, rolling) y Elastic Beanstalk

**Z13 📦 Contenedores** · 1 Contenedores en 10 minutos y ECR · 2 ECS: tareas, servicios, clústeres · 3 Fargate frente a EC2 · 4 EKS y Kubernetes en AWS (visión) · 5 App Runner, escalado y observabilidad

**Z14 🔭 Observabilidad y operaciones** · 1 CloudWatch: métricas y alarmas · 2 Logs e Insights · 3 CloudTrail y Config: «¿quién cambió qué?» · 4 Systems Manager (Parameter Store, Patch Manager, Run Command) · 5 X-Ray, EventBridge y automatización de respuestas

**Z15 🛡️ Seguridad en profundidad** · 1 KMS y cifrado (en reposo, en tránsito, envelope encryption) · 2 Secrets Manager y ACM · 3 WAF, Shield y DDoS · 4 GuardDuty, Inspector, Macie, Security Hub · 5 Organizations, SCP y Control Tower

### 🥇 Avanzado — Experto

**Z16 🏛️ Well-Architected y resiliencia** · 1 Los 6 pilares · 2 RTO/RPO y estrategias de DR (backup/restore, pilot light, warm standby, multi-site) · 3 Multi-región: Aurora Global, tablas globales, Route 53 ARC · 4 Pruebas de resiliencia (FIS), cuotas y límites · 5 Revisiones de arquitectura con casos reales

**Z17 🏢 Multi-cuenta y redes a escala** · 1 Landing zone y estrategia de cuentas · 2 Transit Gateway a escala y Cloud WAN · 3 Inspección centralizada, salida a Internet, DNS híbrido · 4 IAM avanzado: permission boundaries, ABAC, acceso entre cuentas · 5 Gobierno, cumplimiento y auditoría continua

**Z18 🌊 Datos y analítica** · 1 Data lake en S3 · 2 Glue, Athena, Lake Formation · 3 Kinesis, MSK y streaming · 4 Redshift, EMR, OpenSearch · 5 QuickSight y patrones de arquitectura de datos

**Z19 🤖 IA en AWS** · 1 Servicios de IA listos para usar (Rekognition, Textract, Comprehend, Transcribe…) · 2 Amazon Bedrock: modelos fundacionales, prompts, guardrails · 3 RAG con bases de conocimiento y vectores · 4 SageMaker: entrenar, desplegar, MLOps · 5 Seguridad, coste y responsabilidad en IA

**Z20 🚀 Optimización y arquitecturas de referencia** · 1 FinOps (Savings Plans, rightsizing, Spot, Graviton) · 2 Rendimiento (caché, CDN, edge, almacenamiento adecuado) · 3 Proyecto: web de tres capas · 4 Proyecto: serverless dirigido por eventos · 5 **Simulacro Solutions Architect** + entrevista de arquitectura (jefe final)

## El simulador de AWS (lo que hace especial al curso)

Un motor en `src/awsengine/` con una **cuenta simulada** (regiones, zonas, recursos, relaciones) y varios modos de práctica:

| Herramienta | Qué practicas | Cómo se corrige |
| --- | --- | --- |
| **Evaluador de políticas IAM** | Escribir/leer JSON; ver la traza «Allow explícito → Deny explícito → denegado por defecto» con SCP, boundaries y políticas de recurso | Casos de prueba: «esta acción, ¿permitida o denegada?» |
| **CLI simulada** (`aws s3 …`, `aws ec2 …`, `--query`) | Los comandos reales y su salida JSON | Estado final de la cuenta |
| **Consola guiada** | Asistentes paso a paso (crear bucket, lanzar instancia, regla de SG…) | Estado final de la cuenta |
| **Arquitecto visual** | Arrastrar servicios (VPC, subredes, EC2, RDS, ELB…) y conectarlos | Reglas: ¿multi-AZ?, ¿la base de datos es privada?, ¿cumple el coste? |
| **Trazador de paquetes** | «¿Llega A a B?»: rutas, SG, NACL, NAT, peering | Diagnóstico: qué regla falta |
| **Simulaciones con controles** | Auto Scaling bajo carga, capacidad de DynamoDB, visibilidad en SQS, failover Multi-AZ | Objetivos de disponibilidad/coste |
| **Lambda real** | Escribir el *handler* en Python y probarlo con eventos (reutiliza el intérprete de Python de la app) | Salida del handler |
| **CloudFormation** | Escribir YAML/JSON (Ref, GetAtt, Sub) y ver qué recursos crea | Recursos resultantes |
| **Calculadora de costes** | Estimar con unos precios ilustrativos y elegir la opción más barata que cumpla | Importe por debajo de X |
| **Escenarios de examen** | «La empresa necesita… al menor coste» (elige 1 o 2) | Respuesta + por qué las demás fallan |

## Biblioteca e ilustraciones

- **~300 fichas** (servicio / concepto): qué es, **cuándo usarlo y cuándo NO**, límites típicos, cómo se cobra (en palabras), alternativas parecidas («S3 frente a EFS frente a EBS») y un ejemplo ejecutable en el simulador.
- **~40 ilustraciones animadas**: regiones/AZ/edge, responsabilidad compartida, evaluación de políticas, camino de un paquete por la VPC, ELB + Auto Scaling, clases de S3, evento → Lambda, cola SQS con DLQ, failover Multi-AZ, estrategias de DR, CloudFront, DynamoDB (partición), etc.

## Gamificación específica

- **Medidor de preparación** por certificación y por dominio del examen (con los pesos oficiales).
- **Simulacros cronometrados** (Cloud Practitioner, Solutions Architect) con revisión de fallos.
- Logros por servicio dominado, «cuenta limpia» (no dejar recursos encendidos en el lab), «presupuesto intacto».
- Modo **«Rompe y arregla»**: una cuenta con fallos (bucket público, SG abierto, sin MFA) que hay que corregir.

## Entregas por fases (cada una se publica sin APK nuevo)

1. **Fase A — Cimientos** ✅: simulador (cuenta, IAM, S3, EC2, CLI) + Z1–Z4.
2. **Fase B — Básico completo** ✅: VPC/trazador de paquetes, bases de datos, calculadora de costes + Z5–Z7 y simulacro Cloud Practitioner.
3. **Fase C — Intermedio** (en curso): Z8 ✅ HA y escalado · Z9 ✅ VPC avanzada y conectividad · Z10 ✅ Serverless · Z11 ✅ Datos a fondo · Z12 ✅ IaC y CI/CD · Z13 ✅ Contenedores · Z14 ✅ Observabilidad y operaciones · Z15 (seguridad en profundidad).
4. **Fase D — Avanzado**: Z16–Z20, proyectos y simulacro Solutions Architect.

## Riesgos y decisiones

- **AWS cambia a menudo** (servicios, precios, límites, versiones de examen): precios solo ilustrativos, fecha de revisión en cada lección y contraste con la documentación oficial al escribirla.
- **El simulador no es la nube real**: se incluirán guías de laboratorios reales **opcionales** con Free Tier y una lista de «apaga esto para no pagar». La app **nunca** pedirá claves reales de AWS.
- **Alcance**: es mayor que SQL (más servicios, menos «ejecutar código»); por eso las fases.
- Los nombres de los servicios se dejan en inglés (es lo que verás en la consola y en el examen); las explicaciones, en español.

## Preguntas abiertas

1. ¿Certificación objetivo principal (Cloud Practitioner → Solutions Architect Associate, o directo a otra: Developer, DevOps, Seguridad, Datos)?
2. ¿Más peso en **arquitectura** (decisiones y diseño) o en **práctica con CLI/IaC** (comandos y plantillas)?
3. ¿Empezamos por la Fase A?

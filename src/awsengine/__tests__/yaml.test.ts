import { parseTemplate } from '../yaml';

describe('lector de plantillas YAML/JSON', () => {
  test('JSON tal cual', () => {
    expect(parseTemplate('{"Resources":{"B":{"Type":"AWS::S3::Bucket"}}}')).toEqual({ Resources: { B: { Type: 'AWS::S3::Bucket' } } });
    expect(() => parseTemplate('{"a":')).toThrow('JSON');
  });

  test('mapas, listas, escalares y comentarios', () => {
    const t = parseTemplate(`
# una plantilla
AWSTemplateFormatVersion: 2010-09-09
Description: "Tienda: pruebas"   # comentario
Parameters:
  Entorno:
    Type: String
    Default: dev
    AllowedValues: [dev, prod]
  Tam:
    Type: Number
    Default: 3
Resources:
  Cola:
    Type: AWS::SQS::Queue
    Properties:
      VisibilityTimeout: 30
      Activa: true
      Etiquetas:
        - Key: a
          Value: 'it''s'
        - Key: b
          Value: "x\\ty"
      Vacia:
`);
    expect(t).toEqual({
      AWSTemplateFormatVersion: '2010-09-09',
      Description: 'Tienda: pruebas',
      Parameters: { Entorno: { Type: 'String', Default: 'dev', AllowedValues: ['dev', 'prod'] }, Tam: { Type: 'Number', Default: 3 } },
      Resources: { Cola: { Type: 'AWS::SQS::Queue', Properties: { VisibilityTimeout: 30, Activa: true, Etiquetas: [{ Key: 'a', Value: "it's" }, { Key: 'b', Value: 'x\ty' }], Vacia: null } } },
    });
  });

  test('etiquetas cortas de CloudFormation', () => {
    const t = parseTemplate(`
Resources:
  Tabla:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: !Sub "\${AWS::StackName}-datos"
      Otro: !Ref Entorno
      Arn: !GetAtt Cola.Arn
      Lista: !Join
        - ','
        - - a
          - !Ref B
      En: !If [EsProd, 1, 2]
      Mapa: !FindInMap [Regiones, !Ref 'AWS::Region', Ami]
      Texto: !Sub |
        linea \${A}
        linea 2
Outputs:
  Salida:
    Value: !GetAtt [Cola, QueueName]
    Export:
      Name: !Sub '\${AWS::StackName}-cola'
`) as any;
    const p = t.Resources.Tabla.Properties;
    expect(p.TableName).toEqual({ 'Fn::Sub': '${AWS::StackName}-datos' });
    expect(p.Otro).toEqual({ Ref: 'Entorno' });
    expect(p.Arn).toEqual({ 'Fn::GetAtt': ['Cola', 'Arn'] });
    expect(p.Lista).toEqual({ 'Fn::Join': [',', ['a', { Ref: 'B' }]] });
    expect(p.En).toEqual({ 'Fn::If': ['EsProd', 1, 2] });
    expect(p.Mapa).toEqual({ 'Fn::FindInMap': ['Regiones', { Ref: 'AWS::Region' }, 'Ami'] });
    expect(p.Texto).toEqual({ 'Fn::Sub': 'linea ${A}\nlinea 2\n' });
    expect(t.Outputs.Salida.Value).toEqual({ 'Fn::GetAtt': ['Cola', 'QueueName'] });
    expect(t.Outputs.Salida.Export.Name).toEqual({ 'Fn::Sub': '${AWS::StackName}-cola' });
  });

  test('bloques de texto, listas al mismo nivel y listas en varias líneas', () => {
    const t = parseTemplate(`
Resources:
  F:
    Type: AWS::Lambda::Function
    Properties:
      Code:
        ZipFile: |
          def lambda_handler(event, context):
              return 1
      Handler: index.lambda_handler
      Policies:
      - A
      - B
      Largo: [uno,
        dos]
Conditions:
  EsProd: !Equals [!Ref Entorno, prod]
`) as any;
    expect(t.Resources.F.Properties.Code.ZipFile).toBe('def lambda_handler(event, context):\n    return 1\n');
    expect(t.Resources.F.Properties.Handler).toBe('index.lambda_handler');
    expect(t.Resources.F.Properties.Policies).toEqual(['A', 'B']);
    expect(t.Resources.F.Properties.Largo).toEqual(['uno', 'dos']);
    expect(t.Conditions.EsProd).toEqual({ 'Fn::Equals': [{ Ref: 'Entorno' }, 'prod'] });
  });

  test('errores', () => {
    expect(() => parseTemplate('')).toThrow('vacía');
    expect(() => parseTemplate('Resources:\n\tA: 1')).toThrow('tabuladores');
    expect(() => parseTemplate('Resources:\n  A: !Raro x')).toThrow('Etiqueta');
    expect(() => parseTemplate('- a\n- b')).toThrow('mapa');
  });
});

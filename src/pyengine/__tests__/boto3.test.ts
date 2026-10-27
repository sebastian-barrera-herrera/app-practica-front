import { PySession } from '../session';
import { awsBridge } from '../stdlib/aws';

const run = (code: string) => new PySession().runSync(code);

afterEach(() => {
  awsBridge.call = null;
});

describe('boto3 en el intérprete', () => {
  test('sin credenciales (fuera de Lambda)', () => {
    const r = run('import boto3\ntry:\n    boto3.client("s3")\nexcept Exception as e:\n    print(type(e).__name__, e)');
    expect(r.stdout).toContain('NoCredentialsError Unable to locate credentials');
  });

  test('cliente genérico: parámetros, resultado y errores de servicio', () => {
    const calls: unknown[] = [];
    awsBridge.call = (service, op, params, region) => {
      calls.push([service, op, JSON.parse(params), region]);
      if (op === 'get-queue-url') return JSON.stringify({ __error: { Code: 'QueueDoesNotExist', Message: 'The specified queue does not exist.', Status: 400 } });
      return JSON.stringify({ QueueUrl: 'https://sqs/x' });
    };
    const r = run(`
import boto3
from botocore.exceptions import ClientError
sqs = boto3.client('sqs')
print(sqs.create_queue(QueueName='q')['QueueUrl'])
try:
    sqs.get_queue_url(QueueName='nada')
except ClientError as e:
    print(e.response['Error']['Code'], e.response['ResponseMetadata']['HTTPStatusCode'])
    print(e)
try:
    sqs.get_queue_url(QueueName='nada')
except sqs.exceptions.QueueDoesNotExist:
    print('específica')
`);
    expect(r.stdout).toContain('https://sqs/x');
    expect(r.stdout).toContain('QueueDoesNotExist 400');
    expect(r.stdout).toContain('An error occurred (QueueDoesNotExist) when calling the GetQueueUrl operation: The specified queue does not exist.');
    expect(r.stdout).toContain('específica');
    expect(calls[0]).toEqual(['sqs', 'create-queue', { QueueName: 'q' }, 'us-east-1']);
  });

  test('recurso Table de DynamoDB: tipos, Decimal y condiciones', () => {
    const calls: any[] = [];
    awsBridge.call = (_s, op, params) => {
      const p = JSON.parse(params);
      calls.push([op, p]);
      if (op === 'get-item') return JSON.stringify({ Item: { id: { S: 'a' }, n: { N: '3' }, tags: { L: [{ S: 'x' }] } } });
      if (op === 'query') return JSON.stringify({ Items: [{ id: { S: 'a' }, precio: { N: '9.5' } }], Count: 1 });
      return JSON.stringify({});
    };
    const r = run(`
import boto3, json
from decimal import Decimal
from boto3.dynamodb.conditions import Key, Attr
t = boto3.resource('dynamodb').Table('items')
t.put_item(Item={'id': 'a', 'n': 3, 'ok': True, 'precio': Decimal('9.5'), 'tags': ['x']})
try:
    t.put_item(Item={'id': 'b', 'precio': 9.5})
except TypeError as e:
    print('TypeError:', e)
it = t.get_item(Key={'id': 'a'})['Item']
print(it['n'], type(it['n']).__name__)
try:
    json.dumps(it)
except TypeError as e:
    print('json:', e)
q = t.query(KeyConditionExpression=Key('id').eq('a') & Key('sk').begins_with('x'), FilterExpression=Attr('precio').gt(Decimal('5')))
print(q['Count'], q['Items'][0]['precio'])
`);
    expect(r.stderr).toBe('');
    expect(r.stdout).toContain('TypeError: Float types are not supported. Use Decimal types instead.');
    expect(r.stdout).toContain('3 Decimal');
    expect(r.stdout).toContain('json: Object of type Decimal is not JSON serializable');
    expect(r.stdout).toContain('1 9.5');
    expect(calls[0][1].Item).toEqual({ id: { S: 'a' }, n: { N: '3' }, ok: { BOOL: true }, precio: { N: '9.5' }, tags: { L: [{ S: 'x' }] } });
    const qy = calls.find((c) => c[0] === 'query')[1];
    expect(qy.KeyConditionExpression).toMatch(/^\(#c\d+ = :c\d+ AND begins_with\(#c\d+, :c\d+_0\)\)$/);
    expect(Object.values(qy.ExpressionAttributeNames)).toEqual(['id', 'sk', 'precio']);
    expect(Object.values(qy.ExpressionAttributeValues)).toEqual([{ S: 'a' }, { S: 'x' }, { N: '5' }]);
  });
});

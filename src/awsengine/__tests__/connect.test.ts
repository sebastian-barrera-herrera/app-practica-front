import { Terminal } from '../../engine/terminal';
import { mkEnv, type TestEnv } from './helpers';

/** Consulta de solo lectura del corrector (`_check …`), que necesita el modo «dios». */
async function chk(e: TestEnv, line: string) {
  e.io.god = true;
  try {
    return await e.json(`_check ${line}`);
  } finally {
    e.io.god = false;
  }
}

const id = async (e: TestEnv, q: string) => e.json(q);
const vpcOf = (e: TestEnv, n: string) => id(e, `ec2 describe-vpcs --filters Name=tag:Name,Values=${n} --query "Vpcs[0].VpcId"`);
const rtbOf = async (e: TestEnv, n: string) => id(e, `ec2 describe-route-tables --filters Name=vpc-id,Values=${await vpcOf(e, n)} --query "RouteTables[0].RouteTableId"`);
const sgOf = (e: TestEnv, n: string) => id(e, `ec2 describe-security-groups --filters Name=group-name,Values=${n} --query "SecurityGroups[0].GroupId"`);
const instOf = (e: TestEnv, n: string) => id(e, `ec2 describe-instances --filters Name=tag:Name,Values=${n} --query "Reservations[0].Instances[0].InstanceId"`);

describe('Peering', () => {
  test('de cero: pedir, aceptar, rutas en los dos lados y security group', async () => {
    const e = mkEnv({ scenario: 'net-peering' });
    const [app, datos] = [await vpcOf(e, 'app'), await vpcOf(e, 'datos')];
    let t = await chk(e, 'trace --from app-1 --to db-1 --port 3306');
    expect(t.Reachable).toBe(false);
    expect(t.Code).toBe('NO_ROUTE_TO_DESTINATION');
    const pcx = (await e.json(`ec2 create-vpc-peering-connection --vpc-id ${app} --peer-vpc-id ${datos}`)).VpcPeeringConnection;
    expect(pcx.Status.Code).toBe('pending-acceptance');
    // mientras no se acepte, no se puede enrutar hacia él
    const early = await e.run(`ec2 create-route --route-table-id ${await rtbOf(e, 'app')} --destination-cidr-block 10.1.0.0/16 --vpc-peering-connection-id ${pcx.VpcPeeringConnectionId}`);
    expect(early.stderr).toContain('Accept it first');
    t = await chk(e, 'trace --from app-1 --to db-1 --port 3306');
    expect(t.Reachable).toBe(false);
    await e.run(`ec2 accept-vpc-peering-connection --vpc-peering-connection-id ${pcx.VpcPeeringConnectionId}`);
    expect(await e.json(`ec2 describe-vpc-peering-connections --query "VpcPeeringConnections[0].Status.Code"`)).toBe('active');
    await e.run(`ec2 create-route --route-table-id ${await rtbOf(e, 'app')} --destination-cidr-block 10.1.0.0/16 --vpc-peering-connection-id ${pcx.VpcPeeringConnectionId}`);
    // la ida ya existe, falta el grupo de seguridad
    t = await chk(e, 'trace --from app-1 --to db-1 --port 3306');
    expect(t.Blocker).toBe('sg');
    await e.run(`ec2 authorize-security-group-ingress --group-id ${await sgOf(e, 'db-sg')} --protocol tcp --port 3306 --cidr 10.0.0.0/16`);
    // y falta la ruta de vuelta
    t = await chk(e, 'trace --from app-1 --to db-1 --port 3306');
    expect(t.Reachable).toBe(false);
    expect(t.Hops.join('\n')).toContain('Ruta de vuelta');
    await e.run(`ec2 create-route --route-table-id ${await rtbOf(e, 'datos')} --destination-cidr-block 10.0.0.0/16 --vpc-peering-connection-id ${pcx.VpcPeeringConnectionId}`);
    t = await chk(e, 'trace --from app-1 --to db-1 --port 3306');
    expect(t.Reachable).toBe(true);
  });

  test('CIDR solapados, mismo par duplicado y rutas en agujero negro', async () => {
    const e = mkEnv({ scenario: 'net-peering' });
    const app = await vpcOf(e, 'app');
    const dup = (await e.json('ec2 create-vpc --cidr-block 10.0.0.0/16')).Vpc.VpcId;
    expect((await e.run(`ec2 create-vpc-peering-connection --vpc-id ${app} --peer-vpc-id ${dup}`)).stderr).toContain('overlapping CIDR');
    const datos = await vpcOf(e, 'datos');
    const pcx = (await e.json(`ec2 create-vpc-peering-connection --vpc-id ${app} --peer-vpc-id ${datos}`)).VpcPeeringConnection.VpcPeeringConnectionId;
    expect((await e.run(`ec2 create-vpc-peering-connection --vpc-id ${datos} --peer-vpc-id ${app}`)).stderr).toContain('VpcPeeringConnectionAlreadyExists');
    await e.run(`ec2 accept-vpc-peering-connection --vpc-peering-connection-id ${pcx}`);
    const rtb = await rtbOf(e, 'app');
    await e.run(`ec2 create-route --route-table-id ${rtb} --destination-cidr-block 10.1.0.0/16 --vpc-peering-connection-id ${pcx}`);
    expect(await e.json(`ec2 describe-route-tables --route-table-ids ${rtb} --query "RouteTables[0].Routes[?DestinationCidrBlock=='10.1.0.0/16'].State | [0]"`)).toBe('active');
    await e.run(`ec2 delete-vpc-peering-connection --vpc-peering-connection-id ${pcx}`);
    expect(await e.json(`ec2 describe-route-tables --route-table-ids ${rtb} --query "RouteTables[0].Routes[?DestinationCidrBlock=='10.1.0.0/16'].State | [0]"`)).toBe('blackhole');
  });

  test('escenario roto: la ida funciona y la vuelta no', async () => {
    const e = mkEnv({ scenario: 'net-peering-roto' });
    const t = await chk(e, 'trace --from app-1 --to db-1 --port 3306');
    expect(t.Reachable).toBe(false);
    expect(t.Why).toContain('ruta de vuelta');
    const pcx = await e.json('ec2 describe-vpc-peering-connections --query "VpcPeeringConnections[0].VpcPeeringConnectionId"');
    await e.run(`ec2 create-route --route-table-id ${await rtbOf(e, 'datos')} --destination-cidr-block 10.0.0.0/16 --vpc-peering-connection-id ${pcx}`);
    expect((await chk(e, 'trace --from app-1 --to db-1 --port 3306')).Reachable).toBe(true);
  });
});

describe('Transit Gateway', () => {
  test('tres VPC por un TGW: adjuntar, rutas y espera', async () => {
    const e = mkEnv({ scenario: 'net-tgw' });
    const g = (await e.json('ec2 create-transit-gateway --description central')).TransitGateway;
    expect(g.State).toBe('pending');
    const first = await e.run(`ec2 create-transit-gateway-vpc-attachment --transit-gateway-id ${g.TransitGatewayId} --vpc-id ${await vpcOf(e, 'app')} --subnet-ids ${await id(e, 'ec2 describe-subnets --filters Name=tag:Name,Values=app-sub --query "Subnets[0].SubnetId"')}`);
    expect(first.stderr).toContain('not available yet');
    e.acct.clock += 70000;
    for (const n of ['app', 'datos', 'herramientas']) {
      const sub = await id(e, `ec2 describe-subnets --filters Name=tag:Name,Values=${n}-sub --query "Subnets[0].SubnetId"`);
      await e.run(`ec2 create-transit-gateway-vpc-attachment --transit-gateway-id ${g.TransitGatewayId} --vpc-id ${await vpcOf(e, n)} --subnet-ids ${sub}`);
    }
    e.acct.clock += 40000;
    expect(await e.json('ec2 describe-transit-gateway-vpc-attachments --query "TransitGatewayVpcAttachments[].State"')).toEqual(['available', 'available', 'available']);
    // sin rutas en las VPC no hay camino
    expect((await chk(e, 'trace --from app-1 --to db-1 --port 3306')).Reachable).toBe(false);
    for (const n of ['app', 'datos', 'herramientas']) await e.run(`ec2 create-route --route-table-id ${await rtbOf(e, n)} --destination-cidr-block 10.0.0.0/8 --transit-gateway-id ${g.TransitGatewayId}`);
    expect((await chk(e, 'trace --from app-1 --to db-1 --port 3306')).Reachable).toBe(true);
    expect((await chk(e, 'trace --from tools-1 --to app-1 --port 22')).Reachable).toBe(true);
    // la tabla por defecto propaga los tres CIDR
    const rt = await e.json('ec2 describe-transit-gateway-route-tables --query "TransitGatewayRouteTables[0].TransitGatewayRouteTableId"');
    const routes = await e.json(`ec2 search-transit-gateway-routes --transit-gateway-route-table-id ${rt} --filters Name=type,Values=propagated --query "Routes[].DestinationCidrBlock"`);
    expect(routes.sort()).toEqual(['10.0.0.0/16', '10.1.0.0/16', '10.2.0.0/16']);
  });

  test('segmentación: dos tablas de rutas aíslan unas redes de otras', async () => {
    const e = mkEnv({ scenario: 'net-tgw-adjuntas' });
    const g = await e.json('ec2 describe-transit-gateways --query "TransitGateways[0].TransitGatewayId"');
    for (const n of ['app', 'datos', 'herramientas']) await e.run(`ec2 create-route --route-table-id ${await rtbOf(e, n)} --destination-cidr-block 10.0.0.0/8 --transit-gateway-id ${g}`);
    expect((await chk(e, 'trace --from app-1 --to db-1 --port 3306')).Reachable).toBe(true);
    const att = await e.json('ec2 describe-transit-gateway-vpc-attachments --query "TransitGatewayVpcAttachments[].[VpcId,TransitGatewayAttachmentId]"');
    const byVpc: Record<string, string> = {};
    for (const n of ['app', 'datos', 'herramientas']) {
      const v = await vpcOf(e, n);
      byVpc[n] = att.find((x: string[]) => x[0] === v)![1];
    }
    // patrón «servicios compartidos»: app y datos (radios) solo ven a herramientas (centro) y no se ven entre ellos
    const aislada = (await e.json(`ec2 create-transit-gateway-route-table --transit-gateway-id ${g}`)).TransitGatewayRouteTable.TransitGatewayRouteTableId;
    const def = await e.json('ec2 describe-transit-gateway-route-tables --query "TransitGatewayRouteTables[?DefaultAssociationRouteTable].TransitGatewayRouteTableId | [0]"');
    expect((await e.run(`ec2 associate-transit-gateway-route-table --transit-gateway-route-table-id ${aislada} --transit-gateway-attachment-id ${byVpc.app}`)).stderr).toContain('already associated');
    for (const n of ['app', 'datos']) {
      await e.run(`ec2 disassociate-transit-gateway-route-table --transit-gateway-route-table-id ${def} --transit-gateway-attachment-id ${byVpc[n]}`);
      await e.run(`ec2 associate-transit-gateway-route-table --transit-gateway-route-table-id ${aislada} --transit-gateway-attachment-id ${byVpc[n]}`);
    }
    await e.run(`ec2 enable-transit-gateway-route-table-propagation --transit-gateway-route-table-id ${aislada} --transit-gateway-attachment-id ${byVpc.herramientas}`);
    expect((await chk(e, 'trace --from app-1 --to db-1 --port 3306')).Reachable).toBe(false);
    expect((await chk(e, 'trace --from db-1 --to app-1 --port 22')).Reachable).toBe(false);
    expect((await chk(e, 'trace --from app-1 --to tools-1 --port 22')).Reachable).toBe(true);
    expect((await chk(e, 'trace --from tools-1 --to db-1 --port 22')).Reachable).toBe(true);
    // si herramientas dejara de propagar en la tabla por defecto, las respuestas no volverían
    await e.run(`ec2 disable-transit-gateway-route-table-propagation --transit-gateway-route-table-id ${def} --transit-gateway-attachment-id ${byVpc.app}`);
    const noBack = await chk(e, 'trace --from tools-1 --to app-1 --port 22');
    expect(noBack.Reachable).toBe(false);
    expect(noBack.Code).toBe('TRANSIT_GATEWAY_ROUTE_MISSING');
  });
});

describe('Endpoints', () => {
  test('endpoint de puerta de enlace (S3): sin él no hay camino, con él, ruta de lista de prefijos', async () => {
    const e = mkEnv({ scenario: 'net-endpoints' });
    expect((await chk(e, 'trace --from app-priv --to vpce:s3 --port 443')).Reachable).toBe(false);
    expect((await chk(e, 'trace --from app-priv --to internet --port 443')).Reachable).toBe(false);
    const vpc = await vpcOf(e, 'tienda');
    const rtb = await rtbOf(e, 'tienda');
    // un endpoint de puerta de enlace sin tablas de rutas no sirve
    expect((await e.run(`ec2 create-vpc-endpoint --vpc-id ${vpc} --service-name com.amazonaws.us-east-1.s3`)).stderr).toContain('route table');
    const ep = (await e.json(`ec2 create-vpc-endpoint --vpc-id ${vpc} --service-name com.amazonaws.us-east-1.s3 --route-table-ids ${rtb}`)).VpcEndpoint;
    expect(ep.VpcEndpointType).toBe('Gateway');
    const routes = await e.json(`ec2 describe-route-tables --route-table-ids ${rtb} --query "RouteTables[0].Routes[?GatewayId=='${ep.VpcEndpointId}'].DestinationPrefixListId"`);
    expect(routes[0]).toMatch(/^pl-/);
    expect((await chk(e, 'trace --from app-priv --to vpce:s3 --port 443')).Reachable).toBe(true);
    // sigue sin internet
    expect((await chk(e, 'trace --from app-priv --to internet --port 443')).Reachable).toBe(false);
    await e.run(`ec2 delete-vpc-endpoints --vpc-endpoint-ids ${ep.VpcEndpointId}`);
    expect((await chk(e, 'trace --from app-priv --to vpce:s3 --port 443')).Reachable).toBe(false);
  });

  test('endpoint de interfaz: el security group del endpoint manda', async () => {
    const e = mkEnv({ scenario: 'net-endpoints-sg' });
    const t = await chk(e, 'trace --from app-priv --to vpce:sqs --port 443');
    expect(t.Reachable).toBe(false);
    expect(t.Blocker).toBe('sg');
    await e.run(`ec2 authorize-security-group-ingress --group-id ${await sgOf(e, 'endpoint-sg')} --protocol tcp --port 443 --cidr 10.0.0.0/16`);
    expect((await chk(e, 'trace --from app-priv --to vpce:sqs --port 443')).Reachable).toBe(true);
    const eni = await e.json('ec2 describe-network-interfaces --filters Name=description,Values="VPC Endpoint Interface*" --query "NetworkInterfaces[].InterfaceType"');
    expect(eni).toEqual(['vpc_endpoint']);
  });

  test('PrivateLink: publicar un servicio y consumirlo', async () => {
    const e = mkEnv({ scenario: 'net-endpoints' });
    const sub0 = await id(e, 'ec2 describe-subnets --filters Name=tag:Name,Values=tienda-sub --query "Subnets[0].SubnetId"');
    const nlb = await e.json(`elbv2 create-load-balancer --name api-nlb --type network --scheme internal --subnets ${sub0} --query "LoadBalancers[0].LoadBalancerArn"`);
    const svc = await e.run(`ec2 create-vpc-endpoint-service-configuration --network-load-balancer-arns ${nlb} --acceptance-required`);
    expect(svc.code).toBe(0);
    const name = JSON.parse(svc.stdout).ServiceConfiguration.ServiceName as string;
    expect(name).toMatch(/^com\.amazonaws\.vpce\.us-east-1\.vpce-svc-/);
    const vpc = await vpcOf(e, 'tienda');
    const sub = await id(e, 'ec2 describe-subnets --query "Subnets[?VpcId==\'' + vpc + '\'].SubnetId | [0]"');
    const ep = (await e.json(`ec2 create-vpc-endpoint --vpc-id ${vpc} --vpc-endpoint-type Interface --service-name ${name} --subnet-ids ${sub}`)).VpcEndpoint;
    expect(ep.State).toBe('pendingAcceptance');
  });
});

describe('VPN', () => {
  test('puerta del cliente + puerta privada virtual + conexión: túneles y rutas', async () => {
    const e = mkEnv({ scenario: 'net-vpn' });
    expect((await e.run('ec2 create-customer-gateway --type ipsec.1 --public-ip 192.168.1.1 --bgp-asn 65000')).stderr).toContain('private');
    const cgw = (await e.json('ec2 create-customer-gateway --type ipsec.1 --public-ip 203.0.113.50 --bgp-asn 65000')).CustomerGateway.CustomerGatewayId;
    const vgw = (await e.json('ec2 create-vpn-gateway --type ipsec.1')).VpnGateway.VpnGatewayId;
    await e.run(`ec2 attach-vpn-gateway --vpn-gateway-id ${vgw} --vpc-id ${await vpcOf(e, 'tienda')}`);
    const vpn = (await e.json(`ec2 create-vpn-connection --type ipsec.1 --customer-gateway-id ${cgw} --vpn-gateway-id ${vgw} --options StaticRoutesOnly=true`)).VpnConnection;
    expect(vpn.VgwTelemetry.map((x: any) => x.Status)).toEqual(['DOWN', 'DOWN']);
    expect(vpn.VgwTelemetry[0].StatusMessage).toBe('No static routes configured');
    await e.run(`ec2 create-vpn-connection-route --vpn-connection-id ${vpn.VpnConnectionId} --destination-cidr-block 192.168.0.0/16`);
    expect(await e.json(`ec2 describe-vpn-connections --query "VpnConnections[0].VgwTelemetry[].Status"`)).toEqual(['DOWN', 'DOWN']);
    e.acct.clock += 200000;
    expect(await e.json(`ec2 describe-vpn-connections --query "VpnConnections[0].VgwTelemetry[].Status"`)).toEqual(['UP', 'UP']);
    // sin propagación ni ruta, la respuesta no vuelve; con propagación, aparece la ruta
    expect((await chk(e, 'trace --from onprem --to app-priv --port 22')).Reachable).toBe(false);
    await e.run(`ec2 enable-vgw-route-propagation --gateway-id ${vgw} --route-table-id ${await rtbOf(e, 'tienda')}`);
    expect(await e.json(`ec2 describe-route-tables --query "RouteTables[].Routes[?GatewayId=='${vgw}'][].[DestinationCidrBlock,Origin]"`)).toEqual([['192.168.0.0/16', 'EnableVgwRoutePropagation']]);
    // el security group aún no admite la oficina
    expect((await chk(e, 'trace --from onprem --to app-priv --port 22')).Blocker).toBe('sg');
    await e.run(`ec2 authorize-security-group-ingress --group-id ${await sgOf(e, 'app-sg')} --protocol tcp --port 22 --cidr 192.168.0.0/16`);
    expect((await chk(e, 'trace --from onprem --to app-priv --port 22')).Reachable).toBe(true);
    // y de la instancia a la oficina
    expect((await chk(e, 'trace --from app-priv --to onprem --port 22')).Reachable).toBe(true);
  });

  test('túneles todavía caídos: el camino desde la oficina falla por la VPN', async () => {
    const e = mkEnv({ scenario: 'net-vpn' });
    const cgw = (await e.json('ec2 create-customer-gateway --type ipsec.1 --public-ip 203.0.113.50 --bgp-asn 65000')).CustomerGateway.CustomerGatewayId;
    const vgw = (await e.json('ec2 create-vpn-gateway --type ipsec.1')).VpnGateway.VpnGatewayId;
    await e.run(`ec2 attach-vpn-gateway --vpn-gateway-id ${vgw} --vpc-id ${await vpcOf(e, 'tienda')}`);
    await e.run(`ec2 create-vpn-connection --type ipsec.1 --customer-gateway-id ${cgw} --vpn-gateway-id ${vgw}`);
    await e.run(`ec2 enable-vgw-route-propagation --gateway-id ${vgw} --route-table-id ${await rtbOf(e, 'tienda')}`);
    await e.run(`ec2 authorize-security-group-ingress --group-id ${await sgOf(e, 'app-sg')} --protocol tcp --port 22 --cidr 192.168.0.0/16`);
    const t = await chk(e, 'trace --from onprem --to app-priv --port 22');
    expect(t.Reachable).toBe(false);
    expect(t.Code).toBe('VPN_TUNNEL_DOWN');
    e.acct.clock += 200000;
    expect((await chk(e, 'trace --from onprem --to app-priv --port 22')).Reachable).toBe(true);
  });

  test('VPN dinámica (BGP): anuncia sola la red de la oficina', async () => {
    const e = mkEnv({ scenario: 'net-vpn-rota' });
    const t = await chk(e, 'trace --from onprem --to app-priv --port 22');
    expect(t.Reachable).toBe(false);
    expect(t.Blocker).toBe('route');
    const vgw = await e.json('ec2 describe-vpn-gateways --query "VpnGateways[0].VpnGatewayId"');
    await e.run(`ec2 enable-vgw-route-propagation --gateway-id ${vgw} --route-table-id ${await rtbOf(e, 'tienda')}`);
    await e.run(`ec2 authorize-security-group-ingress --group-id ${await sgOf(e, 'app-sg')} --protocol tcp --port 22 --cidr 192.168.0.0/16`);
    expect((await chk(e, 'trace --from onprem --to app-priv --port 22')).Reachable).toBe(true);
  });

  test('VPN conectada a un Transit Gateway: aparece como adjunto', async () => {
    const e = mkEnv({ scenario: 'net-tgw-adjuntas' });
    const g = await e.json('ec2 describe-transit-gateways --query "TransitGateways[0].TransitGatewayId"');
    const cgw = (await e.json('ec2 create-customer-gateway --type ipsec.1 --public-ip 203.0.113.50 --bgp-asn 65000')).CustomerGateway.CustomerGatewayId;
    await e.run(`ec2 create-vpn-connection --type ipsec.1 --customer-gateway-id ${cgw} --transit-gateway-id ${g}`);
    expect(await e.json('ec2 describe-transit-gateway-attachments --query "TransitGatewayAttachments[].ResourceType"')).toContain('vpn');
    const rt = await e.json('ec2 describe-transit-gateway-route-tables --query "TransitGatewayRouteTables[0].TransitGatewayRouteTableId"');
    expect(await e.json(`ec2 search-transit-gateway-routes --transit-gateway-route-table-id ${rt} --filters Name=type,Values=propagated --query "Routes[].DestinationCidrBlock"`)).toContain('192.168.0.0/16');
    for (const n of ['app', 'datos', 'herramientas']) await e.run(`ec2 create-route --route-table-id ${await rtbOf(e, n)} --destination-cidr-block 192.168.0.0/16 --transit-gateway-id ${g}`);
    // túneles todavía no activos
    expect((await chk(e, 'trace --from db-1 --to onprem --port 22')).Reachable).toBe(false);
    e.acct.clock += 200000;
    expect((await chk(e, 'trace --from db-1 --to onprem --port 22')).Reachable).toBe(true);
  });

  test('Direct Connect: ubicaciones y pedido', async () => {
    const e = mkEnv({ scenario: 'net-vpn' });
    expect((await e.json('directconnect describe-locations --query "locations[].locationCode"')).length).toBeGreaterThan(1);
    expect((await e.run('directconnect create-connection --location XX --bandwidth 1Gbps --connection-name sede')).stderr).toContain('Invalid location');
    const c = await e.json('directconnect create-connection --location EqDC2 --bandwidth 1Gbps --connection-name sede');
    expect(c.connectionState).toBe('ordering');
  });
});

describe('Flow Logs', () => {
  const FL = (e: TestEnv, vpc: string, role: string, extra = '') => e.run(`ec2 create-flow-logs --resource-type VPC --resource-ids ${vpc} --traffic-type ALL --log-group-name /vpc/tienda --deliver-logs-permission-arn ${role} ${extra}`);

  test('validaciones y la trampa del rol (Access error)', async () => {
    const e = mkEnv({ scenario: 'net-diag' });
    const vpc = await vpcOf(e, 'tienda');
    const role = await e.json('iam get-role --role-name flowlogs-role --query Role.Arn');
    expect((await e.run(`ec2 create-flow-logs --resource-type VPC --resource-ids ${vpc} --traffic-type ALL --log-group-name /vpc/tienda`)).stderr).toContain('DeliverLogsPermissionArn');
    expect((await e.run(`ec2 create-flow-logs --resource-type Subnet --resource-ids ${vpc} --traffic-type ALL --log-group-name x --deliver-logs-permission-arn ${role}`)).stdout).toContain('Unsuccessful');
    expect((await e.run(`ec2 create-flow-logs --resource-type VPC --resource-ids ${vpc} --traffic-type TODO --log-group-name x --deliver-logs-permission-arn ${role}`)).stderr).toContain('trafficType');
    const r1 = await FL(e, vpc, role);
    expect(r1.code).toBe(0);
    const fl = await e.json('ec2 describe-flow-logs --query "FlowLogs[0]"');
    expect(fl.DeliverLogsStatus).toBe('FAILED');
    expect(fl.DeliverLogsErrorMessage).toBe('Access error');
    // corregir la relación de confianza
    const trust = JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'vpc-flow-logs.amazonaws.com' }, Action: 'sts:AssumeRole' }] });
    e.write('trust.json', trust);
    await e.run('iam update-assume-role-policy --role-name flowlogs-role --policy-document file://trust.json');
    expect(await e.json('ec2 describe-flow-logs --query "FlowLogs[0].DeliverLogsStatus"')).toBe('SUCCESS');
  });

  test('el tráfico (aceptado y rechazado) llega al grupo de registros', async () => {
    const t = new Terminal({ instant: true, aws: 'net-diag' });
    const trust = JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'vpc-flow-logs.amazonaws.com' }, Action: 'sts:AssumeRole' }] });
    await t.exec(`echo '${trust}' > trust.json`);
    await t.exec('aws iam update-assume-role-policy --role-name flowlogs-role --policy-document file://trust.json');
    const vpc = (await t.exec('aws ec2 describe-vpcs --filters Name=tag:Name,Values=tienda --query "Vpcs[0].VpcId" --output text')).out.trim();
    const role = (await t.exec('aws iam get-role --role-name flowlogs-role --query Role.Arn --output text')).out.trim();
    await t.exec(`aws ec2 create-flow-logs --resource-type VPC --resource-ids ${vpc} --traffic-type ALL --log-group-name /vpc/tienda --deliver-logs-permission-arn ${role}`);
    const ip = (await t.exec('aws ec2 describe-instances --filters Name=tag:Name,Values=web --query "Reservations[0].Instances[0].PublicIpAddress" --output text')).out.trim();
    expect((await t.exec(`curl -sS http://${ip}/`)).out).toContain('Tienda');
    expect((await t.exec(`curl -sS -m 3 http://${ip}:8080/`)).status).not.toBe(0);
    const msgs = (await t.exec('aws logs filter-log-events --log-group-name /vpc/tienda --query "events[].message" --output text')).out;
    expect(msgs).toContain(' 80 6 ');
    expect(msgs).toContain('ACCEPT OK');
    // el puerto 8080 no lo permite ningún security group: REJECT
    const rej = (await t.exec('aws logs filter-log-events --log-group-name /vpc/tienda --filter-pattern REJECT --query "events[].message" --output text')).out;
    expect(rej).toContain(' 8080 6 ');
    // y se puede contar con herramientas de Linux
    const top = (await t.exec('aws logs filter-log-events --log-group-name /vpc/tienda/historico --filter-pattern ACCEPT --query "events[].message" --output text | tr "\\t" "\\n" | awk \'{print $4}\' | sort | uniq -c | sort -rn | head -1')).out;
    expect(top).toContain('198.51.100.23');
  });

  test('destino S3 y formato personalizado', async () => {
    const e = mkEnv({ scenario: 'net-diag' });
    await e.run('s3 mb s3://registros-red');
    const vpc = await vpcOf(e, 'tienda');
    const r = await e.run(`ec2 create-flow-logs --resource-type VPC --resource-ids ${vpc} --traffic-type REJECT --log-destination-type s3 --log-destination arn:aws:s3:::registros-red --log-format '\${srcaddr} \${dstport} \${action}'`);
    expect(r.code).toBe(0);
    expect(await e.json('ec2 describe-flow-logs --query "FlowLogs[0].DeliverLogsStatus"')).toBe('SUCCESS');
    expect((await e.run(`ec2 create-flow-logs --resource-type VPC --resource-ids ${vpc} --traffic-type ALL --log-destination-type s3 --log-destination arn:aws:s3:::registros-red --log-format '\${nada}'`)).stderr).toContain('Unknown field');
    const id = await e.json('ec2 describe-flow-logs --query "FlowLogs[0].FlowLogId"');
    await e.run(`ec2 delete-flow-logs --flow-log-ids ${id}`);
    expect(await e.json('ec2 describe-flow-logs --query "length(FlowLogs)"')).toBe(0);
  });
});

describe('Reachability Analyzer', () => {
  test('encuentra el security group que corta y confirma el arreglo', async () => {
    const e = mkEnv({ scenario: 'net-diag' });
    const [web, app] = [await instOf(e, 'web'), await instOf(e, 'app')];
    expect((await e.run(`ec2 create-network-insights-path --source ${web} --protocol icmp`)).stderr).toContain('protocol');
    const path = (await e.json(`ec2 create-network-insights-path --source ${web} --destination ${app} --protocol tcp --destination-port 8080`)).NetworkInsightsPath.NetworkInsightsPathId;
    expect(path).toMatch(/^nip-/);
    const an = (await e.json(`ec2 start-network-insights-analysis --network-insights-path-id ${path}`)).NetworkInsightsAnalysis;
    expect(an.NetworkPathFound).toBe(false);
    expect(an.Explanations[0].ExplanationCode).toBe('ENI_SG_RULES_MISMATCH');
    expect(an.Explanations[0].SecurityGroups[0].Id).toBe(await sgOf(e, 'app-sg'));
    await e.run(`ec2 authorize-security-group-ingress --group-id ${await sgOf(e, 'app-sg')} --protocol tcp --port 8080 --source-group ${await sgOf(e, 'web-sg')}`);
    const an2 = (await e.json(`ec2 start-network-insights-analysis --network-insights-path-id ${path}`)).NetworkInsightsAnalysis;
    expect(an2.NetworkPathFound).toBe(true);
    expect(an2.ForwardPathComponents.length).toBeGreaterThan(1);
    expect(await e.json('ec2 describe-network-insights-analyses --query "length(NetworkInsightsAnalyses)"')).toBe(2);
    await e.run(`ec2 delete-network-insights-path --network-insights-path-id ${path}`);
    expect(await e.json('ec2 describe-network-insights-analyses --query "length(NetworkInsightsAnalyses)"')).toBe(0);
  });

  test('NACL, rutas y desde internet', async () => {
    const e = mkEnv({ scenario: 'net-diag' });
    const web = await instOf(e, 'web');
    const igw = await e.json('ec2 describe-internet-gateways --query "InternetGateways[0].InternetGatewayId"');
    const path = (await e.json(`ec2 create-network-insights-path --source ${igw} --destination ${web} --protocol tcp --destination-port 80`)).NetworkInsightsPath.NetworkInsightsPathId;
    expect((await e.json(`ec2 start-network-insights-analysis --network-insights-path-id ${path}`)).NetworkInsightsAnalysis.NetworkPathFound).toBe(true);
    const p22 = (await e.json(`ec2 create-network-insights-path --source ${igw} --destination ${web} --protocol tcp --destination-port 9999`)).NetworkInsightsPath.NetworkInsightsPathId;
    const x = (await e.json(`ec2 start-network-insights-analysis --network-insights-path-id ${p22}`)).NetworkInsightsAnalysis;
    expect(x.NetworkPathFound).toBe(false);
    expect(x.Explanations[0].ExplanationCode).toBe('ENI_SG_RULES_MISMATCH');
    // destino IP de internet desde una instancia privada: no hay NAT
    const app = await instOf(e, 'app');
    const out = (await e.json(`ec2 create-network-insights-path --source ${app} --destination-ip 93.184.216.34 --protocol tcp --destination-port 443`)).NetworkInsightsPath.NetworkInsightsPathId;
    const y = (await e.json(`ec2 start-network-insights-analysis --network-insights-path-id ${out}`)).NetworkInsightsAnalysis;
    expect(y.NetworkPathFound).toBe(false);
    expect(y.Explanations[0].ExplanationCode).toBe('NO_ROUTE_TO_DESTINATION');
  });
});

describe('Systems Manager', () => {
  test('sin rol no hay administración; con rol y red, la instancia aparece y obedece', async () => {
    const e = mkEnv({ scenario: 'net-ssm-rol' });
    const i = await instOf(e, 'app-1');
    expect(await e.json('ssm describe-instance-information --query "length(InstanceInformationList)"')).toBe(0);
    expect((await e.run(`ssm send-command --document-name AWS-RunShellScript --instance-ids ${i} --parameters commands=hostname`)).stderr).toContain('InvalidInstanceId');
    expect((await chk(e, 'ssm --instance app-1')).Reason).toBe('no-profile');
    await e.run(`ec2 associate-iam-instance-profile --instance-id ${i} --iam-instance-profile Name=ssm-ec2`);
    expect((await e.run(`ec2 associate-iam-instance-profile --instance-id ${i} --iam-instance-profile Name=ssm-ec2`)).stderr).toContain('existing association');
    expect((await chk(e, 'ssm --instance app-1')).Online).toBe(true);
    // el agente tarda un par de minutos en registrarse tras asociar el rol
    expect(await e.json('ssm describe-instance-information --query "length(InstanceInformationList)"')).toBe(1);
    const cmd = (await e.json(`ssm send-command --document-name AWS-RunShellScript --instance-ids ${i} --parameters commands=hostname,"cat /var/www/html/index.html"`)).Command.CommandId;
    const out = await e.json(`ssm get-command-invocation --command-id ${cmd} --instance-id ${i}`);
    expect(out.Status).toBe('Success');
    expect(out.StandardOutputContent).toContain('ip-10-0-1-');
    expect(out.StandardOutputContent).toContain('<h1>Tienda</h1>');
    const bad = (await e.json(`ssm send-command --document-name AWS-RunShellScript --instance-ids ${i} --parameters commands=rm-rf`)).Command.CommandId;
    expect(await e.json(`ssm get-command-invocation --command-id ${bad} --instance-id ${i} --query ResponseCode`)).toBe(127);
    const s = await e.json(`ssm start-session --target ${i}`);
    expect(s.StreamUrl).toContain('ssmmessages');
    expect(await e.json('ssm describe-sessions --state Active --query "length(Sessions)"')).toBe(1);
    await e.run(`ssm terminate-session --session-id ${s.SessionId}`);
    expect(await e.json('ssm describe-sessions --state Active --query "length(Sessions)"')).toBe(0);
  });

  test('un rol sin la política de SSM o sin salida de red deja la instancia fuera', async () => {
    const e = mkEnv({ scenario: 'net-ssm-rol' });
    const i = await instOf(e, 'app-1');
    // rol sin permisos de SSM
    await e.run('iam detach-role-policy --role-name ssm-ec2 --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore');
    await e.run(`ec2 associate-iam-instance-profile --instance-id ${i} --iam-instance-profile Name=ssm-ec2`);
    expect((await chk(e, 'ssm --instance app-1')).Reason).toBe('no-permissions');
    await e.run('iam attach-role-policy --role-name ssm-ec2 --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore');
    expect((await chk(e, 'ssm --instance app-1')).Online).toBe(true);
    // quitar la ruta a internet: no llega al servicio
    const rtb = await rtbOf(e, 'tienda');
    await e.run(`ec2 delete-route --route-table-id ${rtb} --destination-cidr-block 0.0.0.0/0`);
    expect((await chk(e, 'ssm --instance app-1')).Reason).toBe('no-network');
    // con tres endpoints de interfaz y DNS privado vuelve, aunque no haya internet
    const vpc = await vpcOf(e, 'tienda');
    const sub = await id(e, 'ec2 describe-subnets --filters Name=tag:Name,Values=tienda-sub --query "Subnets[0].SubnetId"');
    const sg = (await e.json(`ec2 create-security-group --group-name vpce-sg --description x --vpc-id ${vpc}`)).GroupId;
    await e.run(`ec2 authorize-security-group-ingress --group-id ${sg} --protocol tcp --port 443 --cidr 10.0.0.0/16`);
    // el DNS privado del endpoint exige nombres de host DNS activados en la VPC
    expect((await e.run(`ec2 create-vpc-endpoint --vpc-id ${vpc} --vpc-endpoint-type Interface --service-name com.amazonaws.us-east-1.ssm --subnet-ids ${sub} --security-group-ids ${sg} --private-dns-enabled`)).stderr).toContain('enableDnsHostnames');
    await e.run(`ec2 modify-vpc-attribute --vpc-id ${vpc} --enable-dns-hostnames`);
    for (const s of ['ssm', 'ssmmessages', 'ec2messages']) await e.run(`ec2 create-vpc-endpoint --vpc-id ${vpc} --vpc-endpoint-type Interface --service-name com.amazonaws.us-east-1.${s} --subnet-ids ${sub} --security-group-ids ${sg} --private-dns-enabled`);
    expect((await chk(e, 'ssm --instance app-1')).Online).toBe(true);
  });
});

describe('IPv6', () => {
  test('bloque IPv6 de la VPC, de la subred y salida solo-IPv6', async () => {
    const e = mkEnv({ scenario: 'net-ipv6' });
    const vpc = await vpcOf(e, 'tienda');
    const a = await e.json(`ec2 associate-vpc-cidr-block --vpc-id ${vpc} --amazon-provided-ipv6-cidr-block`);
    expect(a.Ipv6CidrBlockAssociation.Ipv6CidrBlock).toMatch(/\/56$/);
    const priv = await id(e, 'ec2 describe-subnets --filters Name=tag:Name,Values=privada --query "Subnets[0].SubnetId"');
    const base = a.Ipv6CidrBlockAssociation.Ipv6CidrBlock.replace(/00::\/56$/, '');
    const ok = await e.run(`ec2 associate-subnet-cidr-block --subnet-id ${priv} --ipv6-cidr-block ${base}02::/64`);
    expect(ok.code).toBe(0);
    expect((await e.run(`ec2 associate-subnet-cidr-block --subnet-id ${priv} --ipv6-cidr-block ${base}03::/60`)).stderr).toContain('/64');
    expect(await e.json(`ec2 describe-subnets --subnet-ids ${priv} --query "Subnets[0].Ipv6CidrBlockAssociationSet[0].Ipv6CidrBlock"`)).toBe(`${base}02::/64`);
    const eigw = (await e.json(`ec2 create-egress-only-internet-gateway --vpc-id ${vpc}`)).EgressOnlyInternetGateway.EgressOnlyInternetGatewayId;
    const rtb = await e.json(`ec2 create-route-table --vpc-id ${vpc} --query RouteTable.RouteTableId`);
    await e.run(`ec2 associate-route-table --route-table-id ${rtb} --subnet-id ${priv}`);
    const r = await e.run(`ec2 create-route --route-table-id ${rtb} --destination-ipv6-cidr-block ::/0 --egress-only-internet-gateway-id ${eigw}`);
    expect(r.code).toBe(0);
    expect(await e.json(`ec2 describe-route-tables --route-table-ids ${rtb} --query "RouteTables[0].Routes[?DestinationIpv6CidrBlock=='::/0'].EgressOnlyInternetGatewayId | [0]"`)).toBe(eigw);
    // una puerta solo de salida no se puede usar con IPv4
    expect((await e.run(`ec2 create-route --route-table-id ${rtb} --destination-cidr-block 0.0.0.0/0 --egress-only-internet-gateway-id ${eigw}`)).code).not.toBe(0);
  });
});

describe('Misión final: la red de la empresa', () => {
  test('escenario base: todo desconectado', async () => {
    const e = mkEnv({ scenario: 'net-sede' });
    expect((await chk(e, 'trace --from app-prod --to dir-1 --port 389')).Reachable).toBe(false);
    expect((await chk(e, 'trace --from onprem --to app-prod --port 22')).Reachable).toBe(false);
    expect((await chk(e, 'ssm --instance app-prod')).Reason).toBe('no-profile');
  });
});

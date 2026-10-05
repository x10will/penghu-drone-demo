import { distanceKm, pathLengthKm } from './daily-simulation.mjs';
import {AIRCRAFT_CRUISE_KPH} from './aircraft-spec.mjs';

const compareId = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const priorityOf = order => ['urgent', 'emergency', 'high', '緊急'].includes(order.priority) ? 0
  : order.priority === 'island' ? 1 : 2;

// These times only select a vehicle. The engine computes the actual schedule,
// safe air routes, capacity, energy and cold-chain verdict independently.
export function proposeRulePlan(state, world) {
  const nodes = new Map(world.nodes.map(node => [node.id, node]));
  const depot = nodes.get(world.stock.nodeId);
  const service = world.fixture.plan.durationsMin;
  const routes = world.fixture.routes;
  const roadSpeed = routes.find(route => route.mode === 'road')?.speedKph ?? 20;
  const airSpeed = routes.find(route => route.mode === 'air')?.speedKph ?? AIRCRAFT_CRUISE_KPH;
  const slots = state.vehicles.map(vehicle => ({ vehicle, node: nodes.get(vehicle.baseNodeId), freeMin: world.startMin }));
  const notes = ['規則排程依優先順序、島別與估計空車抵達時間選車；路線、時間、冷鏈與能源由數位孿生驗證。'];

  function travelMin(type, from, to) {
    if (from.id === to.id) return 0;
    const route = routes.find(item => item.mode === (type === 'van' ? 'road' : 'air')
      && ((item.fromSiteId === from.id && item.toSiteId === to.id)
        || (item.fromSiteId === to.id && item.toSiteId === from.id)));
    const distance = route ? pathLengthKm(route.path) : distanceKm(from, to) * (type === 'van' ? 1.35 : 1);
    return distance / (route?.speedKph ?? (type === 'van' ? roadSpeed : airSpeed)) * 60;
  }

  function transferFor(island, near) {
    return world.nodes.filter(node => node.island === island && node.droneServable)
      .sort((a, b) => Number(b.kind === 'mock-transfer') - Number(a.kind === 'mock-transfer')
        || distanceKm(near, a) - distanceKm(near, b) || compareId(a.id, b.id))[0];
  }

  function chooseVehicle(type, from, order) {
    const massKg = order.doses * world.perDose.massKg;
    const volumeL = order.doses * world.perDose.volumeL;
    const candidates = slots.filter(slot => slot.vehicle.type === type && slot.node
      && (type !== 'van' || slot.node.island === from.island))
      .map(slot => ({ slot,
        usable: slot.vehicle.capacityKg >= massKg && slot.vehicle.capacityL >= volumeL
          && slot.vehicle.energyWh > slot.vehicle.reserveWh,
        readyMin: slot.freeMin + travelMin(type, slot.node, from), distance: distanceKm(slot.node, from) }))
      .sort((a, b) => Number(b.usable) - Number(a.usable) || a.readyMin - b.readyMin
        || a.distance - b.distance || compareId(a.slot.vehicle.id, b.slot.vehicle.id));
    const chosen = candidates[0];
    if (chosen && !chosen.usable) notes.push(`${order.id}：${chosen.slot.vehicle.id} 的容量或起始能源不足，保留路段交由引擎判定。`);
    return chosen;
  }

  const orders = [...state.orders].sort((a, b) => priorityOf(a) - priorityOf(b)
    || Number(nodes.get(b.destinationNodeId)?.island !== depot?.island)
      - Number(nodes.get(a.destinationNodeId)?.island !== depot?.island)
    || a.deadlineMin - b.deadlineMin || compareId(a.id, b.id));
  if (orders.filter(order => nodes.get(order.destinationNodeId)?.island !== depot?.island).length
      > slots.filter(slot => slot.vehicle.type === 'drone').length)
    notes.push('多筆跨島訂單共用無人機，需要空機調度；冬季可飛窗口與能源由引擎判定。若不可行，可在馬公模擬轉運點新增 D-02 無人機，分別承運吉貝與七美。');

  const assignments = orders.map(order => {
    const legs = [];
    const destination = nodes.get(order.destinationNodeId);
    if (!depot || !destination) {
      notes.push(`${order.id}：找不到${!depot ? '批次起點' : `目的地 ${order.destinationNodeId}`}，保留未排路段的訂單供引擎驗證。`);
      return { orderId: order.id, legs };
    }
    const crossIsland = destination.island !== depot.island;
    let cargoReadyMin = world.stock.releaseMin + (crossIsland ? service.packQimei : service.packMagong);

    function addLeg(type, from, to, final = false) {
      const chosen = chooseVehicle(type, from, order);
      if (!chosen) {
        notes.push(`${order.id}：${from.island}缺少可用${type === 'van' ? '配送車' : '無人機'}，保留已排路段供引擎驗證。`);
        return false;
      }
      const loadMin = legs.length === 0 ? (crossIsland ? service.loadQimei : service.loadMagong) : 0;
      const arrivalMin = Math.max(cargoReadyMin, chosen.readyMin) + loadMin + travelMin(type, from, to);
      legs.push({ vehicleId: chosen.slot.vehicle.id, from: from.id, to: to.id });
      const handlingMin = final ? (crossIsland ? service.receiveQimei : service.receiveMagong)
        : (to.island === depot.island ? service.handoverOrigin : service.handoverQimei);
      cargoReadyMin = arrivalMin + handlingMin;
      chosen.slot.node = to;
      chosen.slot.freeMin = cargoReadyMin;
      return true;
    }

    if (!crossIsland) {
      addLeg('van', depot, destination, true);
    } else if ((state.risk?.events ?? []).some(event => event.kind === 'gust'
      && nodes.get(event.nodeId)?.island === destination.island)) {
      // A direct candidate can avoid a localized strong-wind transfer pad.
      // Its entire route remains subject to the engine's calibrated risk field.
      notes.push(`${order.id}：目的島有陣風事件，改從冷庫直飛${destination.label ?? destination.name}，省去轉運交接；航線與可行性由引擎判定。`);
      addLeg('drone', depot, destination, true);
    } else {
      const originTransfer = transferFor(depot.island, depot);
      const destinationTransfer = destination.droneServable ? destination : transferFor(destination.island, destination);
      if (!originTransfer || !destinationTransfer) {
        notes.push(`${order.id}：${!originTransfer ? depot.island : destination.island}缺少無人機轉運節點，保留未排路段的訂單供引擎驗證。`);
      } else if (addLeg('van', depot, originTransfer)
        && addLeg('drone', originTransfer, destinationTransfer, destination.droneServable)) {
        if (!destination.droneServable) addLeg('van', destinationTransfer, destination, true);
      }
    }
    return { orderId: order.id, legs };
  });

  return { assignments, notes_zh: notes.join('\n'), mode: 'rule', modeLabel: '規則排程（非 AI）' };
}

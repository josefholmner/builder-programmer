export const bounds = { width: 9.6, height: 5.25, limit: 30 }
export const actuatorColor = '#ffdc57'
export const maxMotorForce = 5000
export const parts = {
  beam:   { width: 3, height: 0.55, color: '#ffb35e', shape: 'box' },
  block:  { width: 1, height: 1, color: '#ef8d4d', shape: 'box' },
  wedge:  { width: 1.5, height: 1, color: '#f4a354', shape: 'triangle' },
  plate: { width: 2, height: 0.26, color: '#ffc180', shape: 'box' },
  strut: { width: 0.36, height: 2.25, color: '#efa26c', shape: 'box' },
  ball: { width: 0.9, height: 0.9, color: '#f7a973', shape: 'circle' },
  wheel: { width: 1.4, height: 1.4, color: actuatorColor, shape: 'circle', joint: 'revolute', drive: true, defaultForce: 500 },
  hinge: { width: 0.7, height: 0.7, color: actuatorColor, shape: 'circle', joint: 'revolute', defaultForce: 1000 },
  piston: { width: 0.5, height: 0.24, color: actuatorColor, shape: 'capsule', joint: 'prismatic', limits: [-0.45, 1.5], defaultForce: 250 },
  treadWheel: { width: 2.1, height: 2.1, color: actuatorColor, shape: 'circle', joint: 'revolute', drive: true,
    friction: 1.9, maxSpeed: 22, defaultForce: 850 },
  servo: { width: 0.78, height: 0.78, color: actuatorColor, shape: 'circle', joint: 'revolute',
    limits: [-Math.PI / 3, Math.PI / 3], maxSpeed: 12, defaultForce: 650 },
  ram: { width: 0.7, height: 0.3, color: actuatorColor, shape: 'capsule', joint: 'prismatic',
    limits: [-0.35, 2.7], maxSpeed: 5, defaultForce: 550 }
}

export const levels = [
  { id: 'flat', finish: 30, points: [[-12, 0], [40, 0]], sky: '#172b3c', land: '#344e49' },
  { id: 'step', finish: 30, points: [[-12, 0], [14, 0], [14, 2.3], [40, 2.3]], sky: '#222c46', land: '#4b435a' },
  { id: 'pit', finish: 36, points: [[-12, 0], [15, 0], [15, -2.6], [19.6, -2.6], [19.6, 0], [46, 0]], sky: '#342a42', land: '#675049' },
  { id: 'ridgeRun', finish: 42, points: [[-12, 0], [11, 0], [19, 2.1], [22, 2.1], [27, 0.8], [35, 2.4], [52, 2.4]],
    sky: '#27334c', land: '#4e6159' },
  { id: 'terraces', finish: 42, points: [[-12, 0], [12, 0], [12, 0.35], [17, 0.35], [17, 0.73], [22, 0.73],
    [22, 1.51], [28, 1.51], [31, 0.4], [35, 0.4], [35, 0.85], [52, 0.85]], sky: '#3e3042', land: '#785951' },
  { id: 'canal', finish: 49, points: [[-12, 0], [13, 0], [16, -1.25], [22, -1.25], [25, 0.6], [30, 0.6],
    [33, -0.85], [39, -0.85], [42, 0.9], [59, 0.9]], sky: '#1e3b48', land: '#335953' }
]

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
export const uid = () => crypto.randomUUID()
export const isMotor = part => Boolean(parts[part.type]?.joint) && part.parent !== null
export const isDriveWheel = part => Boolean(parts[part.type]?.drive)
export const isRotaryMount = part => parts[part.type]?.joint === 'revolute' && !isDriveWheel(part)

export function motorForce(part) {
  return Number.isFinite(part.maxForce) ? clamp(part.maxForce, 0, maxMotorForce) : parts[part.type].defaultForce
}

export function blankMachine() {
  return { name: '', parts: [], nodes: [{ id: uid(), type: 'start', x: 35, y: 55 }], links: {} }
}

export function starterMachine() {
  return {
    name: '',
    parts: [
      { id: 'chassis', type: 'beam', parent: null, x: 0, y: 0.65 },
      { id: 'rear', type: 'wheel', parent: 'chassis', x: -1.16, y: 0 },
      { id: 'front', type: 'wheel', parent: 'chassis', x: 1.16, y: 0 },
      { id: 'cab', type: 'block', parent: 'chassis', x: 0.35, y: 1.3 }
    ],
    nodes: [
      { id: 'start', type: 'start', x: 35, y: 55 },
      { id: 'delay', type: 'delay', value: 0.3, x: 235, y: 55 },
      { id: 'drive', type: 'speed', target: '*', value: 8, x: 435, y: 55 }
    ],
    links: { start: 'delay', delay: 'drive' }
  }
}

export function partName(part, machine, t) {
  const siblings = machine.parts.filter(candidate => candidate.type === part.type)
  return t(part.type) + (siblings.length > 1 ? ' ' + (siblings.indexOf(part) + 1) : '')
}

export function placePart(machine, type, x, y, selected) {
  const shape = parts[type]
  if (!shape || machine.parts.length >= bounds.limit) return
  const parent = selected ?? machine.parts[0]?.id ?? null
  if (!parent && shape.joint) return
  const part = { id: uid(), type, parent, ...buildPosition(type, x, y, true) }
  machine.parts.push(part)
  return part
}

export function buildPosition(type, x, y, snap = false) {
  const { width, height, shape } = parts[type]
  const xLimit = (bounds.width - width) / 2
  const yLimit = (bounds.height - (shape === 'capsule' ? width : height)) / 2
  return {
    x: clamp(snap ? Math.round(x * 4) / 4 : x, -xLimit, xLimit),
    y: clamp(snap ? Math.round(y * 4) / 4 : y, -yLimit, yLimit)
  }
}

export function fitsBuildArea(part) {
  const { x, y } = buildPosition(part.type, part.x, part.y)
  return part.x === x && part.y === y
}

export function removePart(machine, id) {
  const removed = new Set([id])
  for (const part of machine.parts) {
    if (removed.has(part.parent)) removed.add(part.id)
  }
  machine.parts = machine.parts.filter(part => !removed.has(part.id))
  for (const node of machine.nodes) {
    if (removed.has(node.target)) node.target = ''
  }
}

export function terrainY(level, x) {
  const previous = level.points.findLast(point => point[0] <= x)
  const next = level.points.find(point => point[0] > x)
  if (!previous || !next) return (previous ?? next)[1]
  return previous[1] + (next[1] - previous[1]) * (x - previous[0]) / (next[0] - previous[0])
}

export function localVertices(part) {
  const { width, height, shape } = parts[part.type]
  const x = width / 2
  const y = height / 2
  return shape === 'triangle' ? [[-x, -y], [x, -y], [-x, y]] : [[-x, -y], [x, -y], [x, y], [-x, y]]
}

export function pistonAngle(part, parent) {
  return parent ? Math.atan2(part.y - parent.y, part.x - parent.x) : 0
}

export function capsuleSize(part) {
  const { width, height } = parts[part.type]
  return { halfLength: (width - height) / 2, radius: height / 2 }
}

export function capsuleExtents(part, angle) {
  const { halfLength, radius } = capsuleSize(part)
  return { x: radius + halfLength * Math.abs(Math.cos(angle)), y: radius + halfLength * Math.abs(Math.sin(angle)) }
}

export function leftEdge(part, x, angle) {
  const shape = parts[part.type]
  if (shape.shape === 'circle') return x - shape.width / 2
  if (shape.shape === 'capsule') return x - capsuleExtents(part, angle).x
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  return x + Math.min(...localVertices(part).map(([px, py]) => px * cosine - py * sine))
}

export function createProgram(machine, command) {
  const nodes = new Map(machine.nodes.map(node => [node.id, node]))
  const motors = machine.parts.filter(isMotor)
  let current = machine.nodes.find(node => node.type === 'start')
  let due = 0
  let waiting = false
  let stalled = false
  return {
    step(time) {
      if (stalled) return { active: current.id, stalled }
      // A delayed loop can run indefinitely. Stop a cycle with no delay before it hangs a frame.
      const seen = new Set()
      while (current && time + 1e-8 >= due) {
        if (current.type === 'delay' && !waiting && current.value > 0) {
          due = time + current.value
          waiting = true
          return { active: current.id, stalled: false }
        }
        if (seen.has(current.id)) {
          stalled = true
          return { active: current.id, stalled }
        }
        seen.add(current.id)
        waiting = false
        if (current.type === 'speed' || current.type === 'position') {
          for (const motor of motors) {
            if (current.target === motor.id || (current.target === '*' && isDriveWheel(motor))) {
              command(motor, current.type, Number(current.value) || 0)
            }
          }
        }
        current = nodes.get(machine.links[current.id])
      }
      return { active: current?.id, stalled: false }
    }
  }
}

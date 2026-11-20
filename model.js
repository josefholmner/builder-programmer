export const bounds = { width: 9.6, height: 5.25, limit: 30 }
export const actuatorColor = '#ffdc57'
export const maxMotorForce = 5000
export const parts = {
  beam:   { width: 3, height: 0.55, color: '#ffb35e', shape: 'box' },
  block:  { width: 1, height: 1, color: '#82d8f6', shape: 'box' },
  wedge:  { width: 1.5, height: 1, color: '#ff9ba9', shape: 'triangle' },
  plate: { width: 2, height: 0.26, color: '#a9e4b0', shape: 'box' },
  strut: { width: 0.36, height: 2.25, color: '#c3aefe', shape: 'box' },
  ball: { width: 0.9, height: 0.9, color: '#ffbb82', shape: 'circle' },
  blob: { width: 0.9, height: 0.9, color: '#f477b5', shape: 'circle', friction: 3.8, grip: true },
  wheel: { width: 1.32, height: 1.32, color: actuatorColor, shape: 'circle', joint: 'revolute', drive: true, defaultForce: 500 },
  hinge: { width: 0.7, height: 0.7, color: actuatorColor, shape: 'circle', joint: 'revolute', defaultForce: 1000 },
  piston: { width: 0.5, height: 0.24, color: actuatorColor, shape: 'capsule', joint: 'prismatic', limits: [-0.45, 1.5], defaultForce: 250 },
  treadWheel: { width: 2.1, height: 2.1, color: actuatorColor, shape: 'circle', joint: 'revolute', drive: true,
    friction: 1.9, maxSpeed: 22, defaultForce: 850, legacy: true },
  servo: { width: 0.78, height: 0.78, color: actuatorColor, shape: 'circle', joint: 'revolute',
    limits: [-Math.PI / 3, Math.PI / 3], maxSpeed: 12, defaultForce: 650 },
  ram: { width: 0.7, height: 0.3, color: actuatorColor, shape: 'capsule', joint: 'prismatic',
    limits: [-0.35, 2.7], maxSpeed: 5, defaultForce: 550 }
}

export const levels = [
  { id: 'flat', finish: 30, points: [[-12, 0], [40, 0]], sky: '#a5e4ff', hills: ['#cbeed3', '#a7dcb6'], land: '#81be82', verge: '#e9fa9a' },
  { id: 'step', finish: 30, points: [[-12, 0], [14, 0], [14, 2.3], [40, 2.3]], sky: '#bfcfff', hills: ['#ded6fa', '#c8b5eb'], land: '#b28bc5', verge: '#ffe3b2' },
  { id: 'pit', finish: 36, points: [[-12, 0], [15, 0], [15, -2.6], [19.6, -2.6], [19.6, 0], [46, 0]], sky: '#ffd7bc', hills: ['#ffeab7', '#f6b896'], land: '#d29576', verge: '#fff1ae' },
  { id: 'ridgeRun', finish: 42, points: [[-12, 0], [11, 0], [19, 2.1], [22, 2.1], [27, 0.8], [35, 2.4], [52, 2.4]],
    sky: '#b3dcff', hills: ['#cce8ef', '#a4cfcf'], land: '#72ad9d', verge: '#e4f7b0' },
  { id: 'terraces', finish: 42, points: [[-12, 0], [12, 0], [12, 0.35], [17, 0.35], [17, 0.73], [22, 0.73],
    [22, 1.51], [28, 1.51], [31, 0.4], [35, 0.4], [35, 0.85], [52, 0.85]], sky: '#fbd4ea', hills: ['#fce6d6', '#ecbedb'], land: '#ce92b1', verge: '#fff0bb' },
  { id: 'canal', finish: 49, points: [[-12, 0], [13, 0], [16, -1.25], [22, -1.25], [25, 0.6], [30, 0.6],
    [33, -0.85], [39, -0.85], [42, 0.9], [59, 0.9]], sky: '#9de9e6', hills: ['#caefda', '#9edcbf'], land: '#6cbba8', verge: '#e3faac' }
]

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
export const uid = () => crypto.randomUUID()
export const buildAngle = part => (part.turns ?? 0) * Math.PI / 2
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

export function placePart(machine, type, x, y, selected, turns = 0) {
  const shape = parts[type]
  if (!shape || shape.legacy || machine.parts.length >= bounds.limit) return
  const parent = selected ?? machine.parts[0]?.id ?? null
  if (!parent && shape.joint) return
  const orientation = shape.joint ? 0 : turns
  const part = { id: uid(), type, parent, ...buildPosition(type, x, y, true, orientation) }
  if (orientation) part.turns = orientation
  machine.parts.push(part)
  return part
}

export function buildSize(type, turns = 0) {
  const { width, height } = parts[type]
  return turns % 2 ? { width: height, height: width } : { width, height }
}

export function buildPosition(type, x, y, snap = false, turns = 0) {
  const { width, height } = buildSize(type, turns)
  const xLimit = (bounds.width - width) / 2
  const yLimit = (bounds.height - (parts[type].shape === 'capsule' ? width : height)) / 2
  return {
    x: clamp(snap ? Math.round(x * 4) / 4 : x, -xLimit, xLimit),
    y: clamp(snap ? Math.round(y * 4) / 4 : y, -yLimit, yLimit)
  }
}

export function fitsBuildArea(part) {
  const { x, y } = buildPosition(part.type, part.x, part.y, false, part.turns)
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

export const isLoop = node => node.type === 'for' || node.type === 'while'
export const completionPort = id => id + ':done'
export const sourceNodeId = port => port.endsWith(':done') ? port.slice(0, -5) : port
export const loopParameter = {
  for: { default: 3, max: 10000, step: 1 },
  while: { default: 5, max: 90, step: 'any' }
}

export function copyProgramNodes(machine, selected) {
  const nodes = machine.nodes.filter(node => node.type !== 'start' && selected.has(node.id))
  const ids = new Set(nodes.map(node => node.id))
  const links = Object.entries(machine.links).filter(([from, to]) => ids.has(sourceNodeId(from)) && ids.has(to))
  return structuredClone({ nodes, links })
}

export function pasteProgramNodes(machine, clipboard, x, y) {
  const left = Math.min(...clipboard.nodes.map(node => node.x))
  const top = Math.min(...clipboard.nodes.map(node => node.y))
  const ids = new Map(clipboard.nodes.map(node => [node.id, uid()]))
  const targets = new Set(machine.parts.filter(isMotor).map(part => part.id))
  const nodes = clipboard.nodes.map(node => {
    const copy = { ...node, id: ids.get(node.id), x: x + node.x - left, y: y + node.y - top }
    if (copy.target && copy.target !== '*' && !targets.has(copy.target)) copy.target = ''
    return copy
  })
  for (const [from, to] of clipboard.links) {
    const source = sourceNodeId(from)
    const id = ids.get(source)
    machine.links[source === from ? id : completionPort(id)] = ids.get(to)
  }
  machine.nodes.push(...nodes)
  return new Set(ids.values())
}

export function createProgram(machine, command) {
  const nodes = new Map(machine.nodes.map(node => [node.id, node]))
  const motors = machine.parts.filter(isMotor)
  let current = machine.nodes.find(node => node.type === 'start')
  let due = 0
  let waiting = false
  let stalled = false
  const loops = []
  return {
    step(time) {
      if (stalled) return { active: current.id, stalled }
      const seen = new Set()
      // Yield very large counted loops without freezing the simulation.
      for (let instructions = 0; current && time + 1e-8 >= due && instructions < 1000; instructions++) {
        if (isLoop(current)) {
          const index = loops.findIndex(frame => frame.node === current)
          if (index >= 0) loops.length = index + 1
          else loops.push({ node: current, iterations: 0, lastTime: -Infinity })
          const frame = loops.at(-1)
          const value = clamp(Number(current.value) || 0, 0, loopParameter[current.type].max)
          const forLoop = current.type === 'for'
          const repeat = forLoop ? frame.iterations < Math.floor(value) : time + 1e-8 < value
          if (!repeat) {
            if (seen.has(current.id)) {
              stalled = true
              return { active: current.id, stalled }
            }
            seen.add(current.id)
            loops.pop()
            current = nodes.get(machine.links[completionPort(current.id)]) ?? loops.at(-1)?.node
            continue
          }
          // Time-based conditions can only change after the simulation advances.
          if (!forLoop && frame.lastTime === time) return { active: current.id, stalled: false }
          frame.iterations++
          frame.lastTime = time
          seen.clear()
          current = nodes.get(machine.links[current.id]) ?? current
          continue
        }
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
        current = nodes.get(machine.links[current.id]) ?? loops.at(-1)?.node
      }
      return { active: current?.id, stalled: false }
    }
  }
}

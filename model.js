export const bounds = { width: 9.6, height: 5.25, limit: 30 }
export const actuatorColor = '#67dbc6'
export const parts = {
  beam:   { width: 3, height: 0.55, color: '#ffb35e', shape: 'box' },
  block:  { width: 1, height: 1, color: '#ef8d4d', shape: 'box' },
  wedge:  { width: 1.5, height: 1, color: '#f4a354', shape: 'triangle' },
  wheel:  { width: 1.4, height: 1.4, color: actuatorColor, shape: 'circle', joint: 'revolute' },
  hinge:  { width: 0.7, height: 0.7, color: actuatorColor, shape: 'circle', joint: 'revolute' },
  piston: { width: 1.1, height: 0.5, color: actuatorColor, shape: 'box', joint: 'prismatic' }
}

export const levels = [
  { id: 'flat', finish: 30, points: [[-12, 0], [40, 0]], sky: '#172b3c', land: '#344e49' },
  { id: 'step', finish: 30, points: [[-12, 0], [14, 0], [14, 2.3], [40, 2.3]], sky: '#222c46', land: '#4b435a' },
  { id: 'pit', finish: 36, points: [[-12, 0], [15, 0], [15, -2.6], [19.6, -2.6], [19.6, 0], [46, 0]], sky: '#342a42', land: '#675049' }
]

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
export const uid = () => crypto.randomUUID()
export const isMotor = part => Boolean(parts[part.type]?.joint) && part.parent !== null

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
  const { width, height } = parts[type]
  const xLimit = (bounds.width - width) / 2
  const yLimit = (bounds.height - height) / 2
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

export function leftEdge(part, x, angle) {
  const shape = parts[part.type]
  if (shape.shape === 'circle') return x - shape.width / 2
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
            if (current.target === motor.id || (current.target === '*' && motor.type === 'wheel')) {
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

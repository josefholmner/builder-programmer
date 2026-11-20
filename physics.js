import { capsuleExtents, capsuleSize, clamp, createProgram, isRotaryMount, leftEdge, localVertices, motorForce, parts, pistonAngle, terrainY } from './model.js'

let RAPIER
let initialization
export function initializePhysics() {
  initialization ??= import('@dimforge/rapier2d-compat').then(async ({ default: engine }) => {
    await engine.init()
    RAPIER = engine
  }).catch(error => {
    initialization = undefined
    throw error
  })
  return initialization
}

export const STEP = 1 / 120
const machineGroups = (1 << 16) | 2
const groundGroups = (2 << 16) | 1
const positionStiffness = 1800
const positionDamping = 85
const hingeSpeedDamping = 90
const pistonSpeedDamping = 100

export function createSimulation(machine, level) {
  const world = new RAPIER.World({ x: 0, y: -10 })
  world.timestep = STEP
  world.integrationParameters.numSolverIterations = 10
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
  const coordinates = new Float32Array(level.points.flat())
  const indices = new Uint32Array(level.points.slice(1).flatMap((_, index) => [index, index + 1]))
  world.createCollider(RAPIER.ColliderDesc.polyline(coordinates, indices).setFriction(1.25).setCollisionGroups(groundGroups), ground)

  const bodies = new Map()
  const joints = new Map()
  const initialParts = new Map(machine.parts.map(part => [part.id, part]))
  const pistonAngles = new Map(machine.parts.filter(part => parts[part.type].shape === 'capsule')
    .map(part => [part.id, pistonAngle(part, initialParts.get(part.parent))]))
  const left = Math.min(...machine.parts.map(part => leftEdge(part, part.x, pistonAngles.get(part.id) ?? 0)))
  const offset = 2 - left
  const lift = Math.max(...machine.parts.map(part => {
    const { width, height } = parts[part.type]
    const half = pistonAngles.has(part.id) ? capsuleExtents(part, pistonAngles.get(part.id))
      : { x: width / 2, y: height / 2 }
    const x = offset + part.x
    const leftEdge = x - half.x
    const rightEdge = x + half.x
    const surface = Math.max(terrainY(level, leftEdge), terrainY(level, rightEdge),
      ...level.points.filter(([x]) => x > leftEdge && x < rightEdge).map(([, y]) => y))
    return surface - part.y + half.y
  }))
  for (const part of machine.parts) {
    const shape = parts[part.type]
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(offset + part.x, lift + 0.22 + part.y)
      .setCanSleep(false).setCcdEnabled(true).setAngularDamping(0.1))
    let collider
    if (shape.shape === 'capsule') {
      const { halfLength, radius } = capsuleSize(part)
      // Rotate the collider while keeping the body frame aligned with the prismatic joint.
      collider = RAPIER.ColliderDesc.capsule(halfLength, radius).setRotation(pistonAngles.get(part.id) - Math.PI / 2)
    } else if (shape.shape === 'circle') {
      collider = RAPIER.ColliderDesc.ball(shape.width / 2)
    } else if (shape.shape === 'triangle') {
      collider = RAPIER.ColliderDesc.convexHull(new Float32Array(localVertices(part).flat()))
    } else {
      collider = RAPIER.ColliderDesc.cuboid(shape.width / 2, shape.height / 2)
    }
    world.createCollider(collider.setFriction(shape.friction ?? (shape.drive ? 1.6 : 0.55))
      .setDensity(shape.drive ? 1.2 : 0.85).setCollisionGroups(machineGroups), body)
    bodies.set(part.id, body)

    if (!part.parent) continue
    const parent = bodies.get(part.parent)
    const origin = parent.translation()
    const position = body.translation()
    const anchor = { x: position.x - origin.x, y: position.y - origin.y }
    const center = { x: 0, y: 0 }
    let joint
    if (shape.joint === 'revolute') {
      joint = RAPIER.JointData.revolute(anchor, center)
    } else if (shape.joint === 'prismatic') {
      const distance = Math.hypot(anchor.x, anchor.y)
      const axis = distance > 0.001 ? { x: anchor.x / distance, y: anchor.y / distance } : { x: 1, y: 0 }
      joint = RAPIER.JointData.prismatic(anchor, center, axis)
    } else {
      joint = RAPIER.JointData.fixed(anchor, 0, center, 0)
    }
    const handle = world.createImpulseJoint(joint, parent, body, true)
    if (shape.limits) handle.setLimits(...shape.limits)
    if (shape.joint) {
      if (!shape.drive) {
        // Keep the motor response strong even when a light actuator carries a heavy assembly.
        handle.configureMotorModel(RAPIER.MotorModel.ForceBased)
      }
      if (isRotaryMount(part)) handle.configureMotorPosition(0, positionStiffness, positionDamping)
      handle.setMotorMaxForce(motorForce(part))
      joints.set(part.id, handle)
    }
  }

  const attachedMass = new Map()
  for (const part of machine.parts.toReversed()) {
    const body = bodies.get(part.id)
    const mass = body.mass()
    const load = attachedMass.get(part.id) ?? 0
    // Limit the mass imbalance at loaded hubs so ground-contact impulses do not stretch the joints.
    const balancedMass = isRotaryMount(part) && load > mass * 8 ? load * 0.45 : mass
    if (balancedMass > mass) body.setAdditionalMass(balancedMass - mass, false)
    if (part.parent) attachedMass.set(part.parent, (attachedMass.get(part.parent) ?? 0) + balancedMass + load)
  }

  const program = createProgram(machine, (part, mode, value) => {
    const joint = joints.get(part.id)
    const shape = parts[part.type]
    const linear = shape.joint === 'prismatic'
    if (mode === 'speed') {
      const limit = shape.maxSpeed ?? (linear ? 8 : 30)
      const speed = (linear ? 1 : -1) * clamp(value, -limit, limit)
      if (isRotaryMount(part) && speed === 0) {
        const relative = bodies.get(part.id).rotation() - bodies.get(part.parent).rotation()
        const angle = Math.atan2(Math.sin(relative), Math.cos(relative))
        joint.configureMotorPosition(angle, positionStiffness, positionDamping)
        return
      }
      // Replacing a position command must release its spring.
      const damping = linear ? pistonSpeedDamping : shape.drive ? 5 : hingeSpeedDamping
      joint.configureMotor(0, speed, 0, damping)
    } else {
      const position = linear ? value : -value * Math.PI / 180
      const [min, max] = shape.limits ?? [-2 * Math.PI, 2 * Math.PI]
      // A stiffer, damped position motor holds an offset joint against gravity.
      joint.configureMotorPosition(clamp(position, min, max), positionStiffness, positionDamping)
    }
  })

  let elapsed = 0
  let status = 'running'
  let stalled = false
  const poses = () => machine.parts.map(part => {
    const body = bodies.get(part.id)
    return { ...part, ...body.translation(), angle: body.rotation() + (pistonAngles.get(part.id) ?? 0) }
  })
  return {
    get elapsed() { return elapsed },
    get status() { return status },
    get stalled() { return stalled },
    poses,
    step() {
      if (status !== 'running') return
      stalled = program.step(elapsed).stalled
      world.step()
      elapsed += STEP
      const current = poses()
      if (current.every(part => leftEdge(part, part.x, part.angle) >= level.finish)) status = 'won'
      if (current.some(part => part.y < -10) || elapsed >= 90) status = 'lost'
    },
    dispose() { world.free() }
  }
}

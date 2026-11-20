import assert from 'node:assert/strict'
import test from 'node:test'
import { blankMachine, bounds, createProgram, fitsBuildArea, leftEdge, levels, parts, pistonAngle, placePart, removePart, starterMachine, terrainY } from './model.js'
import { createSimulation, initializePhysics, STEP } from './physics.js'

test('construction keeps full parts inside the bounds and clears removed actuator targets', () => {
  assert.ok(Math.abs(bounds.width * bounds.height - 12 * 7 * 0.6) < 1e-9)
  const machine = blankMachine()
  assert.equal(placePart(machine, 'wheel', 0, 0, null), undefined)
  const base = placePart(machine, 'beam', 50, -50, null)
  assert.equal(base.x + 1.5, bounds.width / 2)
  assert.equal(base.y - 0.275, -bounds.height / 2)
  assert.ok(fitsBuildArea(base))
  assert.equal(fitsBuildArea({ ...base, x: 5 }), false)
  const hinge = placePart(machine, 'hinge', 0, 0, base.id)
  placePart(machine, 'block', 1, 0, hinge.id)
  machine.nodes.push({ type: 'position', target: hinge.id })
  removePart(machine, hinge.id)
  assert.deepEqual(machine.parts.map(part => part.id), [base.id])
  assert.equal(machine.nodes.at(-1).target, '')
})

test('the starter graph waits before commanding both wheels', () => {
  const commands = []
  const program = createProgram(starterMachine(), (part, ...args) => commands.push([part.id, ...args]))
  program.step(0)
  program.step(0.29)
  assert.deepEqual(commands, [])
  program.step(0.3)
  assert.deepEqual(commands, [['rear', 'speed', 8], ['front', 'speed', 8]])
})

test('a delayed cycle repeats and a cycle without a delay yields control', () => {
  const machine = starterMachine()
  machine.links.drive = 'delay'
  const commands = []
  const program = createProgram(machine, part => commands.push(part.id))
  program.step(0)
  assert.equal(program.step(0.3).stalled, false)
  assert.equal(program.step(0.6).stalled, false)
  assert.deepEqual(commands, ['rear', 'front', 'rear', 'front'])
  machine.nodes[1].value = 0
  assert.equal(createProgram(machine, () => {}).step(0).stalled, true)
})

test('the flat course requires the entire rover to cross the finish line', async () => {
  await initializePhysics()
  const [level] = levels
  const simulation = createSimulation(starterMachine(), level)
  let splitFinish = false
  try {
    while (simulation.status === 'running') {
      simulation.step()
      const edges = simulation.poses().map(part => leftEdge(part, part.x, part.angle))
      if (edges.some(edge => edge >= level.finish) && edges.some(edge => edge < level.finish)) {
        assert.equal(simulation.status, 'running')
        splitFinish = true
      }
    }
    assert.equal(splitFinish, true)
    assert.equal(simulation.status, 'won')
    assert.ok(simulation.poses().every(part => leftEdge(part, part.x, part.angle) >= level.finish))
  } finally {
    simulation.dispose()
  }
})

const obstacleDesigns = [
  {
    id: 'step', chassisY: 0.75, rearX: -2, frontX: 2, arm: [3, 1.5], wheel: [3.25, 0.25],
    speed: 17, commands: [['delay', 0.42], ['position', 92], ['delay', 0.86], ['position', 0]]
  },
  {
    id: 'pit', chassisY: 2, rearX: -2, frontX: 1.5, arm: [2, -0.25], wheel: [2.5, 1.5],
    speed: 23, commands: [['delay', 1.65], ['position', -167], ['delay', 0.5], ['position', 0]]
  }
]

for (const design of obstacleDesigns) {
  test(design.id + ' blocks the rover and can be passed with a programmed mechanism', async () => {
    await initializePhysics()
    const level = levels.find(level => level.id === design.id)
    function outcome(machine) {
      const simulation = createSimulation(machine, level)
      try {
        while (simulation.status === 'running') simulation.step()
        return simulation.status
      } finally {
        simulation.dispose()
      }
    }
    assert.equal(outcome(starterMachine()), 'lost')

    const machine = starterMachine()
    machine.parts.pop()
    const [chassis, rear, front] = machine.parts
    chassis.y = design.chassisY
    rear.x = design.rearX
    front.x = design.frontX
    const arm = placePart(machine, 'hinge', ...design.arm, chassis.id)
    placePart(machine, 'wheel', ...design.wheel, arm.id)
    const drive = machine.nodes.at(-1)
    drive.value = design.speed
    assert.ok(machine.parts.every(fitsBuildArea))
    assert.equal(outcome(machine), 'lost')

    let previous = drive.id
    for (const [type, value] of design.commands) {
      const id = 'command-' + machine.nodes.length
      machine.nodes.push({ id, type, value, target: arm.id })
      machine.links[previous] = id
      previous = id
    }
    assert.equal(outcome(machine), 'won')
  })
}

test('an off-road rover can finish all three new courses', async () => {
  await initializePhysics()
  for (const level of levels.slice(3)) {
    const machine = starterMachine()
    for (const part of machine.parts) {
      if (part.type === 'wheel') part.type = 'treadWheel'
    }
    const simulation = createSimulation(machine, level)
    try {
      while (simulation.status === 'running' && simulation.elapsed < 20) simulation.step()
      assert.equal(simulation.status, 'won', level.id)
    } finally {
      simulation.dispose()
    }
  }
})

test('the servo and long-stroke ram stop at their travel limits', async () => {
  await initializePhysics()
  for (const [type, target] of [['servo', 160], ['ram', 3]]) {
    const machine = blankMachine()
    const base = placePart(machine, 'beam', 0, 0, null)
    const motor = placePart(machine, type, 0, 1.5, base.id)
    machine.nodes.push({ id: 'move', type: 'position', target: motor.id, value: target })
    machine.links[machine.nodes[0].id] = 'move'
    const simulation = createSimulation(machine, levels[0])
    try {
      while (simulation.elapsed < 3) simulation.step()
      const [parent, part] = simulation.poses()
      if (type === 'servo') {
        assert.ok(Math.abs(part.angle - parent.angle + Math.PI / 3) < 0.025)
      } else {
        const extension = Math.hypot(part.x - parent.x, part.y - parent.y) - 1.5
        assert.ok(Math.abs(extension - 2.7) < 0.025)
      }
    } finally {
      simulation.dispose()
    }
  }
})

test('the pit floor supports a rover while it drives across the bottom', async () => {
  await initializePhysics()
  const pit = levels.find(level => level.id === 'pit')
  // Put the regular starting position just inside the pit to isolate driving on its floor.
  const level = { ...pit, points: pit.points.map(([x, y]) => [x - 13.25, y]) }
  const simulation = createSimulation(starterMachine(), level)
  let firstGroundedX
  let furthestGroundedX = -Infinity
  try {
    while (simulation.elapsed < 2) {
      simulation.step()
      const poses = simulation.poses()
      const grounded = poses.filter(part => part.type === 'wheel').every(wheel => {
        const surface = terrainY(level, wheel.x)
        return surface < 0 && Math.abs(wheel.y - parts.wheel.height / 2 - surface) < 0.02
      })
      if (!grounded) continue
      firstGroundedX ??= poses[0].x
      furthestGroundedX = Math.max(furthestGroundedX, poses[0].x)
    }
    assert.ok(furthestGroundedX - firstGroundedX > 0.5)
  } finally {
    simulation.dispose()
  }
})

test('a hinge carrying three drive wheels stays together on first ground contact', async () => {
  await initializePhysics()
  const machine = starterMachine()
  const chassis = { ...machine.parts[0], x: -0.25, y: 1.5 }
  machine.parts = [
    chassis,
    { ...machine.parts[1], x: -2.75, y: -0.5 },
    { ...machine.parts[3], x: -0.5, y: 2.125 },
    { id: 'hub', type: 'hinge', parent: chassis.id, x: 2, y: -0.75 },
    { id: 'lower', type: 'wheel', parent: 'hub', x: 2.75, y: -1.925 },
    { id: 'upper', type: 'wheel', parent: 'hub', x: 3, y: 0.75 },
    { id: 'inner', type: 'wheel', parent: 'hub', x: 0.25, y: -1 }
  ]
  const connections = machine.parts.slice(1).map(part => {
    const parent = machine.parts.find(candidate => candidate.id === part.parent)
    return [part.id, parent.id, Math.hypot(part.x - parent.x, part.y - parent.y)]
  })

  for (const drive of [false, true]) {
    const simulation = createSimulation({ ...machine, links: drive ? machine.links : {} }, levels[0])
    try {
      let previous = new Map(simulation.poses().map(part => [part.id, part]))
      while (simulation.status === 'running' && simulation.elapsed < (drive ? 12 : 3)) {
        simulation.step()
        const poses = new Map(simulation.poses().map(part => [part.id, part]))
        for (const [id, parentId, rest] of connections) {
          const part = poses.get(id)
          const parent = poses.get(parentId)
          const last = previous.get(id)
          const stretch = Math.abs(Math.hypot(part.x - parent.x, part.y - parent.y) - rest)
          const speed = Math.hypot(part.x - last.x, part.y - last.y) / STEP
          assert.ok(stretch < 0.02, id + ' stretched by ' + stretch + ' m')
          assert.ok(speed < 15, id + ' reached ' + speed + ' m/s')
        }
        previous = poses
      }
      assert.equal(simulation.status, drive ? 'won' : 'running')
    } finally {
      simulation.dispose()
    }
  }
})

test('the hinge keeps its mount fixed and drives an attached beam in both directions', async () => {
  await initializePhysics()
  const machine = blankMachine()
  const base = placePart(machine, 'beam', 0, -2, null)
  const hinge = placePart(machine, 'hinge', 0.5, 1, base.id)
  placePart(machine, 'beam', 1.5, 1, hinge.id)
  machine.nodes.push(
    { id: 'hold', type: 'delay', value: 0.6 },
    { id: 'forward', type: 'speed', value: 2.5, target: hinge.id },
    { id: 'wait', type: 'delay', value: 0.6 },
    { id: 'reverse', type: 'speed', value: -2.5, target: hinge.id },
    { id: 'wait-to-stop', type: 'delay', value: 0.6 },
    { id: 'stop', type: 'speed', value: 0, target: hinge.id }
  )
  machine.links = {
    [machine.nodes[0].id]: 'hold', hold: 'forward', forward: 'wait', wait: 'reverse',
    reverse: 'wait-to-stop', 'wait-to-stop': 'stop'
  }

  const simulation = createSimulation(machine, levels[0])
  const wrapAngle = angle => Math.atan2(Math.sin(angle), Math.cos(angle))
  function sample(time) {
    while (simulation.elapsed < time) simulation.step()
    const [parent, rotor, beam] = simulation.poses()
    const dx = rotor.x - parent.x
    const dy = rotor.y - parent.y
    const cosine = Math.cos(parent.angle)
    const sine = Math.sin(parent.angle)
    assert.ok(Math.abs(dx * cosine + dy * sine - (hinge.x - base.x)) < 0.04)
    assert.ok(Math.abs(dy * cosine - dx * sine - (hinge.y - base.y)) < 0.04)
    assert.ok(Math.abs(wrapAngle(beam.angle - rotor.angle)) < 0.04)
    return wrapAngle(beam.angle - parent.angle)
  }

  try {
    assert.ok(Math.abs(sample(0.55)) < 0.08)
    const clockwiseStart = sample(0.75)
    const clockwise = wrapAngle(sample(1.15) - clockwiseStart)
    assert.ok(clockwise < -0.8, 'clockwise change: ' + clockwise)
    const counterclockwiseStart = sample(1.35)
    const counterclockwise = wrapAngle(sample(1.75) - counterclockwiseStart)
    assert.ok(counterclockwise > 0.8, 'counterclockwise change: ' + counterclockwise)
    const stopped = sample(2)
    assert.ok(Math.abs(wrapAngle(sample(2.6) - stopped)) < 0.04)
  } finally {
    simulation.dispose()
  }
})

test('a piston needs enough configured force to lift a heavy frame', async () => {
  await initializePhysics()
  const machine = blankMachine()
  const base = placePart(machine, 'beam', 0, 1, null)
  placePart(machine, 'beam', 0, 1.5, base.id)
  placePart(machine, 'beam', 0, 2, base.id)
  const piston = placePart(machine, 'piston', 0, 0, base.id)
  machine.nodes.push({ id: 'push', type: 'speed', value: 2, target: piston.id })
  machine.links[machine.nodes[0].id] = 'push'

  for (const [force, lifts] of [[10, false], [100, true], [undefined, true]]) {
    piston.maxForce = force
    const simulation = createSimulation(machine, levels[0])
    try {
      while (simulation.elapsed < 2) simulation.step()
      const height = simulation.poses()[0].y
      assert.equal(height > 2, lifts, 'chassis height at force ' + force + ': ' + height)
    } finally {
      simulation.dispose()
    }
  }
})

test('hinge and piston motors hold their programmed positions under gravity', async () => {
  await initializePhysics()
  const machine = blankMachine()
  const base = placePart(machine, 'beam', 0, 0, null)
  const hinge = placePart(machine, 'hinge', 1, 1, base.id)
  const piston = placePart(machine, 'piston', -1, 1, base.id)
  machine.nodes.push(
    { id: 'rotate', type: 'position', value: 45, target: hinge.id },
    { id: 'extend', type: 'position', value: 1, target: piston.id }
  )
  machine.links = { [machine.nodes[0].id]: 'rotate', rotate: 'extend' }
  const simulation = createSimulation(machine, levels[0])
  try {
    for (let i = 0; i < 360; i++) simulation.step()
    const [parent, rotated, extended] = simulation.poses()
    const angle = rotated.angle - parent.angle
    const extension = Math.hypot(extended.x - parent.x, extended.y - parent.y) - Math.sqrt(2)
    assert.ok(Math.abs(angle + Math.PI / 4) < 0.1, 'hinge angle in radians: ' + angle)
    assert.ok(Math.abs(extension - 1) < 0.05, 'piston extension in meters: ' + extension)
    const mountAngle = pistonAngle(extended, parent)
    assert.ok(Math.abs(Math.sin(extended.angle - mountAngle)) < 0.025, 'piston body follows the attachment axis')
  } finally {
    simulation.dispose()
  }
})

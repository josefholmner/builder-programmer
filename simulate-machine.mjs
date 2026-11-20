import { readFile, stat } from 'node:fs/promises'
import { decodeMachineFile, maxMachineFileBytes } from './machine-file.js'
import { fitsBuildArea, levels } from './model.js'
import { createSimulation, initializePhysics, STEP } from './physics.js'

async function main([file, levelId = 'flat', duration = '90', ...extra]) {
  if (!file || file === '--help') {
    console.log('Usage: node simulate-machine.mjs <file.machine.json> [level] [seconds]')
    console.log('Levels: ' + levels.map(level => level.id).join(', '))
    if (!file) process.exitCode = 1
    return
  }
  const level = levels.find(candidate => candidate.id === levelId)
  if (!level) throw new Error('Unknown level: ' + levelId)
  const seconds = Number(duration)
  if (extra.length || !(seconds > 0 && seconds <= 90)) throw new Error('Enter a duration greater than 0 and at most 90 seconds.')
  if ((await stat(file)).size > maxMachineFileBytes) throw new Error('Machine files must be 2 MiB or smaller.')
  const machine = decodeMachineFile(await readFile(file, 'utf8'))
  if (!machine.parts.every(fitsBuildArea)) {
    throw new Error('Some parts are outside the current build area. Use Move parts inside in the garage and export again.')
  }

  await initializePhysics()
  const simulation = createSimulation(machine, level)
  try {
    const steps = Math.max(1, Math.ceil(seconds / STEP - 1e-8))
    let previous
    let poses = simulation.poses()
    for (let step = 0; step < steps && simulation.status === 'running'; step++) {
      previous = poses
      simulation.step()
      poses = simulation.poses()
    }
    const previousById = new Map(previous.map(part => [part.id, part]))
    const byId = new Map(poses.map(part => [part.id, part]))
    const round = value => Number(value.toFixed(3))
    const finalParts = poses.map(({ id, type, parent, x, y, angle }) => {
      const result = { id, type, x: round(x), y: round(y), angle: round(angle) }
      if (parent) {
        const delta = angle - previousById.get(id).angle - (byId.get(parent).angle - previousById.get(parent).angle)
        result.relativeAngularSpeed = round(Math.atan2(Math.sin(delta), Math.cos(delta)) / STEP)
      }
      return result
    })
    console.log(JSON.stringify({
      machine: machine.name, level: level.id, status: simulation.status, seconds: round(simulation.elapsed),
      programStalled: simulation.stalled, parts: finalParts
    }, null, 2))
  } finally {
    simulation.dispose()
  }
}

try {
  await main(process.argv.slice(2))
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}

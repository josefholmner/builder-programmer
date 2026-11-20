import './style.css'
import { actuatorColor, bounds, buildPosition, clamp, fitsBuildArea, isMotor, leftEdge, levels, partName, parts, placePart, removePart, starterMachine, blankMachine, uid } from './model.js'
import { translate } from './language.js'
import { createSimulation, initializePhysics, STEP } from './physics.js'
import { createRenderer, drawLevel, drawWorkshop, workshopView } from './render.js'

const storageKey = 'machine-works.v1'
let stored
try {
  stored = JSON.parse(localStorage.getItem(storageKey))
} catch {
  stored = null
}
const state = {
  language: stored?.language === 'en' ? 'en' : 'sv',
  machines: stored?.machines ?? [],
  records: stored?.records ?? {},
  machine: stored?.draft ?? starterMachine(),
  example: stored?.example ?? true,
  dirty: stored?.dirty ?? false,
  screen: 'garage',
  tab: 'build',
  selected: null,
  placing: null,
  wire: null,
  level: null,
  mode: '',
  simulation: null
}
const t = key => translate(state.language, key)
const app = document.querySelector('#app')
const stage = document.createElement('div')
stage.className = 'viewport'
stage.innerHTML = '<canvas tabindex="0"></canvas><div class="stage-overlay"></div>'
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char])
const symbols = { beam: '▬', block: '■', wedge: '◢', wheel: '◉', hinge: '⊙', piston: '↔' }
const icon = value => '<span aria-hidden="true">' + value + '</span>'
const button = (action, label, extra = '') => '<button type="button" data-action="' + action + '" ' + extra + '>' + label + '</button>'
const actionButton = (action, key, variant = '', extra = '') =>
  button(action, t(key), 'class="button ' + variant + '" ' + extra)
const fmt = (value, maximumFractionDigits = 1) => new Intl.NumberFormat(state.language, { maximumFractionDigits }).format(value)
const title = () => state.machine.name || t(state.example ? 'starter' : 'untitled')
const labelPart = part => partName(part, state.machine, t)
const unlocked = index => index === 0 || state.records[levels[index - 1]?.id] !== undefined

let paint
let redraw = true
let ghost
let drag
let graphDrag
let toastTimer
let lastSize = ''
let runToken = 0
let runResult = ''
let camera = { x: 4, y: 0 }
let raceTicks = 0

function persist() {
  const { language, machines, records, machine, example, dirty } = state
  try {
    localStorage.setItem(storageKey, JSON.stringify({ language, machines, records, draft: machine, example, dirty }))
    return true
  } catch {
    notify('storageError')
    return false
  }
}

function edited() {
  state.dirty = true
  redraw = true
  persist()
}

function notify(key) {
  const toast = app.querySelector('.toast')
  if (!toast) return
  clearTimeout(toastTimer)
  toast.textContent = t(key)
  toast.hidden = false
  toastTimer = setTimeout(() => { toast.hidden = true }, 3200)
}

function footer() {
  const element = app.querySelector('.engine')
  if (element) element.textContent = state.mode ? t('renderer') + ' · ' + state.mode + ' / WASM' : ''
}

function render() {
  document.documentElement.lang = state.language
  document.title = t('brand')
  const nav = (action, key, screen) => button(action, t(key), state.screen === screen ? 'aria-current="page"' : '')
  app.innerHTML = '<header class="header">' +
    button('garage', '<span class="mark" aria-hidden="true">⚙</span>' + t('brand'), 'class="brand"') +
    '<nav class="nav" aria-label="' + t('brand') + '">' + nav('garage', 'garage', 'garage') +
    nav('levels', 'levels', 'levels') + nav('library', 'library') + nav('settings', 'settings') +
    '</nav></header><main>' + (
      state.screen === 'garage' ? garageMarkup() : state.screen === 'levels' ? levelsMarkup() : raceMarkup()
    ) + '<footer class="footer"><span class="engine"></span></footer></main>' +
    '<dialog></dialog><div class="toast" role="status" hidden></div>'
  footer()
  const slot = app.querySelector('.stage-slot')
  if (slot) {
    slot.append(stage)
    const canvas = stage.querySelector('canvas')
    canvas.setAttribute('aria-label', t(state.screen === 'race' ? 'playCanvas' : 'buildCanvas'))
    canvas.tabIndex = state.screen === 'garage' ? 0 : -1
    delete stage.querySelector('.stage-overlay').dataset.result
  }
  if (state.screen === 'garage' && state.tab === 'build') refreshBuild()
  if (state.screen === 'garage' && state.tab === 'program') refreshGraph(false)
  if (state.screen === 'race') updateRace()
  redraw = true
}

function garageMarkup() {
  const tab = key => button(key, t(key), 'aria-pressed="' + (state.tab === key) + '"')
  return '<section class="intro"><div><div class="kicker">' + t('garage') + '</div><h1>' + escape(title()) +
    '</h1></div><div class="actions">' + actionButton('save', 'save', '', state.machine.parts.length ? '' : 'disabled') +
    actionButton('test', 'run', 'primary', state.machine.parts.length ? '' : 'disabled') +
    '</div></section><div class="toolbar"><div class="tabs">' + tab('build') + tab('program') + '</div><div class="actions">' +
    actionButton('new', 'new', 'muted') + actionButton('example', 'loadStarter', 'muted') + '</div></div>' +
    (state.tab === 'build' ? '<div class="work-grid"><section class="panel"><div class="panel-head"><h2>' +
    t('inventory') + '</h2></div><div class="panel-body palette"></div></section><section class="panel build-panel">' +
    '<div class="panel-head"><h2>' + t('board') + '</h2><span class="mono">' +
    fmt(bounds.width, 2) + ' × ' + fmt(bounds.height, 2) + ' m</span></div><div class="stage-slot"></div>' +
    '<div class="panel-foot"><span class="build-hint"></span><span class="mono count"></span></div></section>' +
    '<section class="panel details"><div class="panel-head"><h2>' + t('machine') +
    '</h2></div><div class="panel-body inspector"></div></section></div>' :
    '<section class="panel"><div class="panel-head"><h2>' + t('graph') + '</h2><label class="mono">' + t('addNode') +
    ' <select id="node-type"><option value="">+</option>' + ['delay', 'speed', 'position'].map(type =>
      '<option value="' + type + '">' + t(type) + '</option>').join('') +
    '</select></label></div><div class="graph-scroll"><div class="graph-space"></div></div>' +
    '<div class="panel-foot">' + t('graphHint') + '</div></section>')
}

function refreshBuild() {
  const palette = app.querySelector('.palette')
  if (!palette) return
  const canRun = state.machine.parts.length > 0
  app.querySelector('[data-action="test"]').disabled = !canRun
  app.querySelector('[data-action="save"]').disabled = !canRun
  const paletteGroup = (key, types) => '<div class="parts-group"><div class="eyebrow"' +
    (key === 'actuators' ? ' style="color:' + actuatorColor + '"' : '') + '>' + t(key) + '</div>' +
    types.map(type => button('place', '<span class="part-icon" aria-hidden="true" style="--tint:' + parts[type].color + '">' +
      symbols[type] + '</span><span><b>' + t(type) + '</b><small>' + t(type + 'Info') + '</small></span>',
    'class="part" data-type="' + type + '" aria-pressed="' + (state.placing === type) + '"')).join('') + '</div>'
  palette.innerHTML = paletteGroup('shapes', ['beam', 'block', 'wedge']) + paletteGroup('actuators', ['wheel', 'hinge', 'piston'])
  const selected = state.machine.parts.find(part => part.id === state.selected)
  const parent = selected && state.machine.parts.find(part => part.id === selected.parent)
  const oversized = state.machine.parts.some(part => !fitsBuildArea(part))
  const fitPrompt = oversized ? '<p role="status">' + t('oversizedMachine') + '</p>' +
    actionButton('fit-parts', 'fitParts', 'muted') + '<hr>' : ''
  app.querySelector('.inspector').innerHTML = fitPrompt + '<div class="eyebrow">' + t('frame') + '</div>' + (selected ?
    '<h3>' + labelPart(selected) + '</h3><p>' + (parent ? t('attachedTo') + ' · ' + labelPart(parent) : t('root')) +
    '</p>' + actionButton('remove-part', 'remove', 'muted') : '<p>' + t('noSelection') + '</p>') +
    '<hr><div class="eyebrow">' + state.machine.parts.length + ' ' + t('partsUnit') +
    '</div><div class="part-list">' + state.machine.parts.map(part => button('select-part',
      '<span style="color:' + parts[part.type].color + '" aria-hidden="true">' + symbols[part.type] + '</span> ' + labelPart(part),
      'data-id="' + part.id + '" aria-pressed="' + (part.id === state.selected) + '"')).join('') + '</div>'
  app.querySelector('.count').textContent = state.machine.parts.length + ' / ' + bounds.limit + ' ' + t('partCount')
  app.querySelector('.build-hint').textContent = t(state.placing ? 'placement' : 'selectHint')
  stage.classList.toggle('placing', Boolean(state.placing))
  stage.querySelector('.stage-overlay').innerHTML = canRun ? '' : '<div class="empty-build">' + t('emptyBuild') + '</div>'
  redraw = true
}

function levelsMarkup() {
  return '<section class="intro"><div><div class="kicker">' + t('levels') + '</div><h1>' + t('courses') +
    '</h1><p>' + t('courseHint') + '</p></div></section><div class="track-grid">' + levels.map((level, index) => {
      const available = unlocked(index)
      const best = state.records[level.id]
      const start = level.points[0][0]
      const length = level.points.at(-1)[0] - start
      const terrain = level.points.map(([x, y]) => ((x - start) / length * 100) + '% ' + (63 - y * 11) + '%').join(',')
      return '<article class="panel track-card"><div class="track-art" style="--sky:' + level.sky + ';--land:' + level.land +
        ';--terrain:' + terrain + ',100% 100%,0% 100%"><span class="mono">' + t('track') + ' ' +
        String(index + 1).padStart(2, '0') + '</span></div><div class="panel-body"><span class="eyebrow">' +
        (best !== undefined ? t('complete') + ' · ' + fmt(best) + ' s' : t(available ? 'available' : 'locked')) +
        '</span><h2>' + t(level.id) + '</h2><p>' + t(level.id + 'Info') + '</p>' +
        actionButton('play', available ? 'play' : 'locked', available ? 'primary' : '', 'data-index="' + index + '"' + (available ? '' : ' disabled')) +
        '</div></article>'
    }).join('') + '</div>'
}

function raceMarkup() {
  const index = state.level
  return '<section class="intro"><div><div class="kicker">' + t('track') + ' ' + String(index + 1).padStart(2, '0') +
    '</div><h1>' + t(levels[index].id) + '</h1><p>' + escape(title()) + '</p></div><div class="actions">' +
    actionButton('garage', 'garageReturn') + actionButton('retry', 'retry') +
    '</div></section><section class="panel race"><div class="stage-slot"></div><div class="panel-foot">' +
    '<span class="run-status" role="status"></span><span class="mono">' + t('time') +
    ' <span class="clock">0</span> s</span><progress max="1" value="0" aria-label="' + t('progress') +
    '"></progress></div></section>'
}

function updateRace() {
  if (state.screen !== 'race') return
  const sim = state.simulation
  const status = app.querySelector('.run-status')
  const message = t(runResult || (sim?.stalled ? 'stall' : 'running'))
  if (status.textContent !== message) status.textContent = message
  app.querySelector('.clock').textContent = fmt(sim?.elapsed ?? 0)
  if (sim) {
    const back = Math.min(...sim.poses().map(part => leftEdge(part, part.x, part.angle)))
    app.querySelector('progress').value = clamp((back - 2) / (levels[state.level].finish - 2), 0, 1)
  }
  const overlay = stage.querySelector('.stage-overlay')
  if (overlay.dataset.result === runResult) return
  overlay.dataset.result = runResult
  overlay.innerHTML = runResult ? '<div class="result"><h2>' + t(runResult) + '</h2>' +
    (runResult === 'won' && state.level < levels.length - 1 ? '<p>' + actionButton('next', 'nextLevel', 'primary') + '</p>' : '') +
    '</div>' : ''
}

function stopSimulation() {
  runToken++
  state.simulation?.dispose()
  state.simulation = null
  runResult = ''
}

function navigate(screen) {
  stopSimulation()
  state.screen = screen
  state.placing = null
  state.wire = null
  ghost = null
  render()
}

async function play(level) {
  if (!levels[level] || !unlocked(level)) return
  if (!state.machine.parts.length) return notify('emptyRun')
  if (!state.machine.parts.every(fitsBuildArea)) {
    state.tab = 'build'
    navigate('garage')
    return notify('oversizedMachine')
  }
  stopSimulation()
  const token = runToken
  state.placing = null
  state.wire = null
  ghost = null
  state.level = level
  state.screen = 'race'
  camera = { x: 4, y: 0 }
  runResult = 'loading'
  render()
  try {
    await initializePhysics()
    if (token !== runToken) return
    state.simulation = createSimulation(structuredClone(state.machine), levels[level])
    runResult = ''
  } catch (error) {
    if (token !== runToken) return
    console.error(error)
    runResult = 'physicsError'
  }
  updateRace()
  redraw = true
}

function nodeFields(node) {
  if (node.type === 'start') return ''
  const field = (label, min, max) => '<label>' + label + '<input type="number" min="' + min + '" max="' + max +
    '" step="any" data-field="value" value="' + node.value + '"></label>'
  if (node.type === 'delay') return field(t('seconds'), 0, 60)
  const motors = state.machine.parts.filter(isMotor)
  const options = [['', t('pickTarget')], ...(motors.some(part => part.type === 'wheel') ? [['*', t('wheelGroup')]] : []),
    ...motors.map(part => [part.id, labelPart(part)])]
  return '<label>' + t('targets') + '<select data-field="target">' + options.map(([id, name]) =>
    '<option value="' + id + '"' + (id === node.target ? ' selected' : '') + '>' + name + '</option>').join('') +
    '</select></label>' + field(t(node.type === 'speed' ? 'speedValue' : 'positionValue'), -360, 360)
}

function refreshGraph(restoreScroll = true) {
  const scroll = app.querySelector('.graph-scroll')
  const space = scroll.querySelector('.graph-space')
  const x = restoreScroll ? scroll.scrollLeft : 0
  const y = restoreScroll ? scroll.scrollTop : 0
  space.innerHTML = '<svg class="wires" aria-hidden="true"></svg>' + state.machine.nodes.map(node => {
    const port = (direction, key, active, connected) => button('port-' + direction, '',
      'class="node-port ' + direction + (connected ? ' connected' : '') + '" title="' + t(key) + '" aria-label="' +
      t(key) + ' · ' + t(node.type) + '" aria-pressed="' + active + '"')
    return '<article class="node ' + node.type + '" data-node="' + node.id + '"><div class="node-head"><strong>' +
      t(node.type) + '</strong>' + (node.type !== 'start' ? button('remove-node', '×', 'aria-label="' + t('removeNode') + '"') : '') +
      '</div><div class="node-body">' + nodeFields(node) +
      (state.machine.links[node.id] ? button('unlink', t('detach'), 'class="unlink"') : '') + '</div>' +
      (node.type !== 'start' ? port('in', 'input', false, Object.values(state.machine.links).includes(node.id)) : '') +
      port('out', 'output', state.wire === node.id, Boolean(state.machine.links[node.id])) + '</article>'
  }).join('')
  for (const node of state.machine.nodes) positionNode(space.querySelector('[data-node="' + node.id + '"]'), node)
  drawWires(space)
  scroll.scrollTo(x, y)
}

function positionNode(element, node) {
  element.style.left = node.x + 'px'
  element.style.top = node.y + 'px'
}

function drawWires(space) {
  const nodes = new Map(state.machine.nodes.map(node => [node.id, node]))
  space.style.width = Math.max(650, ...state.machine.nodes.map(node => node.x + 225)) + 'px'
  space.style.height = Math.max(390, ...state.machine.nodes.map(node => node.y + 210)) + 'px'
  space.querySelector('.wires').innerHTML = Object.entries(state.machine.links).map(([source, target]) => {
    const a = nodes.get(source)
    const b = nodes.get(target)
    if (!a || !b) return ''
    const x = a.x + 161
    const y = a.y + 59
    const endX = b.x
    const endY = b.y + 59
    const bend = Math.max(38, Math.abs(endX - x) * 0.48)
    return '<path d="M ' + x + ' ' + y + ' C ' + (x + bend) + ' ' + y + ', ' + (endX - bend) +
      ' ' + endY + ', ' + endX + ' ' + endY + '"></path>'
  }).join('')
}

function dialog(key, body) {
  const element = app.querySelector('dialog')
  element.innerHTML = '<div class="panel-head"><h2>' + t(key) + '</h2>' +
    button('close', '×', 'class="button muted" aria-label="' + t('close') + '"') + '</div><div class="panel-body">' + body + '</div>'
  if (!element.open) element.showModal()
  element.querySelector('input, select')?.focus()
}

function settings() {
  dialog('settings', '<label>' + t('language') + '<select id="language"><option value="sv"' +
    (state.language === 'sv' ? ' selected' : '') + '>Svenska</option><option value="en"' +
    (state.language === 'en' ? ' selected' : '') + '>English</option></select></label>')
}

function library() {
  dialog('library', state.machines.length ? state.machines.map((machine, index) =>
    '<div class="library-row"><div><strong>' + escape(machine.name) + '</strong><br><small>' +
    machine.parts.length + ' ' + t('partCount') + '</small></div>' +
    actionButton('load', 'load', '', 'data-index="' + index + '"') + '</div>').join('') : '<p>' + t('libraryEmpty') + '</p>')
}

function replaceMachine(machine, example = false) {
  if (state.dirty && !window.confirm(t('replaceDraft'))) return false
  state.machine = structuredClone(machine)
  state.example = example
  state.dirty = false
  state.selected = null
  state.tab = 'build'
  persist()
  navigate('garage')
  return true
}

const actions = {
  garage: () => navigate('garage'),
  levels: () => navigate('levels'),
  settings,
  library,
  close: () => app.querySelector('dialog').close(),
  build: () => { state.tab = 'build'; state.wire = null; render() },
  program: () => { state.tab = 'program'; state.placing = null; ghost = null; render() },
  test: () => play(0),
  play: control => play(Number(control.dataset.index)),
  retry: () => play(state.level),
  next: () => play(state.level + 1),
  new: () => replaceMachine(blankMachine()),
  example: () => replaceMachine(starterMachine(), true),
  load: control => {
    if (replaceMachine(state.machines[Number(control.dataset.index)])) notify('loaded')
  },
  save: () => dialog('save', '<form id="save-machine"><label>' + t('saveName') +
    '<input name="name" required maxlength="60" value="' + escape(title()) + '"></label><div class="actions"><button class="button primary">' +
    t('save') + '</button></div></form>'),
  place: control => {
    const type = control.dataset.type
    if (parts[type].joint && !state.machine.parts.length) return notify('baseFirst')
    if (state.machine.parts.length >= bounds.limit) return notify('tooMany')
    state.placing = type === state.placing ? null : type
    ghost = null
    refreshBuild()
    if (state.placing && matchMedia('(max-width: 680px)').matches) {
      stage.scrollIntoView({ block: 'nearest' })
    }
  },
  'select-part': control => {
    state.selected = control.dataset.id
    state.placing = null
    ghost = null
    refreshBuild()
  },
  'fit-parts': () => {
    for (const part of state.machine.parts) {
      if (!fitsBuildArea(part)) Object.assign(part, buildPosition(part.type, part.x, part.y))
    }
    edited()
    refreshBuild()
  },
  'remove-part': () => {
    removePart(state.machine, state.selected)
    state.selected = null
    if (!state.machine.parts.length && parts[state.placing]?.joint) state.placing = null
    ghost = null
    edited()
    refreshBuild()
  },
  'port-out': control => {
    const id = control.closest('.node').dataset.node
    state.wire = state.wire === id ? null : id
    refreshGraph()
    app.querySelector('[data-node="' + id + '"] .out').focus({ preventScroll: true })
  },
  'port-in': control => {
    if (!state.wire) return
    state.machine.links[state.wire] = control.closest('.node').dataset.node
    state.wire = null
    edited()
    refreshGraph()
  },
  unlink: control => unlink(control.closest('.node').dataset.node),
  'remove-node': control => {
    const id = control.closest('.node').dataset.node
    state.machine.nodes = state.machine.nodes.filter(node => node.id !== id)
    state.machine.links = Object.fromEntries(Object.entries(state.machine.links).filter(([from, to]) => from !== id && to !== id))
    if (state.wire === id) state.wire = null
    edited()
    refreshGraph()
  }
}

app.addEventListener('click', event => {
  const control = event.target.closest('[data-action]')
  if (control && !control.disabled) actions[control.dataset.action]?.(control)
})

app.addEventListener('submit', event => {
  if (event.target.id !== 'save-machine') return
  event.preventDefault()
  const input = event.target.elements.name
  const name = input.value.trim()
  if (!name) return input.focus()
  const machine = { ...structuredClone(state.machine), name }
  const index = state.machines.findIndex(saved => saved.name === name)
  const previous = { machines: state.machines, machine: state.machine, example: state.example, dirty: state.dirty }
  state.machines = [...state.machines]
  if (index === -1) state.machines.push(machine)
  else state.machines[index] = machine
  state.machine = structuredClone(machine)
  state.example = false
  state.dirty = false
  if (!persist()) {
    Object.assign(state, previous)
    return
  }
  render()
  notify('saved')
})

app.addEventListener('change', event => {
  const control = event.target
  if (control.id === 'language') {
    state.language = control.value
    persist()
    render()
    settings()
  } else if (control.id === 'node-type' && control.value) {
    const scroll = app.querySelector('.graph-scroll')
    const offset = state.machine.nodes.length * 29
    const node = { id: uid(), type: control.value, value: control.value === 'delay' ? 1 : 0,
      target: state.machine.parts.find(isMotor)?.id ?? '', x: scroll.scrollLeft + 28 + offset % 350,
      y: scroll.scrollTop + 115 + offset % 170 }
    state.machine.nodes.push(node)
    control.value = ''
    edited()
    refreshGraph()
  } else if (control.dataset.field) {
    const node = state.machine.nodes.find(candidate => candidate.id === control.closest('.node').dataset.node)
    if (control.dataset.field === 'target') node.target = control.value
    else {
      node.value = clamp(Number(control.value) || 0, Number(control.min), Number(control.max))
      control.value = node.value
    }
    edited()
  }
})

app.addEventListener('contextmenu', event => {
  const control = event.target.closest('.node-port.out')
  if (!control) return
  event.preventDefault()
  unlink(control.closest('.node').dataset.node)
})

function unlink(id) {
  delete state.machine.links[id]
  if (state.wire === id) state.wire = null
  edited()
  refreshGraph()
}

app.addEventListener('pointerdown', event => {
  const header = event.target.closest('.node-head')
  if (!header || event.target.closest('button') || event.button !== 0) return
  const element = header.closest('.node')
  const node = state.machine.nodes.find(candidate => candidate.id === element.dataset.node)
  graphDrag = { element, node, x: event.clientX - node.x, y: event.clientY - node.y,
    originalX: node.x, originalY: node.y, pointer: event.pointerId }
  header.setPointerCapture(event.pointerId)
})
app.addEventListener('pointermove', event => {
  if (graphDrag?.pointer !== event.pointerId) return
  const { node, element, x, y } = graphDrag
  node.x = Math.max(15, event.clientX - x)
  node.y = Math.max(15, event.clientY - y)
  positionNode(element, node)
  drawWires(element.parentElement)
})
for (const type of ['pointerup', 'pointercancel']) app.addEventListener(type, event => {
  if (graphDrag?.pointer !== event.pointerId) return
  const { node, originalX, originalY } = graphDrag
  graphDrag = null
  if (node.x !== originalX || node.y !== originalY) edited()
})

function workshopPoint(event) {
  const rect = stage.getBoundingClientRect()
  const view = workshopView(rect.width, rect.height)
  return [(event.clientX - rect.left - view.x) / view.scale, (view.y + rect.top - event.clientY) / view.scale]
}

function movePart(part, x, y) {
  Object.assign(part, buildPosition(part.type, x, y, true))
  redraw = true
}

function occupied(part, x, y) {
  const shape = parts[part.type]
  const dx = x - part.x
  const dy = y - part.y
  if (shape.shape === 'circle') return Math.hypot(dx, dy) <= shape.width / 2
  return Math.abs(dx) <= shape.width / 2 && Math.abs(dy) <= shape.height / 2 &&
    (shape.shape !== 'triangle' || (dx / shape.width + 0.5) + (dy / shape.height + 0.5) <= 1)
}

stage.addEventListener('pointerdown', event => {
  if (event.target.tagName !== 'CANVAS' || state.screen !== 'garage' || event.button !== 0) return
  const [x, y] = workshopPoint(event)
  if (state.placing) {
    if (Math.abs(x) > bounds.width / 2 || Math.abs(y) > bounds.height / 2) return notify('placeOutside')
    const part = placePart(state.machine, state.placing, x, y, state.selected)
    state.placing = null
    ghost = null
    if (part) {
      state.selected = part.id
      edited()
    }
  } else {
    const part = state.machine.parts.findLast(candidate => occupied(candidate, x, y))
    state.selected = part?.id ?? null
    if (part) {
      drag = { part, x: x - part.x, y: y - part.y, originalX: part.x, originalY: part.y, pointer: event.pointerId }
      stage.setPointerCapture(event.pointerId)
    }
  }
  refreshBuild()
})

stage.addEventListener('pointermove', event => {
  if (state.screen !== 'garage' || state.tab !== 'build') return
  const [x, y] = workshopPoint(event)
  if (drag?.pointer === event.pointerId) {
    movePart(drag.part, x - drag.x, y - drag.y)
  } else if (state.placing) {
    ghost = null
    if (Math.abs(x) <= bounds.width / 2 && Math.abs(y) <= bounds.height / 2) {
      ghost = { type: state.placing, id: 'ghost' }
      movePart(ghost, x, y)
    }
    redraw = true
  }
})
stage.addEventListener('pointerleave', () => { ghost = null; redraw = true })
for (const type of ['pointerup', 'pointercancel']) stage.addEventListener(type, event => {
  if (drag?.pointer !== event.pointerId) return
  const { part, originalX, originalY } = drag
  drag = null
  if (part.x !== originalX || part.y !== originalY) edited()
})

app.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !app.querySelector('dialog').open) {
    if (state.wire) { state.wire = null; refreshGraph() }
    if (state.placing) { state.placing = null; ghost = null; refreshBuild() }
  }
  if (state.screen !== 'garage' || event.target.tagName !== 'CANVAS') return
  const selected = state.machine.parts.find(part => part.id === state.selected)
  const movement = { ArrowLeft: [-0.25, 0], ArrowRight: [0.25, 0], ArrowUp: [0, 0.25], ArrowDown: [0, -0.25] }[event.key]
  if (!selected || !movement) return
  event.preventDefault()
  movePart(selected, selected.x + movement[0], selected.y + movement[1])
  edited()
})

let previous = performance.now()
let accumulator = 0
function frame(now) {
  const delta = Math.min(0.05, (now - previous) / 1000)
  previous = now
  const sim = state.simulation
  if (sim?.status === 'running') {
    accumulator += delta
    while (accumulator >= STEP && sim.status === 'running') {
      sim.step()
      accumulator -= STEP
    }
    const poses = sim.poses()
    const center = poses.reduce((sum, pose) => sum + pose.x, 0) / poses.length
    const height = poses.reduce((sum, pose) => sum + pose.y, 0) / poses.length
    camera.x += (center - camera.x) * Math.min(1, delta * 5)
    camera.y += (height - camera.y) * Math.min(1, delta * 5)
    redraw = true
    if (sim.status !== 'running') {
      runResult = sim.status
      if (runResult === 'won') {
        const id = levels[state.level].id
        state.records[id] = Math.min(state.records[id] ?? Infinity, sim.elapsed)
        persist()
      }
      updateRace()
    } else if (raceTicks++ % 5 === 0) updateRace()
  } else accumulator = 0
  if (paint && stage.isConnected) {
    const size = stage.clientWidth + 'x' + stage.clientHeight + '@' + window.devicePixelRatio
    if (redraw || lastSize !== size) {
      if (state.screen === 'race') paint(draw => drawLevel(draw, levels[state.level], sim?.poses() ?? [], camera))
      else paint(draw => drawWorkshop(draw, state.machine.parts, state.selected, ghost))
      redraw = false
      lastSize = size
    }
  }
  requestAnimationFrame(frame)
}

render()
createRenderer(stage.querySelector('canvas'), mode => {
  state.mode = mode
  footer()
  redraw = true
}).then(renderer => { paint = renderer; redraw = true })
requestAnimationFrame(frame)

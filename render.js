import { actuatorColor, bounds, capsuleSize, isRotaryMount, localVertices, parts, pistonAngle, terrainY } from './model.js'

const colors = new Map()
function rgb(hex) {
  if (!colors.has(hex)) {
    colors.set(hex, [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255))
  }
  return colors.get(hex)
}

class Drawing {
  vertices = []

  constructor(width, height) {
    this.width = width
    this.height = height
  }

  triangle(a, b, c, color) {
    const tint = rgb(color)
    for (const [x, y] of [a, b, c]) {
      this.vertices.push(2 * x / this.width - 1, 1 - 2 * y / this.height, ...tint)
    }
  }

  polygon(points, color) {
    for (let i = 1; i < points.length - 1; i++) this.triangle(points[0], points[i], points[i + 1], color)
  }

  rect(x, y, w, h, color) {
    this.polygon([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], color)
  }

  line([x, y], [ex, ey], width, color) {
    const length = Math.hypot(ex - x, ey - y)
    if (!length) return
    const dx = -(ey - y) * width / (2 * length)
    const dy = (ex - x) * width / (2 * length)
    this.polygon([[x + dx, y + dy], [ex + dx, ey + dy], [ex - dx, ey - dy], [x - dx, y - dy]], color)
  }

  circle(x, y, radius, color) {
    const steps = radius > 60 ? 40 : 24
    this.polygon(Array.from({ length: steps }, (_, i) => {
      const angle = i * 2 * Math.PI / steps
      return [x + radius * Math.cos(angle), y + radius * Math.sin(angle)]
    }), color)
  }
}

export function workshopView(width, height) {
  return { x: width / 2, y: height / 2, scale: Math.max(1, Math.min((width - 54) / bounds.width, (height - 48) / bounds.height)) }
}

function machineDrawing(draw, machine, project, scale, selected, ghost) {
  const all = new Map(machine.map(part => [part.id, part]))
  for (const part of machine) {
    const parent = all.get(part.parent)
    if (!parent) continue
    const a = project(parent.x, parent.y)
    const b = project(part.x, part.y)
    const mountWidth = isRotaryMount(part) ? 0.26 : 0.18
    draw.line(a, b, Math.max(2, scale * mountWidth), '#343944')
    const moving = parts[part.type].joint === 'prismatic'
    draw.line(a, b, Math.max(moving ? 2 : 1, scale * (moving ? 0.09 : 0.06)), moving ? actuatorColor : '#8e949d')
  }
  for (const part of ghost ? [...machine, ghost] : machine) {
    const info = parts[part.type]
    const [x, y] = project(part.x, part.y)
    const angle = part.angle ?? (info.shape === 'capsule' ? pistonAngle(part, all.get(part.parent)) : 0)
    const size = info.width * scale / 2
    const accent = part === ghost ? (info.joint ? '#a88f42' : '#798caa') : info.color
    const outline = selected === part.id ? '#ffddaa' : '#101927'
    const point = (px, py) => [x + (px * Math.cos(angle) - py * Math.sin(angle)) * scale,
      y - (px * Math.sin(angle) + py * Math.cos(angle)) * scale]
    if (info.shape === 'capsule') {
      const { halfLength, radius } = capsuleSize(part)
      const a = point(-halfLength, 0)
      const b = point(halfLength, 0)
      const pixels = radius * scale
      draw.line(a, b, 2 * (pixels + 1.5), outline)
      for (const end of [a, b]) draw.circle(...end, pixels + 1.5, outline)
      draw.line(a, b, 2 * pixels, accent)
      for (const end of [a, b]) draw.circle(...end, pixels, accent)
      draw.line(point(-halfLength, radius * 0.42), point(halfLength, radius * 0.42), 1.5, '#fff2b3')
    } else if (isRotaryMount(part)) {
      draw.circle(x, y, size + 2, outline)
      draw.circle(x, y, size, '#8e949d')
      draw.circle(x, y, size * 0.74, accent)
      draw.line([x, y], point(info.width * 0.27, 0), Math.max(2, size * 0.19), '#3c3428')
      draw.circle(x, y, size * 0.18, '#3c3428')
    } else if (info.drive) {
      draw.circle(x, y, size + 2, outline)
      draw.circle(x, y, size, '#293746')
      draw.circle(x, y, size * 0.74, accent)
      for (let i = 0; i < 6; i++) {
        const spoke = i * Math.PI / 3
        draw.line([x, y], point(Math.cos(spoke) * info.width * 0.32, Math.sin(spoke) * info.width * 0.32), Math.max(2, size * 0.16), '#3e5369')
        draw.line(point(Math.cos(spoke) * info.width * 0.43, Math.sin(spoke) * info.width * 0.43),
          point(Math.cos(spoke) * info.width * 0.49, Math.sin(spoke) * info.width * 0.49), 2, '#667b8d')
      }
      draw.circle(x, y, size * 0.23, '#e3ecf2')
    } else if (info.shape === 'circle') {
      draw.circle(x, y, size + 2, outline)
      draw.circle(x, y, size, accent)
      draw.line(point(-info.width * 0.29, 0), point(info.width * 0.29, 0), 2, '#ffe1ab')
    } else {
      const vertices = localVertices(part)
      draw.polygon(vertices.map(([px, py]) => point(px, py)), accent)
      vertices.forEach(([px, py], i) => {
        const next = vertices[(i + 1) % vertices.length]
        draw.line(point(px, py), point(...next), selected === part.id ? 2.5 : 1.5, outline)
      })
      if (info.shape === 'box') {
        const edge = info.width * 0.37
        draw.line(point(-edge, info.height * 0.25), point(edge, info.height * 0.25), 2,
          info.joint ? '#fff2b3' : '#ffe1ab')
        for (const px of [-edge, edge]) {
          const [bx, by] = point(px, 0)
          draw.circle(bx, by, Math.max(2, scale * 0.045), '#5d4d4b')
        }
      }
    }
  }
}

export function drawWorkshop(draw, machine, selected, ghost) {
  const { x, y, scale } = workshopView(draw.width, draw.height)
  const project = (px, py) => [x + px * scale, y - py * scale]
  const [left, top] = project(-bounds.width / 2, bounds.height / 2)
  const w = bounds.width * scale
  const h = bounds.height * scale
  for (let y = 0; y <= draw.height; y += 22) {
    for (let x = 0; x <= draw.width; x += 22) draw.rect(x, y, 1.3, 1.3, '#233248')
  }
  draw.rect(left, top, w, h, '#131f30')
  for (let dx = -Math.floor(bounds.width / 2); dx <= bounds.width / 2; dx++) {
    draw.rect(x + dx * scale, top, 1, h, dx === 0 ? '#3b4c63' : '#23334a')
  }
  for (let dy = -Math.floor(bounds.height); dy <= bounds.height; dy++) {
    draw.rect(left, y + dy * scale / 2, w, 1, dy === 0 ? '#3b4c63' : '#202e41')
  }
  for (const dx of [0, w]) for (const dy of [0, h]) {
    draw.rect(left + dx - (dx ? 16 : 1), top + dy - 1, 17, 2, '#ffb35e')
    draw.rect(left + dx - 1, top + dy - (dy ? 16 : 1), 2, 17, '#ffb35e')
  }
  machineDrawing(draw, machine, project, scale, selected, ghost)
}

export function drawLevel(draw, level, poses, camera) {
  const { width, height } = draw
  const scale = Math.min(50, width / 17, height / 11)
  const hasPit = level.points.some(([, y]) => y < 0)
  const floor = height * (hasPit ? 0.70 : 0.78)
  const elevation = hasPit && camera.y < 0 ? camera.y : Math.max(0, camera.y - 2)
  const project = (x, y) => [width * 0.27 + (x - camera.x) * scale, floor - (y - elevation) * scale]
  draw.rect(0, 0, width, height, level.sky)
  draw.circle(width * 0.76 - camera.x * 0.6, height * 0.23, Math.min(height * 0.13, 85), '#e7af7e')
  for (const [layer, tint] of [[0, '#25394b'], [1, '#354a59'], [2, '#415961']]) {
    const spacing = 150 + layer * 12
    const offset = (camera.x * (1.5 + layer * 2)) % spacing
    for (let i = -2; i < width / spacing + 2; i++) {
      const x = i * spacing - offset
      const y = height * (0.44 + layer * 0.07)
      draw.polygon([[x - spacing * 0.65, floor], [x, y - Math.sin(i * 83 + layer) * height * 0.12],
        [x + spacing * 0.68, floor], [x + spacing * 0.68, height], [x - spacing * 0.65, height]], tint)
    }
  }
  for (let i = 1; i < level.points.length; i++) {
    const start = level.points[i - 1]
    const end = level.points[i]
    const previous = project(...start)
    const next = project(...end)
    const pitFloor = start[1] < 0 && start[1] === end[1]
    draw.polygon([previous, next, [next[0], height + 2], [previous[0], height + 2]], level.land)
    if (pitFloor) {
      draw.rect(previous[0], previous[1], next[0] - previous[0], Math.max(6, scale * 0.22), '#9c795b')
    }
    draw.line(previous, next, 4, pitFloor ? '#e8bc88' : '#92b193')
  }
  const left = camera.x - width / scale
  const right = camera.x + width / scale
  for (let x = Math.max(-11, Math.floor(left)); x < Math.min(right, level.points.at(-1)[0]); x++) {
    const [px, py] = project(x, terrainY(level, x))
    draw.rect(px, py + 10 + (Math.sin(x * 32) + 1) * 10, scale * 0.28, 2, '#79927f')
  }
  const [startX, startY] = project(2, terrainY(level, 2))
  draw.line([startX, startY], [startX, startY - scale * 2.25], 2, '#87d7bf')
  draw.rect(startX, startY - scale * 2.25, scale * 0.8, scale * 0.45, '#87d7bf')
  const [goalX, goalY] = project(level.finish, terrainY(level, level.finish))
  draw.line([goalX, goalY], [goalX, goalY - scale * 5], 3, '#ffb35e')
  for (let row = 0; row < 4; row++) for (let col = 0; col < 6; col++) {
    draw.rect(goalX + col * scale * 0.16, goalY - scale * 5 + row * scale * 0.16,
      scale * 0.16 + 0.2, scale * 0.16 + 0.2, (row + col) % 2 ? '#1a2331' : '#fff1d6')
  }
  machineDrawing(draw, poses, project, scale)
}

const shader = `
struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) color: vec3f,
}
@vertex fn vertexMain(@location(0) position: vec2f, @location(1) color: vec3f) -> VertexOut {
  return VertexOut(vec4f(position, 0.0, 1.0), color);
}
@fragment fn fragmentMain(input: VertexOut) -> @location(0) vec4f {
  return vec4f(input.color, 1.0);
}
`

async function gpuRenderer(canvas, onLost) {
  const adapter = await navigator.gpu?.requestAdapter()
  if (!adapter) return
  const device = await adapter.requestDevice()
  const format = navigator.gpu.getPreferredCanvasFormat()
  const module = device.createShaderModule({ code: shader })
  const pipeline = await device.createRenderPipelineAsync({
    layout: 'auto',
    vertex: { module, entryPoint: 'vertexMain', buffers: [{ arrayStride: 20, attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x2' },
      { shaderLocation: 1, offset: 8, format: 'float32x3' }
    ] }] },
    fragment: { module, entryPoint: 'fragmentMain', targets: [{ format }] }
  })
  const context = canvas.getContext('webgpu')
  context.configure({ device, format, alphaMode: 'opaque' })
  device.lost.then(onLost)
  let buffer
  return vertices => {
    const data = new Float32Array(vertices)
    if (!buffer || buffer.size < data.byteLength) {
      buffer?.destroy()
      buffer = device.createBuffer({ size: Math.max(65536, data.byteLength * 2), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
    }
    if (data.length) device.queue.writeBuffer(buffer, 0, data)
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass({ colorAttachments: [{
      view: context.getCurrentTexture().createView(), clearValue: { r: 0.055, g: 0.082, b: 0.125, a: 1 },
      loadOp: 'clear', storeOp: 'store'
    }] })
    pass.setPipeline(pipeline)
    pass.setVertexBuffer(0, buffer)
    pass.draw(data.length / 5)
    pass.end()
    device.queue.submit([encoder.finish()])
  }
}

function softwareRenderer(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false })
  return vertices => {
    const { width, height } = canvas
    ctx.fillStyle = '#0e1520'
    ctx.fillRect(0, 0, width, height)
    // Batch adjacent triangles of the same color into a single Canvas path.
    let tint = ''
    ctx.beginPath()
    for (let i = 0; i < vertices.length; i += 15) {
      const color = 'rgb(' + vertices.slice(i + 2, i + 5).map(c => Math.round(c * 255)).join(',') + ')'
      if (color !== tint) {
        ctx.fill()
        ctx.beginPath()
        ctx.fillStyle = tint = color
      }
      for (let j = i; j < i + 15; j += 5) {
        ctx[j === i ? 'moveTo' : 'lineTo']((vertices[j] + 1) * width / 2, (1 - vertices[j + 1]) * height / 2)
      }
      ctx.closePath()
    }
    ctx.fill()
  }
}

export async function createRenderer(initialCanvas, onMode) {
  let canvas = initialCanvas
  let paint = (await gpuRenderer(canvas, () => {
    const replacement = canvas.cloneNode()
    canvas.replaceWith(replacement)
    canvas = replacement
    paint = softwareRenderer(canvas)
    onMode('Canvas 2D')
  }).catch(error => console.warn('WebGPU initialization failed', error)))
  onMode(paint ? 'WebGPU' : 'Canvas 2D')
  if (!paint) paint = softwareRenderer(canvas)
  return scene => {
    const { width, height } = canvas.getBoundingClientRect()
    if (width < 1 || height < 1) return
    const ratio = Math.min(2, window.devicePixelRatio || 1)
    const pixelsWide = Math.round(width * ratio)
    const pixelsHigh = Math.round(height * ratio)
    if (canvas.width !== pixelsWide) canvas.width = pixelsWide
    if (canvas.height !== pixelsHigh) canvas.height = pixelsHigh
    const drawing = new Drawing(width, height)
    scene(drawing)
    paint(drawing.vertices)
  }
}

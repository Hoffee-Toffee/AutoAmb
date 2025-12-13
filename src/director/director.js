export function initializeDirector(layers, config) {
  const activeLayers = new Map()
  const layerActivationQueue = []

  for (const [name, layer] of Object.entries(layers)) {
    if (layer.isConstant) {
      activeLayers.set(name, { intensity: 1, retirement: Infinity })
    } else {
      layerActivationQueue.push(name)
    }
  }
  // Shuffle the queue
  layerActivationQueue.sort(() => Math.random() - 0.5)
  updateActiveLayers(layers, config, activeLayers, layerActivationQueue, 0)
  return { activeLayers, layerActivationQueue }
}

export function updateActiveLayers(
  layers,
  config,
  activeLayers,
  layerActivationQueue,
  time
) {
  // Retire completed layers
  for (const [name, state] of Array.from(activeLayers.entries())) {
    if (time >= state.retirement) {
      activeLayers.delete(name)
      layerActivationQueue.push(name)
    }
  }

  // Activate new layers if there's space
  const dynamicLayerCount = Array.from(activeLayers.keys()).filter(
    (name) => !layers[name].isConstant
  ).length

  const maxDynamicLayers =
    config.maxDynamicLayers || Math.floor(Math.random() * 3) + 2

  if (dynamicLayerCount < maxDynamicLayers && layerActivationQueue.length > 0) {
    const layerToActivate = layerActivationQueue.shift()
    const duration =
      (config.layerDurationRange &&
        config.layerDurationRange.min +
          Math.random() *
            (config.layerDurationRange.max - config.layerDurationRange.min)) ||
      Math.random() * 150 + 150
    activeLayers.set(layerToActivate, {
      intensity: 0,
      retirement: time + duration,
      activationTime: time,
      duration,
    })
  }
}

export function getIntensity(layers, activeLayers, layerName, time) {
  const layerState = activeLayers.get(layerName)
  if (!layerState) {
    return 0
  }

  if (layers[layerName].isConstant) {
    return layerState.intensity
  }

  const { activationTime, duration } = layerState
  const layerProgress = (time - activationTime) / duration
  const progress = Math.max(0, Math.min(1, layerProgress))

  return Math.min(2, progress * 2)
}

export function getActiveLayers(activeLayers) {
  return Array.from(activeLayers.keys())
}

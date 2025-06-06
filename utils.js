import { promises as fs } from 'fs'
import path from 'path'
import ffmpeg from 'fluent-ffmpeg'
import { config } from './config.js'

export function poissonRandom(lambda) {
  if (lambda <= 0) return 0
  let L = Math.exp(-lambda)
  let p = 1.0
  let k = 0
  do {
    k++
    p *= Math.random()
  } while (p > L)
  return Math.max(0, k - 1) + (Math.random() < lambda ? 1 : 0)
}

export function weightedRandomFile(files, playCounts, lastPlayed) {
  const weights = files.map((file, index) => {
    if (file === lastPlayed) return 0
    return 1 / (1 + (playCounts[index] || 0))
  })

  const totalWeight = weights.reduce((sum, w) => sum + w, 0)
  if (totalWeight === 0) {
    return files[Math.floor(Math.random() * files.length)]
  }

  let random = Math.random() * totalWeight
  for (let i = 0; i < files.length; i++) {
    random -= weights[i]
    if (random <= 0) return files[i]
  }
  return files[files.length - 1]
}

export async function validateAudioFile(filePath) {
  try {
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(filePath)
        .outputOptions('-f null')
        .output('-')
        .on('end', resolve)
        .on('error', reject)
        .run()
    })
    return true
  } catch {
    return false
  }
}

export async function loadAudioFiles(layerName, layerData) {
  const layerDir = path.join(config.audioDir, layerData.category)
  const files = await fs.readdir(layerDir)
  const validFiles = {}
  const playCounts = {}
  const lastPlayedFiles = {}
  const sets = Object.keys(layerData.sets)

  for (const set of sets) {
    const setFiles = files.filter((file) =>
      new RegExp(`^${layerData.sets[set]}$`).test(file)
    )
    if (setFiles.length === 0) {
      throw new Error(`No files found for ${layerName} set: ${set}`)
    }

    validFiles[set] = []
    for (const file of setFiles) {
      const filePath = path.join(layerDir, file)
      if (await validateAudioFile(filePath)) {
        validFiles[set].push(file)
      } else {
        console.warn(`Skipping invalid ${layerName} ${set} audio file: ${file}`)
      }
    }

    if (validFiles[set].length === 0) {
      throw new Error(`No valid files found for ${layerName} set: ${set}`)
    }

    playCounts[set] = new Array(validFiles[set].length).fill(0)
    lastPlayedFiles[set] = null
  }

  return { validFiles, playCounts, lastPlayedFiles }
}

export function getIntensityForLayer(layerName, progress) {
  if (layerName !== 'breath') {
    return Math.min(2, 0.5 + progress * 1.5)
  }
  return 1 + Math.abs(Math.sin(progress * Math.PI))
}

export function interpolateIntensity(layerData, intensity) {
  const intensityKeys = Object.keys(layerData.intensity)
    .map(Number)
    .sort((a, b) => a - b)
  const lowerKey =
    intensityKeys.find((key) => key <= intensity) ?? intensityKeys[0]
  const upperKey = intensityKeys.find((key) => key > intensity) ?? lowerKey
  const weight =
    lowerKey === upperKey ? 0 : (intensity - lowerKey) / (upperKey - lowerKey)
  return { lowerKey, upperKey, weight }
}

export function calculateChancesAndCounts(
  layerName,
  layerData,
  intensity,
  lowerKey,
  upperKey
) {
  const sets = Object.keys(layerData.sets)
  const chances = {}
  const scaledChances = {}
  const counts = {}

  // Calculate weight for interpolation based on intensity
  const weight =
    lowerKey === upperKey ? 0 : (intensity - lowerKey) / (upperKey - lowerKey)

  for (const set of sets) {
    const chanceKey = `${set}_chance`
    const lowerChance =
      layerData.intensity[lowerKey][chanceKey] ??
      layerData.intensity[lowerKey].chance ??
      layerData.chance
    const upperChance =
      layerData.intensity[upperKey][chanceKey] ??
      layerData.intensity[upperKey].chance ??
      layerData.chance

    const chance = (1 - weight) * lowerChance + weight * upperChance

    chances[chanceKey] = chance
    scaledChances[`scaled${set.charAt(0).toUpperCase() + set.slice(1)}Chance`] =
      chance * (config.scheduleGranularity / config.chanceUnit)

    if (layerData.tightness === 0) {
      counts[`${set}Events`] = 0 // Handled in generateTimelineEvents
    } else {
      const stdDev = Math.sqrt(
        scaledChances[
          `scaled${set.charAt(0).toUpperCase() + set.slice(1)}Chance`
        ]
      )
      const minEvents = Math.max(
        0,
        Math.floor(
          scaledChances[
            `scaled${set.charAt(0).toUpperCase() + set.slice(1)}Chance`
          ] -
            layerData.tightness * stdDev
        )
      )
      const maxEvents = Math.ceil(
        scaledChances[
          `scaled${set.charAt(0).toUpperCase() + set.slice(1)}Chance`
        ] +
          layerData.tightness * stdDev
      )
      counts[`${set}Events`] = Math.min(
        maxEvents,
        Math.max(
          minEvents,
          poissonRandom(
            scaledChances[
              `scaled${set.charAt(0).toUpperCase() + set.slice(1)}Chance`
            ]
          )
        )
      )
    }
  }

  return { chances, scaledChances, counts }
}

export function generatePosition() {
  return {
    pan: gaussianClamp(0.5, 0.25) * (Math.random() < 0.5 ? -1 : 1),
    dist: gaussianClamp(0.75, 0.25),
  }
}

function gaussianClamp(mean, sigma) {
  // Pick a random number between 0 and 1, using the Box-Muller method
  const u = Math.random()
  const v = Math.random()
  const x = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v)
  const raw = mean + x * sigma
  return Math.min(1, Math.max(0, raw))
}

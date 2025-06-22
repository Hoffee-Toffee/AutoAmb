// Audio processing utility functions
import { promises as fs } from 'fs'
import path from 'path'
import {
  getAudioDuration as getAudioDurationCli,
  getAudioChannels as getAudioChannelsCli,
  validateAudioFile as validateAudioFileCli,
} from './ffmpegCliUtil.js'
import { gaussianClamp } from './math.js'
import { fileURLToPath } from 'url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))

export async function getAudioDuration(filePath) {
  try {
    const duration = await getAudioDurationCli(filePath)
    if (duration <= 0) {
      console.warn(
        `Invalid duration (${duration}) for ${filePath} from CLI util.`
      )
      return 0
    }
    return duration
  } catch (err) {
    console.warn(
      `Failed to get duration for ${filePath} using CLI util: ${err.message}`
    )
    return 0
  }
}

export async function getAudioChannels(filePath) {
  try {
    const channelLayout = await getAudioChannelsCli(filePath)
    return channelLayout
  } catch (err) {
    console.warn(
      `Failed to get channels for ${filePath} using CLI util: ${err.message}`
    )
    return 'unknown'
  }
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

export function selectFile(
  files,
  playCounts,
  lastPlayed,
  cycleFiles,
  setIndex
) {
  if (!files || files.length === 0) {
    console.warn('No valid files provided to selectFile')
    return null
  }

  if (cycleFiles) {
    return files[setIndex % files.length]
  }
  return weightedRandomFile(files, playCounts, lastPlayed)
}

export async function validateAudioFile(filePath) {
  try {
    const isValid = await validateAudioFileCli(filePath)
    if (!isValid) {
      console.warn(
        `Validation failed for ${filePath} (as reported by CLI util).`
      )
    }
    return isValid
  } catch (error) {
    console.warn(
      `Error during validation for ${filePath} with CLI util: ${error.message}`
    )
    return false
  }
}

export async function loadAudioFiles(layerName, layerData, config) {
  const cacheDir = path.join(__dirname, '..', '..', 'cache')
  const cacheFile = path.join(cacheDir, `${layerName}_audio_cache.json`)
  const useCache = !process.argv.includes('--no-cache')

  // Try to load from cache
  if (useCache) {
    try {
      await fs.access(cacheFile)
      const cacheData = await fs.readFile(cacheFile, 'utf8')
      const parsedCache = JSON.parse(cacheData)

      // Validate cache structure
      if (
        parsedCache.validFiles &&
        parsedCache.playCounts &&
        parsedCache.lastPlayedFiles &&
        parsedCache.durations &&
        Object.keys(parsedCache.validFiles).every((set) =>
          Object.keys(layerData.sets).includes(set)
        )
      ) {
        return parsedCache
      } else {
        console.warn(`Invalid cache for '${layerName}', regenerating...`)
      }
    } catch (error) {
      console.log(`Generating cache for '${layerName}'...`)
    }
  }

  // Process audio files if cache is not used or invalid
  const layerDir = path.join(config.audioDir, layerData.category)
  const validFiles = {}
  const playCounts = {}
  const lastPlayedFiles = {}
  const durations = {}
  const sets = Object.keys(layerData.sets)

  try {
    const filesInDir = await fs.readdir(layerDir)
    for (const set of sets) {
      const setFilesRegex = new RegExp(`^${layerData.sets[set]}$`)
      const setFiles = filesInDir.filter((file) => setFilesRegex.test(file))

      if (setFiles.length === 0) {
        console.warn(
          `No files found for ${layerName} set: ${set} in directory ${layerDir} with regex ${layerData.sets[set]}`
        )
      }

      validFiles[set] = []
      durations[set] = []
      for (const file of setFiles) {
        const filePath = path.join(layerDir, file)
        if (await validateAudioFile(filePath)) {
          const duration = await getAudioDuration(filePath)
          if (duration > 0) {
            validFiles[set].push(file)
            durations[set].push(duration)
          } else {
            console.warn(
              `Skipping ${layerName} ${set} audio file ${file}: Invalid duration (${duration})`
            )
          }
        } else {
          console.warn(
            `Skipping invalid ${layerName} ${set} audio file: ${file}`
          )
        }
      }

      if (validFiles[set].length === 0) {
        console.warn(`No valid files found for ${layerName} set: ${set}`)
      }

      playCounts[set] = new Array(validFiles[set].length).fill(0)
      lastPlayedFiles[set] = null
    }

    // Save to cache
    try {
      await fs.mkdir(cacheDir, { recursive: true })
      await fs.writeFile(
        cacheFile,
        JSON.stringify(
          { validFiles, playCounts, lastPlayedFiles, durations },
          null,
          2
        )
      )
      console.log(`Saved audio data cache for ${layerName} to ${cacheFile}`)
    } catch (error) {
      console.warn(`Failed to save cache for ${layerName}: ${error.message}`)
    }
  } catch (error) {
    console.error(
      `Error reading directory for ${layerName} (${layerDir}): ${error.message}`
    )
    for (const set of sets) {
      validFiles[set] = []
      playCounts[set] = []
      lastPlayedFiles[set] = null
      durations[set] = []
    }
  }

  return { validFiles, playCounts, lastPlayedFiles, durations }
}

export function generatePosition() {
  return {
    pan: gaussianClamp(0.5, 0.25) * (Math.random() < 0.5 ? -1 : 1),
    dist: gaussianClamp(0.75, 0.25),
  }
}

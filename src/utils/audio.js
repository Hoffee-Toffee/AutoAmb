// Audio processing utility functions
import { promises as fs } from 'fs'
import path from 'path'
// import ffmpeg from 'fluent-ffmpeg'; // Removed
import {
  getAudioDuration as getAudioDurationCli,
  getAudioChannels as getAudioChannelsCli,
  validateAudioFile as validateAudioFileCli
} from './ffmpegCliUtil.js';
import { gaussianClamp } from './math.js'

export async function getAudioDuration(filePath) {
  try {
    const duration = await getAudioDurationCli(filePath);
    if (duration <= 0) {
      console.warn(`Invalid duration (${duration}) for ${filePath} from CLI util.`);
      return 0; // Default to 0 as per original behavior
    }
    return duration;
  } catch (err) {
    console.warn(`Failed to get duration for ${filePath} using CLI util: ${err.message}`);
    return 0; // Default to 0 as per original behavior
  }
}

export async function getAudioChannels(filePath) {
  try {
    // The CLI util already maps to 'mono', 'stereo', 'quad', 'other'
    const channelLayout = await getAudioChannelsCli(filePath);
    return channelLayout;
  } catch (err) {
    console.warn(`Failed to get channels for ${filePath} using CLI util: ${err.message}`);
    return 'unknown'; // Default to 'unknown' as per original behavior
  }
}

export function weightedRandomFile(files, playCounts, lastPlayed) {
  const weights = files.map((file, index) => {
    if (file === lastPlayed) return 0
    return 1 / (1 + (playCounts[index] || 0))
  })

  const totalWeight = weights.reduce((sum, w) => sum + w, 0)
  if (totalWeight === 0) {
    // If all weights are zero (e.g., all files played recently or only one file that was lastPlayed)
    // then select a random file to avoid getting stuck.
    return files[Math.floor(Math.random() * files.length)]
  }

  let random = Math.random() * totalWeight
  for (let i = 0; i < files.length; i++) {
    random -= weights[i]
    if (random <= 0) return files[i]
  }
  return files[files.length - 1] // Fallback, should ideally not be reached if totalWeight > 0
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
    // Ensure setIndex is within bounds for the files array
    return files[setIndex % files.length]
  }
  return weightedRandomFile(files, playCounts, lastPlayed)
}

export async function validateAudioFile(filePath) {
  try {
    const isValid = await validateAudioFileCli(filePath);
    if (!isValid) {
      // ffmpegCliUtil.validateAudioFile already resolves false for invalid files.
      // It doesn't throw an error for invalid files, only for spawn/execution issues.
      // So, if it resolves to false, we log it here as per original behavior.
      console.warn(`Validation failed for ${filePath} (as reported by CLI util).`);
    }
    return isValid;
  } catch (error) {
    // This catch block would handle errors from ffmpegCliUtil if it *rejected*
    // (e.g., ffprobe/ffmpeg not found, or a truly unexpected error).
    console.warn(`Error during validation for ${filePath} with CLI util: ${error.message}`);
    return false;
  }
}

export async function loadAudioFiles(layerName, layerData, config) {
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
        if (await validateAudioFile(filePath)) { // Now uses refactored validateAudioFile
          const duration = await getAudioDuration(filePath) // Now uses refactored getAudioDuration
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
  } catch (error) {
    console.error(
      `Error reading directory for ${layerName} (${layerDir}): ${error.message}`
    )
    for (const set of sets) {
      // Ensure all sets have initialized arrays even on error
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

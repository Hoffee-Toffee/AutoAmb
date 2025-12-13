import { spawn } from 'child_process'

// Use system ffmpeg/ffprobe on Linux/macOS, fallback to Windows path if on Windows
import os from 'os';
let ffmpegPath = 'ffmpeg';
let ffprobePath = 'ffprobe';
if (process.platform === 'win32') {
  ffmpegPath = 'C:\\Users\\Admin\\Downloads\\FFmpeg\\bin\\ffmpeg.exe';
  ffprobePath = 'C:\\Users\\Admin\\Downloads\\FFmpeg\\bin\\ffprobe.exe';
}

/**
 * Executes a spawned process and returns a promise.
 * @param {string} command The command to execute.
 * @param {string[]} args The arguments for the command.
 * @param {string} commandName Friendly name for the command for error logging.
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
function spawnPromise(command, args, commandName = 'process') {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args)
    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    proc.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    proc.on('error', (err) => {
      reject(
        new Error(
          `Failed to start ${commandName}: ${err.message} (Path: ${command})`
        )
      )
    })

    proc.on('exit', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
      } else {
        reject(
          new Error(
            `${commandName} exited with code ${code}: ${stderr}. Args: ${args.join(
              ' '
            )}`
          )
        )
      }
    })
  })
}

export async function getAudioDuration(filePath) {
  const args = [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    filePath,
  ]
  try {
    const { stdout, stderr } = await spawnPromise(
      ffprobePath,
      args,
      'ffprobe (getAudioDuration)'
    )
    const duration = parseFloat(stdout.trim())
    if (isNaN(duration)) {
      throw new Error(
        `ffprobe output parsing failed for duration: "${stdout.trim()}". stderr: ${stderr}`
      )
    }
    return duration
  } catch (error) {
    throw error
  }
}

export async function getAudioChannels(filePath) {
  const args = [
    '-v',
    'error',
    '-show_entries',
    'stream=channels',
    '-select_streams',
    'a:0', // Select first audio stream
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    filePath,
  ]
  try {
    const { stdout, stderr } = await spawnPromise(
      ffprobePath,
      args,
      'ffprobe (getAudioChannels)'
    )
    const channels = parseInt(stdout.trim(), 10)
    if (isNaN(channels)) {
      throw new Error(
        `ffprobe output parsing failed for channels: "${stdout.trim()}". stderr: ${stderr}`
      )
    }
    switch (channels) {
      case 1:
        return 'mono'
      case 2:
        return 'stereo'
      case 4:
        return 'quad'
      default:
        return 'other'
    }
  } catch (error) {
    throw error
  }
}

export async function validateAudioFile(filePath) {
  const args = ['-v', 'error', '-i', filePath, '-f', 'null', '-']
  try {
    await spawnPromise(ffmpegPath, args, 'ffmpeg (validateAudioFile)')
    return true
  } catch (error) {
    // If spawnPromise rejected (non-zero exit or spawn error), consider it invalid
    // console.warn(`Validation failed for ${filePath}: ${error.message}`); // Optionally log here
    return false
  }
}

/**
 * Processes an audio chunk using ffmpeg CLI.
 * @param {Array<{path: string, options: string[]}>} inputs Array of input objects, each with path and an array of options.
 * @param {string} outputPath Path for the processed output file.
 * @param {string} complexFilter The complex filter string for -lavfi.
 * @param {number} duration Desired duration of the output in seconds.
 * @param {string[]} globalInputOptions Array of global options to apply before all inputs (e.g., ['-guess_layout_max 0']).
 * @param {string[]} outputOptions Array of options for the output (e.g., ['-ar', '44100', '-ac', '2']).
 * @returns {Promise<boolean>} True on success.
 */
export async function processAudioChunk(
  inputs,
  outputPath,
  complexFilter,
  duration,
  globalInputOptions = [],
  outputOptions = []
) {
  const args = []

  // Add global input options (these apply before any per-input options or -i flags)
  globalInputOptions.forEach((opt) => args.push(...opt.split(' ')))

  // Add per-input options and input files
  inputs.forEach((input) => {
    if (input.options && Array.isArray(input.options)) {
      input.options.forEach((opt) => args.push(...opt.split(' ')))
    }
    args.push('-i', input.path)
  })

  // Add complex filter
  if (complexFilter) {
    args.push('-lavfi', complexFilter)
  }

  // Add output options
  outputOptions.forEach((opt) => args.push(...opt.split(' ')))

  // Add duration
  if (duration !== null && duration !== undefined) {
    args.push('-t', duration.toString())
  }

  // Add output path
  args.push(outputPath)

  // Overwrite output file if it exists
  args.push('-y')

  try {
    await spawnPromise(ffmpegPath, args, 'ffmpeg (processAudioChunk)')
    return true
  } catch (error) {
    // Rethrow to be caught by the caller in chunkProcessor.js
    throw error
  }
}

/**
 * Concatenates multiple audio files into a single output file using ffmpeg's concat protocol.
 * @param {string[]} tempFiles An array of absolute paths to the temporary audio files to be concatenated.
 * @param {string} outputPath The absolute path for the final concatenated output file.
 * @param {string[]} outputOptions Optional array of output options for ffmpeg (e.g., ['-ar', '44100']). Default is ['-c', 'copy'].
 * @returns {Promise<boolean>} True on success.
 */
export async function concatenateFilesCli(
  tempFiles,
  outputPath,
  outputOptions = ['-c', 'copy']
) {
  if (!tempFiles || tempFiles.length === 0) {
    throw new Error('No temporary files provided for concatenation.')
  }

  const concatInput = `concat:${tempFiles.join('|')}`

  const args = [
    '-y', // Overwrite output file if it exists
    '-i',
    concatInput,
    ...outputOptions,
    outputPath,
  ]

  try {
    await spawnPromise(ffmpegPath, args, 'ffmpeg (concatenateFilesCli)')
    return true
  } catch (error) {
    console.error(`Concatenation error. Input string: ${concatInput}`)
    throw error
  }
}

import ffmpeg from 'fluent-ffmpeg'
import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { getAudioDuration, getAudioChannels } from '../utils/audio.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const outputDir = path.join(__dirname, '../../out')

export async function ensureOutputDir() {
  try {
    await fs.mkdir(outputDir, { recursive: true })
  } catch (err) {
    console.error(`Failed to create output directory: ${err.message}`)
    throw err
  }
}

export async function generateFilterComplex(
  allEvents,
  chunkStartTime,
  config,
  chunkIndex
) {
  const eventTimes = []
  const timelineLogEntries = []

  const filters = await Promise.all(
    allEvents.map(async (event, index) => {
      const duration = event.duration ?? (await getAudioDuration(event.file))
      const delay =
        event.start === chunkStartTime
          ? 0
          : Math.max(0, event.start - chunkStartTime + (event.offset || 0))

      eventTimes.push(delay)
      timelineLogEntries.push({
        chunk: chunkIndex,
        startTime: event.start,
        volume: event.volume * config.volume,
        filename: event.filename,
        playCount: event.playCount,
        delay: delay * 1000,
        set: event.set,
        layer: event.layer,
        pan: event.pan,
        dist: event.dist,
        offset: event.offset || 0,
        duration,
      })

      const channels = await getAudioChannels(event.file)
      const leftGain = event.pan !== undefined ? (1 - event.pan) / 2 : 0.5
      const rightGain = event.pan !== undefined ? (1 + event.pan) / 2 : 0.5
      let preprocessFilter = ''
      let lastLabel = `${index}:a`

      if (channels === 'quad') {
        preprocessFilter = `pan=stereo|c0=c0+c2|c1=c1+c3[a${index}_pre]`
        lastLabel = `a${index}_pre`
      } else if (channels === 'mono') {
        preprocessFilter = `aformat=channel_layouts=stereo[a${index}_pre]`
        lastLabel = `a${index}_pre`
      } else if (channels !== 'stereo') {
        preprocessFilter = `aformat=channel_layouts=stereo[a${index}_pre]`
        lastLabel = `a${index}_pre`
      }

      const formatFilter = `aformat=channel_layouts=stereo[a${index}_fmt]`
      const panFilter =
        event.pan !== undefined
          ? `pan=stereo|c0=${leftGain.toFixed(3)}*c0|c1=${rightGain.toFixed(
              3
            )}*c1[a${index}_pan]`
          : ''
      const volumeFilter = `volume=${(
        event.volume *
        config.volume *
        (event.dist ?? 1)
      ).toFixed(3)}[a${index}]`

      let currentInputLabel = `a${index}_fmt`
      const chainParts = []

      // Input stream is [index:a]
      // Preprocessing
      if (preprocessFilter) {
        chainParts.push(`[${index}:a]${preprocessFilter}`)
        currentInputLabel = `a${index}_pre`
      } else {
        currentInputLabel = `${index}:a`
      }

      // Format filter
      chainParts.push(`[${currentInputLabel}]${formatFilter}`)
      currentInputLabel = `a${index}_fmt`

      // Pad filter (replacing delay)
      const padFilter = `apad=start_duration=${delay.toFixed(3)}s[a${index}_pad]`;
      chainParts.push(`[${currentInputLabel}]${padFilter}`);
      currentInputLabel = `a${index}_pad`;

      // Pan filter
      if (panFilter) {
        chainParts.push(`[${currentInputLabel}]${panFilter}`)
        currentInputLabel = `a${index}_pan`
      }

      // Pitch and speed adjustment
      if (event.pitchSpeedFactor && event.pitchSpeedFactor !== 1) {
        const pitchFactor = event.pitchSpeedFactor
        const sampleRate = 44100 * pitchFactor // Assuming base sample rate is 44100
        const pitchFilter = `asetrate=${sampleRate.toFixed(0)}[a${index}_pitch]`
        chainParts.push(`[${currentInputLabel}]${pitchFilter}`)
        currentInputLabel = `a${index}_pitch`

        const tempoFilter = `atempo=${(1 / pitchFactor).toFixed(
          3
        )}[a${index}_tempo]`
        chainParts.push(`[${currentInputLabel}]${tempoFilter}`)
        currentInputLabel = `a${index}_tempo`
      }

      // Volume filter
      chainParts.push(`[${currentInputLabel}]${volumeFilter}`)
      // Final output label for this event's chain is a${index}

      return chainParts.filter(Boolean).join(';')
    })
  )

  const filterChainString = filters.join(';')
  const mixInputs = eventTimes.map((_, index) => `[a${index}]`).join('')
  const mixFilter = `${mixInputs}amix=inputs=${eventTimes.length}:duration=longest[amixed]`
  const finalVolumeFilter = `[amixed]volume=${config.volume}[a]`

  const fullFilterComplex = [filterChainString, mixFilter, finalVolumeFilter]
    .filter(Boolean)
    .join(';')
  return {
    filterComplexString: fullFilterComplex,
    eventTimes,
    timelineLogEntries,
  }
}

export async function processChunk(
  chunkIndex,
  chunkEvents,
  chunkStartTime,
  chunkEndTime,
  carryOverEvents = [],
  config
) {
  await ensureOutputDir()
  const tempFile = path.join(outputDir, `temp_chunk_${chunkIndex}.mp3`)
  const actualChunkDuration = chunkEndTime - chunkStartTime
  const nextChunkEvents = []
  const allEvents = [...carryOverEvents, ...chunkEvents]

  if (allEvents.length > 0) {
    const ff = ffmpeg()
    let finalTimelineLog = []

    // Determine which events carry over to the next chunk
    for (const event of allEvents) {
      const duration = event.duration ?? (await getAudioDuration(event.file))
      const eventEndTime = event.start + duration - (event.offset || 0)

      if (eventEndTime > chunkEndTime) {
        const durationInCurrentChunk =
          chunkEndTime - event.start + (event.offset || 0)
        nextChunkEvents.push({
          ...event,
          offset: (event.offset || 0) + durationInCurrentChunk,
          start: chunkEndTime, // Start time for the next segment is the current chunk's end time
        })
      }
      ff.input(event.file)
      if (event.offset) {
        ff.inputOptions([`-ss ${event.offset.toFixed(3)}`])
      }
    }

    // Pass config to generateFilterComplex
    const { filterComplexString, eventTimes, timelineLogEntries } =
      await generateFilterComplex(allEvents, chunkStartTime, config, chunkIndex)
    finalTimelineLog = timelineLogEntries

    if (!filterComplexString || eventTimes.length === 0) {
      return new Promise((resolve, reject) => {
        ffmpeg()
          .input('anullsrc=r=44100:cl=stereo')
          .inputFormat('lavfi')
          .outputOptions(['-ar 44100', '-ac 2'])
          .duration(actualChunkDuration)
          .output(tempFile)
          .on('end', async () => {
            try {
              const stats = await fs.stat(tempFile)
              console.log(
                `Empty chunk ${chunkIndex} (no valid filterable events) generated: ${tempFile}, size: ${stats.size} bytes`
              )
              resolve({
                tempFile,
                timelineLog: finalTimelineLog,
                nextChunkEvents,
              })
            } catch (err) {
              reject(err)
            }
          })
          .on('error', (err, stdout, stderr) => {
            console.error(
              `FFmpeg error for empty chunk ${chunkIndex} (no filterable events): ${err.message}`
            )
            console.error(`FFmpeg stderr: ${stderr}`)
            reject(err)
          })
          .run()
      })
    }

    await new Promise((resolve, reject) => {
      ff.inputOptions('-guess_layout_max 0')
        .complexFilter(filterComplexString)
        .outputOptions(['-map [a]', '-ar 44100', '-ac 2'])
        .duration(actualChunkDuration)
        .output(tempFile)
        .on('end', async () => {
          try {
            const stats = await fs.stat(tempFile)
            console.log(
              `Chunk ${chunkIndex} generated: ${tempFile}, size: ${stats.size} bytes`
            )
            resolve({
              tempFile,
              timelineLog: finalTimelineLog,
              nextChunkEvents,
            })
          } catch (err) {
            reject(err)
          }
        })
        .on('error', (err, stdout, stderr) => {
          console.error(`FFmpeg error for chunk ${chunkIndex}: ${err.message}`)
          console.error(`FFmpeg stderr: ${stderr}`)
          reject(err)
        })
        .run()
    })

    return { tempFile, timelineLog: finalTimelineLog, nextChunkEvents }
  } else {
    await ensureOutputDir()
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input('anullsrc=r=44100:cl=stereo')
        .inputFormat('lavfi')
        .outputOptions(['-ar 44100', '-ac 2'])
        .duration(actualChunkDuration)
        .output(tempFile)
        .on('end', async () => {
          try {
            const stats = await fs.stat(tempFile)
            console.log(
              `Empty chunk ${chunkIndex} (no initial events) generated: ${tempFile}, size: ${stats.size} bytes`
            )
            resolve({ tempFile, timelineLog: [], nextChunkEvents: [] })
          } catch (err) {
            reject(err)
          }
        })
        .on('error', (err, stdout, stderr) => {
          console.error(
            `FFmpeg error for empty chunk ${chunkIndex}: ${err.message}`
          )
          console.error(`FFmpeg stderr: ${stderr}`)
          reject(err)
        })
        .run()
    })
    return { tempFile, timelineLog: [], nextChunkEvents: [] }
  }
}

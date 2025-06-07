import ffmpeg from 'fluent-ffmpeg'
import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { config } from './config.js'
import { getAudioDuration, getAudioChannels } from './utils.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export async function processChunk(
  chunkIndex,
  chunkEvents,
  chunkStartTime,
  chunkEndTime,
  carryOverEvents = []
) {
  const tempFile = path.join(__dirname, `temp_chunk_${chunkIndex}.mp3`)
  const actualChunkDuration = chunkEndTime - chunkStartTime
  const nextChunkEvents = []
  const allEvents = [...carryOverEvents, ...chunkEvents]

  if (allEvents.length > 0) {
    const ff = ffmpeg()
    const eventTimes = []
    const timelineLog = []

    for (const event of allEvents) {
      const duration = event.duration ?? (await getAudioDuration(event.file))
      const delay =
        event.start === chunkStartTime
          ? 0
          : Math.max(0, event.start - chunkStartTime + (event.offset || 0))
      const eventEndTime = event.start + duration - (event.offset || 0)

      if (eventEndTime > chunkEndTime) {
        const durationInCurrentChunk =
          chunkEndTime - event.start + (event.offset || 0)
        nextChunkEvents.push({
          ...event,
          offset: (event.offset || 0) + durationInCurrentChunk,
          start: chunkEndTime,
        })
      }

      ff.input(event.file)
      if (event.offset) {
        ff.inputOptions([`-ss ${event.offset.toFixed(3)}`])
      }
      eventTimes.push(delay)
      timelineLog.push({
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
    }

    const filters = await Promise.all(
      eventTimes.map(async (time, index) => {
        const event = allEvents[index]
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
        const delayFilter = `adelay=${Math.round(time * 1000)}|${Math.round(
          time * 1000
        )}[a${index}_delay]`

        const chain = [
          preprocessFilter ? `[${index}:a]${preprocessFilter}` : '',
          `[${
            preprocessFilter ? `a${index}_pre` : `${index}:a`
          }]${formatFilter}`,
          `[a${index}_fmt]${delayFilter}`,
          `[a${index}_delay]${panFilter || volumeFilter}`,
          panFilter ? `[a${index}_pan]${volumeFilter}` : '',
        ]
          .filter(Boolean)
          .join(';')

        return chain
      })
    )

    const filterChain = filters.join(';')
    const mix =
      eventTimes.map((_, index) => `[a${index}]`).join('') +
      `amix=inputs=${eventTimes.length}:duration=longest[amixed]`
    const finalVolume = `[amixed]volume=${config.volume}[a]`
    const filterComplex = [filterChain, mix, finalVolume].join(';')

    await new Promise((resolve, reject) => {
      ff.inputOptions('-guess_layout_max 0')
        .complexFilter(filterComplex)
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
              tempFile: path.relative(__dirname, tempFile),
              timelineLog,
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

    return {
      tempFile: path.relative(__dirname, tempFile),
      timelineLog,
      nextChunkEvents,
    }
  } else {
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
              `Empty chunk ${chunkIndex} generated: ${tempFile}, size: ${stats.size} bytes`
            )
            resolve({
              tempFile: path.relative(__dirname, tempFile),
              timelineLog: [],
              nextChunkEvents: [],
            })
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

    return {
      tempFile: path.relative(__dirname, tempFile),
      timelineLog: [],
      nextChunkEvents: [],
    }
  }
}

export async function concatenateChunks(tempFiles) {
  await new Promise((resolve, reject) => {
    ffmpeg()
      .input(`concat:${tempFiles.join('|')}`)
      .outputOptions(['-c copy', '-ar 44100', '-ac 2'])
      .output(path.join(__dirname, config.outputFile))
      .on('end', async () => {
        try {
          const stats = await fs.stat(path.join(__dirname, config.outputFile))
          console.log(
            `Concatenation complete: ${config.outputFile}, size: ${stats.size} bytes`
          )
          resolve()
        } catch (err) {
          reject(err)
        }
      })
      .on('error', (err, stdout, stderr) => {
        console.error(`FFmpeg error during concatenation: ${err.message}`)
        console.error(`FFmpeg stderr: ${stderr}`)
        reject(err)
      })
      .run()
  })
}

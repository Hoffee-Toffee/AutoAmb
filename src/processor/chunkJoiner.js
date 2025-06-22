import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { ensureOutputDir } from './chunkProcessor.js'
import { concatenateFilesCli } from '../utils/ffmpeg.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const outputDir = path.join(__dirname, '../../out')

export async function concatenateChunks(tempFiles, config) {
  await ensureOutputDir()

  if (!tempFiles || tempFiles.length === 0) {
    console.warn('No temporary files to concatenate.')
  }

  const outputFile = path.join(outputDir, config.outputFile)

  for (const file of tempFiles) {
    try {
      await fs.access(file)
    } catch (err) {
      // Log the problematic file path
      console.error(`Error accessing temporary file: ${file}`, err)
      throw new Error(
        `Temporary file not found: ${file}. Concatenation cannot proceed.`
      )
    }
  }

  if (tempFiles.length === 0) {
    console.log(
      'No chunks to concatenate. Output file will not be created by concatenation process.'
    )
    return
  }

  const validTempFiles = tempFiles.filter((f) => f && typeof f === 'string')
  if (validTempFiles.length === 0) {
    console.error('No valid temporary files to concatenate after filtering.')
    throw new Error('No valid temporary files to concatenate.')
  }

  try {
    await concatenateFilesCli(
      validTempFiles,
      outputFile,
      ['-c', 'copy', '-ar', '44100', '-ac', '2'] // Original output options
    )
    const stats = await fs.stat(outputFile)
    console.log(
      `Concatenation complete: ${outputFile}, size: ${stats.size} bytes`
    )
  } catch (error) {
    throw error
  }
}

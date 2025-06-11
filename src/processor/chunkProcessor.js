import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getAudioDuration, getAudioChannels } from '../utils/audio.js';
import { processAudioChunk as processAudioChunkCli } from '../utils/ffmpegCliUtil.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(__dirname, '../../out');

export async function ensureOutputDir() {
  try {
    await fs.mkdir(outputDir, { recursive: true });
  } catch (err) {
    console.error(`Failed to create output directory: ${err.message}`);
    throw err;
  }
}

export async function generateFilterComplex(
  allEvents, // Should be eventsWithSourceDuration from processChunk
  chunkStartTime,
  config,
  chunkIndex,
  actualChunkDuration
) {
  const timelineLogEntries = [];
  const anullsrcDefinitions = [];

  const eventFilterChainsPromises = allEvents.map(async (event, index) => {
    // event.sourceFullDuration and event.sourceOffset are expected to be pre-calculated
    const sourceFullDuration = event.sourceFullDuration;
    const sourceOffsetForThisSegment = event.sourceOffset; // How much of the start of the source file to skip

    const positioningDelay = event.start === chunkStartTime ? 0 : Math.max(0, event.start - chunkStartTime);

    // Duration of the source material available *after* considering its internal offset
    const availableSourceMaterialDuration = sourceFullDuration - sourceOffsetForThisSegment;

    // How much of this event can theoretically play in the current chunk's remaining time
    const maxPlayableDurationInChunk = actualChunkDuration - positioningDelay;

    // The actual duration to trim this event segment to for *this* chunk
    // Ensure trimDuration is not negative if sourceOffset is greater than sourceFullDuration (should not happen with valid inputs for availableSourceMaterialDuration)
    const trimDurationForChunk = Math.max(0.001, Math.min(Math.max(0, availableSourceMaterialDuration), maxPlayableDurationInChunk));

    timelineLogEntries.push({
      chunk: chunkIndex,
      startTime: event.start, // Original scheduled start time
      volume: event.volume * config.volume,
      filename: event.filename,
      playCount: event.playCount,
      delay: positioningDelay * 1000, // Delay within the chunk
      set: event.set,
      layer: event.layer,
      pan: event.pan,
      dist: event.dist,
      offset: sourceOffsetForThisSegment, // Log the offset used for -ss
      duration: trimDurationForChunk, // Log the actual trimmed duration for this chunk
      sourceFullDuration: sourceFullDuration,
    });

    const channels = await getAudioChannels(event.file);
    const leftGain = event.pan !== undefined ? (1 - event.pan) / 2 : 0.5;
    const rightGain = event.pan !== undefined ? (1 + event.pan) / 2 : 0.5;

    const chainParts = [];
    let currentInputLabel = `${index}:a`;

    if (channels === 'quad') {
      chainParts.push(`[${currentInputLabel}]pan=stereo|c0=c0+c2|c1=c1+c3[a${index}_pre]`);
      currentInputLabel = `a${index}_pre`;
    } else if (channels === 'mono' || (channels !== 'stereo' && channels !== 'other')) {
      // if 'other', it might already be stereo or more; let aformat handle it.
      // if mono, convert to stereo.
      chainParts.push(`[${currentInputLabel}]aformat=channel_layouts=stereo[a${index}_pre]`);
      currentInputLabel = `a${index}_pre`;
    }

    chainParts.push(`[${currentInputLabel}]aformat=channel_layouts=stereo[a${index}_fmt]`);
    currentInputLabel = `a${index}_fmt`;

    const atrimFilterString = `atrim=start=0:duration=${trimDurationForChunk.toFixed(6)}`;
    chainParts.push(`[${currentInputLabel}]${atrimFilterString}[a${index}_trimmed]`);
    currentInputLabel = `a${index}_trimmed`;

    if (positioningDelay > 0.001) {
      const silenceLabel = `silence_for_${index}`;
      // Use -t <duration> for anullsrc input option, removing duration from the anullsrc filter string itself.
      // The anullsrc filter itself doesn't need duration if it's provided as an input option.
      // So we define the anullsrc, and then it will be used as an input with its own -t.
      // This means we need to handle anullsrc as a separate input in the main ffmpeg command.
      // This is getting complex. Let's try simpler: provide duration directly in anullsrc filter string if possible,
      // but ensure it's compatible. The error "Option 'duration' not found" suggests it's not.
      // Let's try `anullsrc=cl=stereo:r=44100,duration=${positioningDelay.toFixed(6)}` as a filter graph description.
      // No, the error is specifically about the anullsrc filter options.
      // The most compatible way for older ffmpeg is to treat anullsrc as an input and specify -t for it.
      // This requires significant restructuring of how filters and inputs are assembled.

      // Simpler attempt for anullsrc within filter_complex: use `trim` on an anullsrc.
      // This is a workaround if direct duration options fail.
      // anullsrc by default is infinite. We create it, then trim it, then concat.
      anullsrcDefinitions.push(`anullsrc=channel_layout=stereo:sample_rate=44100[${silenceLabel}_base]`);
      anullsrcDefinitions.push(`[${silenceLabel}_base]atrim=duration=${positioningDelay.toFixed(6)}[${silenceLabel}]`);
      const concatFilterString = `[${silenceLabel}][${currentInputLabel}]concat=n=2:v=0:a=1[a${index}_positioned]`;
      chainParts.push(concatFilterString);
      currentInputLabel = `a${index}_positioned`;
    }

    if (event.pan !== undefined) {
      const panFilterString = `pan=stereo|c0=${leftGain.toFixed(3)}*c0|c1=${rightGain.toFixed(3)}*c1[a${index}_pan]`;
      chainParts.push(`[${currentInputLabel}]${panFilterString}`);
      currentInputLabel = `a${index}_pan`;
    }

    if (event.pitchSpeedFactor && event.pitchSpeedFactor !== 1) {
      const pitchFactor = event.pitchSpeedFactor;
      const sampleRate = 44100 * pitchFactor;
      chainParts.push(`[${currentInputLabel}]asetrate=${sampleRate.toFixed(0)}[a${index}_pitch]`);
      currentInputLabel = `a${index}_pitch`;
      // If speed also needs to be preserved (only pitch shift), an atempo filter would be needed.
      // Current: changes speed and pitch.
    }

    const volValue = (event.volume * config.volume * (event.dist ?? 1)).toFixed(3);
    chainParts.push(`[${currentInputLabel}]volume=${volValue}[a${index}_volumed]`);
    currentInputLabel = `a${index}_volumed`;

    const samplesForWholeDur = Math.round(actualChunkDuration * 44100); // Assuming 44100Hz sample rate
    const apadFilterString = `apad=whole_len=${samplesForWholeDur}`;
    chainParts.push(`[${currentInputLabel}]${apadFilterString}[final_a${index}]`);

    return chainParts.filter(Boolean).join(';');
  });

  const eventFilterChainsStrings = (await Promise.all(eventFilterChainsPromises)).filter(s => s && s.length > 0);
  const mainFilterChainString = eventFilterChainsStrings.join(';');

  const segments = [];
  if (anullsrcDefinitions.length > 0) {
    segments.push(anullsrcDefinitions.join(';'));
  }
  if (mainFilterChainString) {
    segments.push(mainFilterChainString);
  }

  if (allEvents.length > 0 && eventFilterChainsStrings.length > 0) { // Only add mix if there are actual event chains
    const mixInputs = allEvents.map((_, index) => `[final_a${index}]`).join('');
    const amixDurationParam = actualChunkDuration.toFixed(6);
    const mixFilter = `${mixInputs}amix=inputs=${allEvents.length}:duration=${amixDurationParam}:dropout_transition=0[amixed]`;
    segments.push(mixFilter);
    segments.push(`[amixed]volume=${config.volume}[a]`); // Final master volume
  } else if (allEvents.length > 0 && eventFilterChainsStrings.length === 0) {
    // Edge case: events existed, but none resulted in a filter chain (e.g., all trimmed to zero effectively)
    // Fallback to silence for the chunk duration.
    // Use anullsrc filter with atrim to set duration for compatibility.
    segments.push(`anullsrc=channel_layout=stereo:sample_rate=44100[silence_base_chunk];[silence_base_chunk]atrim=duration=${actualChunkDuration.toFixed(6)}[a]`);
  }
  // If allEvents is empty, segments will be empty, leading to an empty filter string.

  const fullFilterComplex = segments.filter(Boolean).join(';');

  return {
    filterComplexString: fullFilterComplex,
    timelineLogEntries,
  };
}

export async function processChunk(
  chunkIndex,
  chunkEvents,
  chunkStartTime,
  chunkEndTime,
  carryOverEvents = [],
  config
) {
  await ensureOutputDir();
  const tempFile = path.join(outputDir, `temp_chunk_${chunkIndex}.mp3`);
  const actualChunkDuration = chunkEndTime - chunkStartTime;
  const nextChunkEvents = [];
  const allEvents = [...carryOverEvents, ...chunkEvents];

  try {
    if (allEvents.length > 0) {
      const inputsForCli = [];
      const eventsWithSourceInfo = []; // To pass to generateFilterComplex

      for (const event of allEvents) {
        const sourceFullDuration = event.duration ?? (await getAudioDuration(event.file));
        const sourceOffset = event.offset || 0;

        eventsWithSourceInfo.push({
          ...event,
          sourceFullDuration: sourceFullDuration,
          sourceOffset: sourceOffset,
        });

        const inputEntry = { path: event.file, options: [] };
        if (sourceOffset > 0.001) {
          inputEntry.options.push('-ss', sourceOffset.toFixed(6));
        }
        inputsForCli.push(inputEntry);
      }

      const { filterComplexString, timelineLogEntries } =
        await generateFilterComplex(eventsWithSourceInfo, chunkStartTime, config, chunkIndex, actualChunkDuration);

      // Determine nextChunkEvents based on timelineLogEntries (which have calculated trimmed durations)
      for (const loggedEvent of timelineLogEntries) {
         // Find the original event details from eventsWithSourceInfo to access sourceFullDuration and initial sourceOffset
        const originalEventDetails = eventsWithSourceInfo.find(
            e => e.filename === loggedEvent.filename && e.start === loggedEvent.startTime && e.sourceOffset === loggedEvent.offset
        );

        if (originalEventDetails) {
            const playedDurationInThisChunk = loggedEvent.duration; // This is trimDurationForChunk
            const newOffsetForNextSourceFile = originalEventDetails.sourceOffset + playedDurationInThisChunk;

            if (originalEventDetails.sourceFullDuration > newOffsetForNextSourceFile + 0.001) { // Check if significant audio remains
                nextChunkEvents.push({
                    ...originalEventDetails, // Carry over original event data (like file, volume, pan etc.)
                    offset: newOffsetForNextSourceFile, // This is the new -ss value for the *original* source file
                    start: chunkEndTime, // Start time for this event in the next chunk's timeline
                    // duration (original full duration) is already part of originalEventDetails
                });
            }
        }
      }

      if (!filterComplexString && allEvents.length > 0) {
        // This case means generateFilterComplex decided no audio from events should play (e.g. all events are outside chunk bounds after delay)
        // but allEvents was not empty. We should still generate silence.
        console.log(`Generating empty chunk ${chunkIndex} (events present, but no resulting filter from generateFilterComplex)`);
        // Use anullsrc with -t option for the input, not in the path string.
        const silentInput = [{ path: `anullsrc=r=44100:cl=stereo`, options: ['-f', 'lavfi', '-t', actualChunkDuration.toFixed(6)] }];
        await processAudioChunkCli(
          silentInput,
          tempFile,
          null,
          actualChunkDuration,
          [],
          ['-ar', '44100', '-ac', '2']
        );
      } else {
        await processAudioChunkCli(
          inputsForCli,
          tempFile,
          filterComplexString,
          actualChunkDuration,
          ['-guess_layout_max', '0'],
          ['-map', '[a]', '-ar', '44100', '-ac', '2']
        );
      }

      const stats = await fs.stat(tempFile);
      console.log(`Chunk ${chunkIndex} processed: ${tempFile}, size: ${stats.size} bytes`);
      return { tempFile, timelineLog: timelineLogEntries, nextChunkEvents };

    } else {
      // Handle empty chunk (no initial events)
      console.log(`Generating empty chunk ${chunkIndex} (no initial events)`);
      // Use anullsrc with -t option for the input.
      const silentInput = [{ path: `anullsrc=r=44100:cl=stereo`, options: ['-f', 'lavfi', '-t', actualChunkDuration.toFixed(6)] }];
      await processAudioChunkCli(
        silentInput,
        tempFile,
        null,
        actualChunkDuration,
        [],
        ['-ar', '44100', '-ac', '2']
      );
      const stats = await fs.stat(tempFile);
      console.log(`Empty chunk ${chunkIndex} generated: ${tempFile}, size: ${stats.size} bytes`);
      return { tempFile, timelineLog: [], nextChunkEvents: [] };
    }
  } catch (error) {
    console.error(`Error processing chunk ${chunkIndex}: ${error.message}`);
    throw error;
  }
}

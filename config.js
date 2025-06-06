import ffmpeg from 'fluent-ffmpeg'
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg'

ffmpeg.setFfmpegPath(ffmpegInstaller.path)

export const config = {
  audioDir: 'C:\\Users\\Admin\\Music\\Amb Cats',
  outputFile: 'output.mp3',
  duration: 300,
  chunkDuration: 30,
  scheduleGranularity: 0.1,
  chanceUnit: 1,
}

export const layers = {
  drip: {
    category: 'drp',
    volume: 0.1,
    sets: {
      solo: 'water_drips_((0[4-9])|([1-9][0-9])).ogg',
      norm: 'water_drips_0[0-3].ogg',
    },
    intensity: {
      0: { volume: 0.1, solo_chance: 0.1, norm_chance: 0 },
      0.5: { volume: 0.5, solo_chance: 0.25, norm_chance: 0 },
      1: { volume: 1, solo_chance: 0.5, norm_chance: 0 },
      2: { volume: 3, solo_chance: 0.5, norm_chance: 0.5 },
    },
    tightness: 0.1,
    directionality: 'unique',
  },
  breath: {
    category: 'isc',
    volume: 1,
    sets: {
      in: 'isac_vx_breathing_hlmt01_(0[0-4]).ogg',
      out: 'isac_vx_breathing_hlmt01_(0[5-9]).ogg',
      // asphyx: 'isac_vx_breath_asphyxiation_hlmt01_\\d{2}.ogg',
    },
    intensity: {
      0: { volume: 2, chance: 1 / 4 },
      2: { volume: 3, chance: 1 / 2.5 },
      // 1: { volume: 2, chance: 1 / 4, asphyx_chance: 0 },
      // 1.5: { volume: 2, chance: 1 / 2.5 },
      // 2: { volume: 3, chance: 0, asphyx_chance: 1 / 2 },
    },
    tightness: 0,
    directionality: 'none',
    offset: 1,
  },
  // room: {
  //   category: 'amb',
  //   volume: 0.01,
  //   sets: {
  //     norm: 'amb_generic_room_tone_\\d{2}.exa.ogg',
  //   },
  //   intensity: {
  //     0: { volume: 0.1, chance: 1 },
  //     2: { volume: 0.1, chance: 1 },
  //   },
  //   tightness: 0,
  //   overlap: true,
  //   directionality: 'none',
  // },
  clang: {
    category: 'met',
    volume: 0.1,
    sets: {
      air: 'amb_air_release_\\d{2}.ogg',
      scuffles: 'amb_quadshot_airvent_scuffles_\\d{2}.exa.ogg',
      pipe: 'amb_quadshot_pipe_stress_(lite|med|lrg)_[a-z]_\\d{2}\\.exa\\.ogg',
    },
    intensity: {
      0: { volume: 0.25, chance: 1 / 40 },
      1.5: { volume: 0.5, chance: 1 / 30 },
      2: { volume: 1, chance: 1 / 25 },
    },
    tightness: 0.5,
    directionality: 'unique',
  },
  annc: {
    category: 'sfx',
    volume: 0.25,
    sets: {
      norm: 'audio_pa_02_04.exa.ogg',
    },
    intensity: {
      0: { volume: 0.25, chance: 1 / 45 },
    },
    tightness: 0,
    directionality: 'shared',
  },
}

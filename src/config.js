export default {
  config: {
    audioDir: 'C:\\Users\\Admin\\Music\\Amb Cats',
    outputFile: 'output.mp3',
    duration: 60 * 5,
    chunkDuration: 30,
    scheduleGranularity: 0.1,
    frequencyUnit: 1,
    volume: 2,
  },
  layers: {
    // bg: {
    //   category: 'amb',
    //   volume: 1,
    //   sets: {
    //     // bg: 'amb_empty_trans_hub.exa.ogg',
    //     bg: 'amb_mainframe_inactive.exa.ogg',
    //   },
    //   intensity: {
    //     0: { volume: 1, frequency: 0 },
    //   },
    //   variance: 0,
    //   bufferBetweenSounds: true,
    // },
    drip: {
      category: 'drp',
      volume: 0.1,
      sets: {
        solo: 'water_drips_((0[4-9])|([1-9][0-9])).ogg',
        norm: 'water_drips_0[0-3].ogg',
      },
      intensity: {
        0: { volume: 0.1, solo_frequency: 1 / 10, norm_frequency: 1 / 10 },
        0.5: { volume: 0.5, solo_frequency: 1 / 4, norm_frequency: 1 / 10 },
        1: { volume: 1, solo_frequency: 1 / 2, norm_frequency: 1 / 10 },
        2: { volume: 3, solo_frequency: 1 / 2, norm_frequency: 1 / 2 },
      },
      variance: 0.1,
      directionality: 'unique',
      pitchSpeedRange: [0.9, 1.1],
    },
    breath: {
      category: 'isc',
      volume: 5,
      sets: {
        in: 'isac_vx_breathing_hlmt01_(0[0-4]).ogg',
        out: 'isac_vx_breathing_hlmt01_(0[5-9]).ogg',
        // asphyx: 'isac_vx_breath_asphyxiation_hlmt01_\\d{2}.ogg',
      },
      intensity: {
        0: { volume: 1, frequency: 1 / 2.5 },
        // 1: { volume: 1, frequency: 1 },
        2: { volume: 5, frequency: 2 },
        // 1: { volume: 2, frequency: 1 / 4, asphyx_frequency: 0 },
        // 1.5: { volume: 2, frequency: 1 / 2.5 },
        // 2: { volume: 3, frequency: 0, asphyx_frequency: 1 / 2 },
      },
      variance: 0,
      directionality: 'none',
      cycleThrough: 'sets',
      bufferBetweenSounds: true,
    },
    // room: {
    //   category: 'amb',
    //   volume: 0.01,
    //   sets: {
    //     norm: 'amb_generic_room_tone_\\d{2}.exa.ogg',
    //   },
    //   intensity: {
    //     0: { volume: 0.1, frequency: 1 },
    //     2: { volume: 0.1, frequency: 1 },
    //   },
    //   variance: 0,
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
        0: { volume: 0.25, frequency: 1 / 20 },
        1.5: { volume: 0.5, frequency: 1 / 20 },
        2: { volume: 1, frequency: 1 / 10 },
      },
      variance: 0,
      directionality: 'unique',
      pitchSpeedRange: [0.9, 1.1],
    },
    annc: {
      category: 'sfx',
      volume: 0.25,
      sets: {
        norm: 'audio_pa_02_04.exa.ogg',
      },
      intensity: {
        0: { volume: 0.15, frequency: 1 / 45 },
        2: { volume: 0.15, frequency: 1 / 45 },
      },
      variance: 0,
      directionality: 'shared',
    },
    // annc: {
    //   category: 'npc',
    //   volume: 2,
    //   sets: {
    //     files: 'audio_pa_03_\\d{2}.exa.ogg',
    //   },
    //   intensity: {
    //     0: { volume: 0.25, frequency: 1 / 2 },
    //   },
    //   variance: 0,
    //   // directionality: 'shared',
    //   cycleThrough: 'files',
    //   bufferBetweenSounds: true,
    // },
    // crazy: {
    //   category: 'npc',
    //   volume: 0.25,
    //   sets: {
    //     files: 'observation_z01_\\d{2}.ogg',
    //   },
    //   intensity: { 0: { volume: 0.25, frequency: 1 } },
    //   bufferBetweenSounds: true,
    //   variance: 0,
    //   directionality: 'shared',
    // },
  },
}
